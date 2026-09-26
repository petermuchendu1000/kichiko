// Prototype bounded-tick-grid limit order book (Kichiko-shaped) vs textbook std::map baseline.
// Single-threaded, in-memory. Deterministic command stream; both books must produce the same fill hash.
// Build: g++ -O2 -march=native -std=c++20 book.cpp -o book
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <map>
#include <list>
#include <unordered_map>
#include <random>
#include <algorithm>
#include <sys/mman.h>
#include <x86intrin.h>
#include <time.h>
#include <valgrind/cachegrind.h>

#define LIKELY(x) __builtin_expect(!!(x), 1)
#define UNLIKELY(x) __builtin_expect(!!(x), 0)

constexpr uint32_t NIL = 0xFFFFFFFFu;
constexpr int NTICK = 1024;          // tick index 0..1023; Kichiko uses 1..999 (0.1c .. 99.9c)
enum : uint8_t { BID = 0, ASK = 1 };

struct Cmd {                          // 32 B
    uint8_t type;                     // 0 = limit, 1 = cancel
    uint8_t side;
    uint16_t tick;
    uint32_t acct;
    uint64_t qty;                     // micro-shares
    uint64_t oid;                     // for limit: new id; for cancel: target id
    uint32_t handle;                  // for cancel: engine handle (slot) of the target
    uint32_t _pad;
};

struct Fill { uint64_t maker, taker, qty; uint32_t tick; uint32_t _p; };

static inline uint64_t mix(uint64_t h, uint64_t v) { h ^= v + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2); return h; }

// ------------------------------------------------------------------------------------------
// Fast book: tick-indexed level array + 2-level bitmap + intrusive FIFO in a 32-byte-node slab
// ------------------------------------------------------------------------------------------
struct alignas(32) Order {            // 32 B, two per cache line
    uint64_t qty;                     // remaining (micro-shares)
    uint64_t oid;                     // external/engine id (also ABA check for handle reuse)
    uint32_t next, prev;              // 32-bit slab indices
    uint32_t acct;                    // dense account index (STP, risk)
    uint16_t tick;
    uint8_t side, kind;
};
static_assert(sizeof(Order) == 32);

struct Level { uint32_t head, tail; uint64_t qty; };   // 16 B, four per cache line
static_assert(sizeof(Level) == 16);

struct alignas(64) Ladder {
    uint64_t summary;                 // bit w set <=> bits[w] != 0
    uint64_t _pad[7];
    uint64_t bits[NTICK / 64];        // 16 words = 128 B
    Level lv[NTICK];                  // 16 KiB
};

template <bool USE_BITMAP>
struct FastBook {
    Ladder L[2];
    int32_t best[2];                  // best bid tick (-1 if none), best ask tick (NTICK if none)
    Order* pool; uint32_t cap; uint32_t freeHead; uint32_t live = 0;
    uint64_t hash = 0, nfills = 0;

    FastBook(uint32_t capacity) : cap(capacity) {
        memset(L, 0, sizeof L);
        for (int s = 0; s < 2; s++) for (int t = 0; t < NTICK; t++) L[s].lv[t] = {NIL, NIL, 0};
        best[BID] = -1; best[ASK] = NTICK;
        size_t bytes = size_t(cap) * sizeof(Order);
        pool = (Order*)mmap(nullptr, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        madvise(pool, bytes, getenv("BOOK_NOHUGE") ? MADV_NOHUGEPAGE : MADV_HUGEPAGE);
        for (uint32_t i = 0; i < cap; i++) { pool[i].next = i + 1 < cap ? i + 1 : NIL; pool[i].oid = 0; pool[i].qty = 0; }
        freeHead = 0;
    }

    ~FastBook() { munmap(pool, size_t(cap) * sizeof(Order)); }
    inline void setBit(int s, int t) { L[s].bits[t >> 6] |= 1ull << (t & 63); L[s].summary |= 1ull << (t >> 6); }
    inline void clearBit(int s, int t) {
        uint64_t w = L[s].bits[t >> 6] &= ~(1ull << (t & 63));
        if (w == 0) L[s].summary &= ~(1ull << (t >> 6));
    }
    inline int32_t scanBest(int s) {
        if constexpr (USE_BITMAP) {
            uint64_t sm = L[s].summary;
            if (s == BID) {
                if (!sm) return -1;
                int w = 63 - __builtin_clzll(sm);
                return w * 64 + 63 - __builtin_clzll(L[s].bits[w]);
            } else {
                if (!sm) return NTICK;
                int w = __builtin_ctzll(sm);
                return w * 64 + __builtin_ctzll(L[s].bits[w]);
            }
        } else {   // linear scan of level headers away from the old best
            if (s == BID) { for (int t = best[BID]; t >= 0; --t) if (L[BID].lv[t].qty) return t; return -1; }
            else { for (int t = best[ASK]; t < NTICK; ++t) if (L[ASK].lv[t].qty) return t; return NTICK; }
        }
    }

    inline void freeSlot(uint32_t i) { pool[i].oid = 0; pool[i].next = freeHead; freeHead = i; live--; }

    // returns handle of resting remainder or NIL
    uint32_t limit(uint8_t side, uint16_t tick, uint64_t qty, uint64_t oid, uint32_t acct) {
        const int opp = side ^ 1;
        // ---- match ----
        while (qty) {
            int32_t b = best[opp];
            bool crosses = side == BID ? (b <= tick) : (b >= tick);
            if (!crosses || b < 0 || b >= NTICK) break;
            Level& lv = L[opp].lv[b];
            uint32_t i = lv.head;
            while (qty && i != NIL) {
                Order& m = pool[i];
                uint32_t nx = m.next;
                if (nx != NIL) __builtin_prefetch(&pool[nx]);
                if (UNLIKELY(m.acct == acct)) {          // self-trade prevention: cancel resting (maker) order
                    lv.qty -= m.qty; lv.head = nx; if (nx != NIL) pool[nx].prev = NIL; else lv.tail = NIL;
                    freeSlot(i); i = nx; continue;
                }
                uint64_t f = m.qty < qty ? m.qty : qty;
                m.qty -= f; qty -= f; lv.qty -= f;
                hash = mix(hash, m.oid ^ (oid << 20) ^ (f << 1) ^ b); nfills++;
                if (m.qty == 0) { lv.head = nx; if (nx != NIL) pool[nx].prev = NIL; else lv.tail = NIL; freeSlot(i); i = nx; }
                else break;
            }
            if (lv.head == NIL) { clearBit(opp, b); best[opp] = scanBest(opp); }
        }
        if (!qty) return NIL;
        // ---- rest ----
        uint32_t i = freeHead;
        if (UNLIKELY(i == NIL)) return NIL;               // pool exhausted: reject (pre-sized in production)
        freeHead = pool[i].next; live++;
        Order& o = pool[i];
        o.qty = qty; o.oid = oid; o.acct = acct; o.tick = tick; o.side = side; o.kind = 0; o.next = NIL;
        Level& lv = L[side].lv[tick];
        o.prev = lv.tail;
        if (lv.tail != NIL) pool[lv.tail].next = i; else { lv.head = i; setBit(side, tick); }
        lv.tail = i; lv.qty += qty;
        if (side == BID) { if ((int)tick > best[BID]) best[BID] = tick; }
        else { if ((int)tick < best[ASK]) best[ASK] = tick; }
        return i;
    }

    bool cancel(uint32_t h, uint64_t oid) {
        if (UNLIKELY(h >= cap)) return false;
        Order& o = pool[h];
        if (o.oid != oid) return false;                   // already filled/cancelled (slot reused or freed)
        Level& lv = L[o.side].lv[o.tick];
        if (o.prev != NIL) pool[o.prev].next = o.next; else lv.head = o.next;
        if (o.next != NIL) pool[o.next].prev = o.prev; else lv.tail = o.prev;
        lv.qty -= o.qty;
        int s = o.side, t = o.tick;
        freeSlot(h);
        if (lv.head == NIL) { clearBit(s, t); if (t == best[s]) best[s] = scanBest(s); }
        return true;
    }
};

// ------------------------------------------------------------------------------------------
// Textbook baseline: std::map<price, std::list<order>> + std::unordered_map<id, iterator>
// ------------------------------------------------------------------------------------------
struct MapBook {
    struct O { uint64_t qty, oid; uint32_t acct; uint16_t tick; uint8_t side; };
    std::map<int, std::list<O>, std::greater<int>> bids;
    std::map<int, std::list<O>> asks;
    std::unordered_map<uint64_t, std::list<O>::iterator> idx;
    uint64_t hash = 0, nfills = 0;
    explicit MapBook(uint32_t) {}

    template <class M>
    uint64_t sweep(M& book, bool isBid, uint16_t tick, uint64_t qty, uint64_t oid, uint32_t acct) {
        while (qty && !book.empty()) {
            auto it = book.begin();
            int b = it->first;
            bool crosses = isBid ? (b <= tick) : (b >= tick);
            if (!crosses) break;
            auto& q = it->second;
            while (qty && !q.empty()) {
                auto& m = q.front();
                if (m.acct == acct) { idx.erase(m.oid); q.pop_front(); continue; }
                uint64_t f = m.qty < qty ? m.qty : qty;
                m.qty -= f; qty -= f;
                hash = mix(hash, m.oid ^ (oid << 20) ^ (f << 1) ^ b); nfills++;
                if (m.qty == 0) { idx.erase(m.oid); q.pop_front(); } else break;
            }
            if (q.empty()) book.erase(it);
        }
        return qty;
    }
    uint32_t limit(uint8_t side, uint16_t tick, uint64_t qty, uint64_t oid, uint32_t acct) {
        qty = side == BID ? sweep(asks, true, tick, qty, oid, acct) : sweep(bids, false, tick, qty, oid, acct);
        if (!qty) return NIL;
        auto& q = side == BID ? bids[tick] : asks[tick];
        q.push_back({qty, oid, acct, tick, side});
        idx.emplace(oid, std::prev(q.end()));
        return 0;
    }
    bool cancel(uint32_t, uint64_t oid) {
        auto f = idx.find(oid);
        if (f == idx.end()) return false;
        auto it = f->second;
        if (it->side == BID) { auto lv = bids.find(it->tick); lv->second.erase(it); if (lv->second.empty()) bids.erase(lv); }
        else { auto lv = asks.find(it->tick); lv->second.erase(it); if (lv->second.empty()) asks.erase(lv); }
        idx.erase(f);
        return true;
    }
};

// ------------------------------------------------------------------------------------------
// Workload: Kichiko-shaped flow on a 0.1c grid. Generated by driving a reference FastBook so
// that cancels target orders that are actually resting (plus a share of stale cancels).
// ------------------------------------------------------------------------------------------
struct Scenario { const char* name; uint32_t prefill; double pAdd, pCancel, pTake; int spread; double depthMean; int sweepMax; uint32_t accts; };

std::vector<Cmd> generate(const Scenario& sc, size_t n, uint64_t seed, uint32_t cap) {
    std::mt19937_64 rng(seed);
    std::uniform_real_distribution<double> U(0, 1);
    std::exponential_distribution<double> depth(1.0 / sc.depthMean);
    FastBook<true>* ref = new FastBook<true>(cap);
    std::vector<std::pair<uint32_t, uint64_t>> liveList;   // (handle, oid) of possibly-live resting orders
    std::vector<Cmd> out; out.reserve(n + sc.prefill);
    uint64_t nextOid = 1; double mid = 500; double liveSum = 0; size_t liveSamples = 0;
    auto emitLimit = [&](uint8_t side, int tick, uint64_t qty, uint32_t acct) {
        tick = std::clamp(tick, 1, 999);
        Cmd c{0, side, (uint16_t)tick, acct, qty, nextOid++, 0, 0};
        uint32_t h = ref->limit(side, c.tick, qty, c.oid, acct);
        if (h != NIL) liveList.push_back({h, c.oid});
        out.push_back(c);
    };
    auto passive = [&]() {
        uint8_t side = U(rng) < 0.5 ? BID : ASK;
        int off = sc.spread / 2 + 1 + (int)depth(rng);
        int tick = side == BID ? (int)mid - off : (int)mid + off;
        emitLimit(side, tick, (uint64_t)(1 + rng() % 100) * 1000000ull, (uint32_t)(rng() % sc.accts));
    };
    for (uint32_t i = 0; i < sc.prefill; i++) passive();
    size_t prefillCount = out.size();
    while (out.size() < prefillCount + n) {
        if (U(rng) < 0.02) mid = std::clamp(mid + (U(rng) < 0.5 ? -1 : 1), 60.0, 940.0);
        double r = U(rng);
        liveSum += ref->live; liveSamples++;
        double pCancelNow = (1.0 - sc.pTake) * std::min(0.95, 0.5 * double(ref->live) / double(sc.prefill));
        if (r >= sc.pTake + pCancelNow) passive();
        else if (r >= sc.pTake) {
            if (liveList.empty()) { passive(); continue; }
            size_t k = rng() % liveList.size();
            auto [h, oid] = liveList[k];
            bool wantStale = U(rng) < 0.02;                       // ~2% duplicate/stale cancels -> reject path
            while (!wantStale && ref->pool[h].oid != oid && !liveList.empty()) {   // drop entries filled meanwhile
                liveList[k] = liveList.back(); liveList.pop_back();
                if (liveList.empty()) break;
                k = rng() % liveList.size(); h = liveList[k].first; oid = liveList[k].second;
            }
            if (liveList.empty()) { passive(); continue; }
            liveList[k] = liveList.back(); liveList.pop_back();
            Cmd c{1, 0, 0, 0, 0, oid, h, 0};
            ref->cancel(h, oid);
            out.push_back(c);
        } else {
            uint8_t side = U(rng) < 0.5 ? BID : ASK;
            int b = side == BID ? ref->best[ASK] : ref->best[BID];
            if (b < 0 || b >= NTICK) { passive(); continue; }
            int through = (int)(rng() % (sc.sweepMax + 1));
            int tick = side == BID ? b + through : b - through;
            emitLimit(side, tick, (uint64_t)(20 + rng() % 300) * 1000000ull, (uint32_t)(rng() % sc.accts));
        }
    }
    if (sc.prefill != 150) fprintf(stderr, "# gen %s: avg_resting=%.0f cmds=%zu prefill=%zu resting_at_end=%u bestBid=%d bestAsk=%d\n", sc.name, liveSum / std::max<size_t>(1, liveSamples), out.size(), prefillCount, ref->live, ref->best[BID], ref->best[ASK]);
    delete ref;
    return out;
}

static double now_ns() { timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }

static double tscGHz() {
    double t0 = now_ns(); uint64_t c0 = __rdtsc();
    while (now_ns() - t0 < 200e6) {}
    return double(__rdtsc() - c0) / (now_ns() - t0);
}

template <class B>
void run(const char* label, const char* scen, const std::vector<Cmd>& cmds, size_t skip, uint32_t cap, double ghz, bool latency) {
    B* b = new B(cap);
    for (size_t i = 0; i < skip; i++) { auto& c = cmds[i]; b->limit(c.side, c.tick, c.qty, c.oid, c.acct); }
    // map handle bookkeeping is internal to each book (FastBook uses handles, MapBook uses oid)
    size_t n = cmds.size() - skip;
    std::vector<uint32_t> lat; if (latency) lat.resize(n);
    uint64_t rej = 0;
    double t0 = now_ns();
    if (!latency) {
        CACHEGRIND_START_INSTRUMENTATION;
        for (size_t i = skip; i < cmds.size(); i++) {
            const Cmd& c = cmds[i];
            if (c.type == 0) b->limit(c.side, c.tick, c.qty, c.oid, c.acct);
            else rej += !b->cancel(c.handle, c.oid);
        }
        CACHEGRIND_STOP_INSTRUMENTATION;
    } else {
        std::vector<uint32_t> byCat[4];   // 0 add(rest, no fill) 1 taker(>=1 fill) 2 cancel ok 3 cancel reject
        for (size_t i = skip; i < cmds.size(); i++) {
            const Cmd& c = cmds[i];
            uint64_t f0 = b->nfills; int cat;
            unsigned aux; _mm_lfence(); uint64_t s = __rdtsc(); _mm_lfence();
            if (c.type == 0) { b->limit(c.side, c.tick, c.qty, c.oid, c.acct); cat = -1; }
            else { bool ok = b->cancel(c.handle, c.oid); rej += !ok; cat = ok ? 2 : 3; }
            uint64_t e = __rdtscp(&aux); _mm_lfence();
            if (cat < 0) cat = b->nfills > f0 ? 1 : 0;
            uint32_t v = (uint32_t)std::min<uint64_t>(e - s, 0xFFFFFFFFu);
            lat[i - skip] = v; byCat[cat].push_back(v);
        }
        const char* nm[4] = {"add_rest", "taker", "cancel_ok", "cancel_rej"};
        for (int k = 0; k < 4; k++) {
            auto& v = byCat[k]; if (v.empty()) continue; std::sort(v.begin(), v.end());
            auto P = [&](double p) { return v[std::min(v.size() - 1, (size_t)(p * v.size()))] / ghz; };
            printf("%-10s %-14s   %-10s n=%-8zu p50=%.0f p99=%.0f p99.9=%.0f ns (raw, incl. timer)\n", scen, label, nm[k], v.size(), P(.5), P(.99), P(.999));
        }
    }
    double t1 = now_ns();
    if (!latency) {
        printf("%-10s %-14s ops=%zu  %.1f ns/op  %.2f M ops/s  fills=%lu rej=%lu hash=%016lx\n", scen, label, n, (t1 - t0) / n, n / (t1 - t0) * 1e3, b->nfills, rej, b->hash);
    } else {
        std::sort(lat.begin(), lat.end());
        auto pct = [&](double p) { return lat[std::min(n - 1, (size_t)(p * n))] / ghz; };
        printf("%-10s %-14s latency(ns, incl. ~timer overhead) p50=%.0f p90=%.0f p99=%.0f p99.9=%.0f p99.99=%.0f max=%.0f\n", scen, label, pct(.5), pct(.9), pct(.99), pct(.999), pct(.9999), lat[n - 1] / ghz);
    }
    delete b;
}


// Many books, orders routed uniformly at random: measures the cache-cold-book cost (Kichiko has many markets).
void multi(size_t N, uint32_t M, double ghz) {
    Scenario sc{"multi", 150, 0.50, 0.38, 0.12, 4, 6.0, 2, 50};
    size_t per = N / M + 1;
    uint32_t capPer = 2048;
    std::vector<std::vector<Cmd>> streams(M);
    for (uint32_t m = 0; m < M; m++) { streams[m] = generate(sc, per, 1000 + m, capPer); }
    std::vector<FastBook<true>*> books(M);
    std::vector<size_t> pos(M);
    for (uint32_t m = 0; m < M; m++) {
        books[m] = new FastBook<true>(capPer);
        for (size_t i = 0; i < sc.prefill; i++) { auto& c = streams[m][i]; books[m]->limit(c.side, c.tick, c.qty, c.oid, c.acct); }
        pos[m] = sc.prefill;
    }
    std::mt19937_64 rng(7);
    std::vector<std::pair<uint32_t, const Cmd*>> order; order.reserve(N);
    for (size_t k = 0; k < N; k++) {
        uint32_t m = rng() % M;
        if (pos[m] >= streams[m].size()) continue;
        order.push_back({m, &streams[m][pos[m]++]});
    }
    uint64_t rej = 0;
    const size_t D = getenv("PF_DIST") ? atoi(getenv("PF_DIST")) : 0;   // software look-ahead prefetch distance
    const bool pf2 = getenv("PF2") != nullptr;
    double t0 = now_ns();
    for (size_t k = 0; k < order.size(); k++) {
        if (D && pf2 && k + 2 * D < order.size()) {      // stage 1: header + top-level lines only
            auto [qm, qc] = order[k + 2 * D]; FastBook<true>* qb = books[qm];
            __builtin_prefetch(&qb->best); __builtin_prefetch(&qb->L[qc->side ^ 1].bits[0]);
            if (qc->type == 1 && qc->handle < qb->cap) __builtin_prefetch(&qb->pool[qc->handle]);
        }
        if (D && k + D < order.size()) {
            auto [pm, pc] = order[k + D];
            FastBook<true>* pb = books[pm];
            __builtin_prefetch(&pb->best);
            if (pc->type == 0) {
                __builtin_prefetch(&pb->L[pc->side ^ 1].summary);
                __builtin_prefetch(&pb->L[pc->side ^ 1].bits[0]);
                __builtin_prefetch(&pb->L[pc->side].lv[pc->tick]);
                int ob = pb->best[pc->side ^ 1]; if (ob >= 0 && ob < NTICK) __builtin_prefetch(&pb->L[pc->side ^ 1].lv[ob]);
                __builtin_prefetch(&pb->pool[pb->freeHead]);
            } else if (pc->handle < pb->cap) __builtin_prefetch(&pb->pool[pc->handle]);
        }
        auto [m, c] = order[k];
        FastBook<true>* b = books[m];
        if (c->type == 0) b->limit(c->side, c->tick, c->qty, c->oid, c->acct);
        else rej += !b->cancel(c->handle, c->oid);
    }
    double t1 = now_ns();
    uint64_t h = 0; for (auto* b : books) h ^= b->hash;
    printf("multi M=%-6u ops=%zu  %.1f ns/op  %.2f M ops/s rej=%lu hash=%016lx\n", M, order.size(), (t1 - t0) / order.size(), order.size() / (t1 - t0) * 1e3, rej, h);
    for (auto* b : books) delete b;
}

int main(int argc, char** argv) {
    size_t N = argc > 1 ? atol(argv[1]) : 2'000'000;
    const char* only = argc > 2 ? argv[2] : nullptr;
    double ghz = tscGHz();
    // timer overhead
    { std::vector<uint64_t> v(100000); for (auto& x : v) { unsigned a; _mm_lfence(); uint64_t s = __rdtsc(); _mm_lfence(); uint64_t e = __rdtscp(&a); _mm_lfence(); x = e - s; }
      std::sort(v.begin(), v.end()); printf("# TSC %.3f GHz; empty timed region p50=%.1f ns (%lu ticks)\n", ghz, v[50000] / ghz, v[50000]); }
    if (argc > 4 && !strcmp(argv[3], "multi")) { multi(N, atoi(argv[4]), ghz); return 0; }
    Scenario S[] = {
        // name        prefill  add   cancel take  spread depthMean sweepMax accts
        {"thin",         200,   0.50, 0.38, 0.12,  4,     6.0,      2,   50},
        {"normal",      5000,   0.50, 0.38, 0.12,  2,    12.0,      3,  500},
        {"deep",      100000,   0.50, 0.45, 0.05,  2,    60.0,      3, 5000},
        {"sweep",       5000,   0.45, 0.30, 0.25,  2,    12.0,     40,  500},
    };
    const uint32_t cap = 1u << 21;   // 2M slots x 32 B = 64 MiB
    for (auto& sc : S) {
        if (only && *only && strcmp(only, sc.name)) continue;
        auto cmds = generate(sc, N, 23, cap);
        size_t skip = sc.prefill;
        const char* which = argc > 3 ? argv[3] : nullptr;
        if (which && !strcmp(which, "dump")) {
            char fn[64]; snprintf(fn, sizeof fn, "cmds_%s.bin", sc.name);
            FILE* f = fopen(fn, "wb"); uint64_t sk = skip, cnt = cmds.size();
            fwrite(&sk, 8, 1, f); fwrite(&cnt, 8, 1, f); fwrite(cmds.data(), sizeof(Cmd), cmds.size(), f); fclose(f);
            continue;
        }
        if (which) {
            if (!strcmp(which, "fast")) run<FastBook<true>>("fast_bitmap", sc.name, cmds, skip, cap, ghz, false);
            if (!strcmp(which, "lin")) run<FastBook<false>>("fast_linscan", sc.name, cmds, skip, cap, ghz, false);
            if (!strcmp(which, "map")) run<MapBook>("std_map", sc.name, cmds, skip, cap, ghz, false);
            continue;
        }
        run<FastBook<true>>("fast_bitmap", sc.name, cmds, skip, cap, ghz, false);
        run<FastBook<false>>("fast_linscan", sc.name, cmds, skip, cap, ghz, false);
        run<MapBook>("std_map", sc.name, cmds, skip, cap, ghz, false);
        run<FastBook<true>>("fast_bitmap", sc.name, cmds, skip, cap, ghz, true);
        run<MapBook>("std_map", sc.name, cmds, skip, cap, ghz, true);
    }
    return 0;
}
