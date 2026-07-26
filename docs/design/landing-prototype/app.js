/* Kichiko landing — interaction layer. Progressive enhancement only. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  var themeBtn = document.getElementById("theme");
  var stored = null;
  try { stored = localStorage.getItem("mp-theme"); } catch (e) {}
  if (stored) root.setAttribute("data-theme", stored);
  function syncIcons() {
    var dark = root.getAttribute("data-theme") === "dark" ||
      (!root.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.querySelectorAll(".ic-sun").forEach(function (n) { n.style.display = dark ? "none" : ""; });
    root.querySelectorAll(".ic-moon").forEach(function (n) { n.style.display = dark ? "" : "none"; });
  }
  syncIcons();
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var cur = root.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("mp-theme", next); } catch (e) {}
    syncIcons();
  });

  /* ---------- Mobile drawer ---------- */
  var drawer = document.getElementById("drawer");
  var menu = document.getElementById("menu");
  function openD() { drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); menu.setAttribute("aria-expanded", "true"); }
  function closeD() { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); menu.setAttribute("aria-expanded", "false"); }
  if (menu) menu.addEventListener("click", openD);
  if (drawer) drawer.querySelectorAll("[data-close]").forEach(function (n) { n.addEventListener("click", closeD); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeD(); });

  /* ---------- Data ---------- */
  var markets = [
    { c: "Politics", q: "Will voter registration exceed 25M before the 2027 general election?", p: 54, d: 1.2, up: true, v: "KES 8.1M", t: "42d" },
    { c: "Sports", q: "Will Harambee Stars qualify for the next AFCON tournament?", p: 61, d: 3.1, up: true, v: "KES 3.4M", t: "88d" },
    { c: "Economy", q: "Will annual inflation stay below 6% through Q3?", p: 73, d: 1.8, up: false, v: "KES 5.9M", t: "21d" },
    { c: "Climate", q: "Will the March–May long rains be classed above-average?", p: 47, d: 2.6, up: true, v: "KES 2.2M", t: "9d" },
    { c: "Tech", q: "Will Kenya's fintech sector announce a new unicorn this year?", p: 38, d: 0.9, up: false, v: "KES 1.7M", t: "160d" },
    { c: "Economy", q: "Will the shilling trade stronger than 128 to the dollar by year-end?", p: 42, d: 2.0, up: true, v: "KES 6.3M", t: "120d" },
  ];

  /* ---------- Sparkline generator ---------- */
  function spark(seed) {
    var pts = [], y = 26, i;
    for (i = 0; i <= 10; i++) { y += (Math.sin(seed + i) * 4) + (Math.random() * 3 - 1.5); y = Math.max(8, Math.min(36, y)); pts.push([i * 30, y.toFixed(1)]); }
    var line = "M" + pts.map(function (p) { return p[0] + "," + p[1]; }).join(" L");
    var area = line + " L300,44 L0,44 Z";
    return '<svg class="spark" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="' + area + '"/><path class="line" d="' + line + '"/></svg>';
  }

  /* ---------- Market grid ---------- */
  var grid = document.getElementById("grid");
  if (grid) {
    markets.forEach(function (m) {
      var el = document.createElement("article");
      el.className = "mkt card reveal";
      el.innerHTML =
        '<div class="top"><span class="chip">' + m.c + '</span><span class="time-left">Closes ' + m.t + '</span></div>' +
        '<h3 class="q">' + m.q + '</h3>' +
        spark(m.p) +
        '<div class="prob"><span class="pct mono" data-prob="' + m.p + '">' + m.p + '%</span>' +
        '<span class="delta ' + (m.up ? "up" : "down") + '">' + (m.up ? "▲" : "▼") + " " + m.d.toFixed(1) + '%</span></div>' +
        '<div class="pbar"><span class="fill" style="width:' + m.p + '%"></span></div>' +
        '<div class="foot"><span>Vol <b class="mono">' + m.v + '</b></span><span class="yeslab mono" style="color:var(--yes-700);font-weight:600">' + m.p + '¢ YES</span></div>';
      grid.appendChild(el);
    });
  }

  /* ---------- Live ticker ---------- */
  var ticker = document.getElementById("ticker");
  if (ticker) {
    var items = markets.concat(markets).map(function (m) {
      var up = Math.random() > 0.45;
      var chg = (Math.random() * 3 + 0.3).toFixed(1);
      return '<span class="tick"><span class="q">' + m.q.slice(0, 34) + '…</span>' +
        '<span class="v ' + (up ? "up" : "down") + '">' + m.p + '% ' + (up ? "▲" : "▼") + chg + '%</span></span>';
    });
    ticker.innerHTML = items.join("");
  }

  /* ---------- Animated probability roll (signature interaction) ---------- */
  function rollTo(el, target, dur) {
    if (reduce) { el.textContent = target + "%"; return; }
    var start = parseFloat(el.textContent) || 0, t0 = null;
    function frame(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      el.textContent = Math.round(start + (target - start) * e) + "%";
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* Roll probabilities into view once */
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      if (en.target.classList.contains("reveal")) en.target.classList.add("in");
      var probs = en.target.querySelectorAll ? en.target.querySelectorAll("[data-prob]") : [];
      probs.forEach(function (p) { if (!p.dataset.done) { p.dataset.done = "1"; rollTo(p, parseInt(p.dataset.prob, 10), 900); } });
      var counts = en.target.querySelectorAll ? en.target.querySelectorAll("[data-count]") : [];
      counts.forEach(function (c) { if (!c.dataset.done) { c.dataset.done = "1"; countUp(c); } });
      io.unobserve(en.target);
    });
  }, { threshold: 0.25 }) : null;

  function countUp(el) {
    var target = parseFloat(el.dataset.count), suf = el.dataset.suffix || "", pre = el.dataset.prefix || "";
    if (reduce) { el.textContent = pre + target + suf; return; }
    var t0 = null;
    function frame(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / 1200), e = 1 - Math.pow(1 - k, 3);
      var val = target * e;
      el.textContent = pre + (target >= 100 ? Math.round(val).toLocaleString() : val.toFixed(0)) + suf;
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (io) {
    document.querySelectorAll(".reveal, [data-prob], .stat").forEach(function (n) { io.observe(n); });
    // hero card probability rolls immediately
    document.querySelectorAll(".mkt-hero [data-prob]").forEach(function (p) { p.dataset.done = "1"; rollTo(p, parseInt(p.dataset.prob, 10), 900); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (n) { n.classList.add("in"); });
  }

  /* ---------- Live probability drift (calm, no anxiety) ---------- */
  if (!reduce) {
    setInterval(function () {
      var hero = document.querySelector(".mkt-hero .pct");
      if (!hero) return;
      var cur = parseInt(hero.textContent, 10);
      var next = Math.max(60, Math.min(75, cur + (Math.random() > 0.5 ? 1 : -1)));
      if (next !== cur) {
        rollTo(hero, next, 500);
        var fill = document.querySelector(".mkt-hero .pbar .fill");
        if (fill) fill.style.width = next + "%";
        var leg = document.querySelector(".mkt-hero .pbar-legend");
        if (leg) leg.innerHTML = '<span class="yeslab">YES ' + next + '%</span><span class="nolab">NO ' + (100 - next) + '%</span>';
      }
    }, 4200);
  }

  /* ---------- Language toggle (visual) ---------- */
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".lang button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
    });
  });
})();
