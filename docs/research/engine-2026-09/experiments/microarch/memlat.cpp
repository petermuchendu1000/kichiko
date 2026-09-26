// Pointer-chase load-to-use latency vs working-set size, 4 KiB pages vs THP (2 MiB).
// Build: g++ -O2 -march=native memlat.cpp -o memlat
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <random>
#include <algorithm>
#include <sys/mman.h>
#include <x86intrin.h>
#include <time.h>

static double now_ns() { timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }

int main(int argc, char** argv) {
    bool huge = argc > 1 && strcmp(argv[1], "huge") == 0;
    const size_t maxBytes = size_t(1) << 30; // 1 GiB
    void* mem = mmap(nullptr, maxBytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (mem == MAP_FAILED) { perror("mmap"); return 1; }
    madvise(mem, maxBytes, huge ? MADV_HUGEPAGE : MADV_NOHUGEPAGE);
    memset(mem, 1, maxBytes);
    { FILE* f = fopen("/proc/self/smaps_rollup", "r"); char l[256]; while (fgets(l, sizeof l, f)) if (strstr(l, "AnonHuge")) printf("# %s", l); fclose(f); }
    const size_t LINE = 64;
    std::mt19937_64 rng(42);
    printf("# pages=%s\n# size_KiB  ns_per_load\n", huge ? "THP(2MiB)" : "4KiB");
    for (size_t bytes = 8 << 10; bytes <= maxBytes; bytes *= 2) {
        size_t n = bytes / LINE;
        std::vector<uint32_t> perm(n);
        for (size_t i = 0; i < n; i++) perm[i] = uint32_t(i);
        std::shuffle(perm.begin() + 1, perm.end(), rng);
        char* base = (char*)mem;
        // build a single random cycle through all lines (one pointer per 64-byte line)
        for (size_t i = 0; i < n; i++) {
            void** p = (void**)(base + size_t(perm[i]) * LINE);
            *p = base + size_t(perm[(i + 1) % n]) * LINE;
        }
        void** p = (void**)(base + size_t(perm[0]) * LINE);
        size_t iters = std::max<size_t>(n * 4, 20'000'000);
        for (size_t i = 0; i < n; i++) p = (void**)*p; // warm
        double t0 = now_ns();
        for (size_t i = 0; i < iters; i++) p = (void**)*p;
        double t1 = now_ns();
        printf("%10zu  %8.2f   %p\n", bytes >> 10, (t1 - t0) / iters, (void*)p);
        fflush(stdout);
    }
    return 0;
}
