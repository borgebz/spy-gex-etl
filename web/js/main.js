/* Page wiring: fill numbers, draw charts, swap the terminal screen on scroll. */
(function () {
  const f = GA.fmt;

  function boot() {
    const D = window.GEX_DATA;
    if (!D || !D.latest) {
      document.querySelectorAll("[data-bind]").forEach((el) => (el.textContent = "n/a"));
      console.error("GreeksAddicted: data/data.js is missing or empty. Run the 05-export workflow.");
      return;
    }
    mergeHistory(D, window.GEX_HISTORY);
    bind(D);
    deltas(D);
    draw(D);
    watchScroll();
  }

  /* history.js holds the sessions before the live week, data.js the live ones (SQLite).
     Per trading day, keep the source with more rows, so a full earlier day beats a partial live one. */
  function mergeHistory(D, H) {
    if (!H) return;
    const pick = (live, past) => {
      const count = (rows) => rows.reduce((m, r) => { const k = f.etDay(r.market_ts_utc); return m.set(k, (m.get(k) || 0) + 1); }, new Map());
      const nLive = count(live), nPast = count(past);
      const fromPast = (r) => { const k = f.etDay(r.market_ts_utc); return (nPast.get(k) || 0) > (nLive.get(k) || 0); };
      return past.filter(fromPast).concat(live.filter((r) => !fromPast(r)))
        .sort((a, b) => (a.market_ts_utc < b.market_ts_utc ? -1 : 1));
    };
    D.gex_series = pick(D.gex_series || [], H.gex_series || []);
    D.prices = pick(D.prices || [], H.prices || []);
    D.pipeline = pipelineCounts(D);
  }

  /* Pipeline row counts for the sessions on the page, not only the live SQLite week.
     History rows carry their option-row count; live days are scaled from the SQLite totals. */
  function pipelineCounts(D) {
    const P = D.pipeline;
    const past = D.gex_series.filter((g) => g.contracts != null);
    const live = D.gex_series.length - past.length;
    const share = P.gex_snapshots ? live / P.gex_snapshots : 0;
    const files = D.gex_series.length + Math.max(0, P.raw_snapshots - P.gex_snapshots);
    const rows = past.reduce((a, g) => a + g.contracts, 0) + Math.round(P.option_rows * share);
    const out = Object.assign({}, P, { raw_snapshots: files, option_rows: rows, gex_snapshots: D.gex_series.length, price_ticks: D.prices.length });

    // Storage for the same sessions, scaled from the live SQLite (bytes per raw file, bytes per
    // option row) and the retention in archive_db.py: raw files stay 2 sessions, option rows 7.
    if (P.raw_bytes && P.db_bytes && P.raw_snapshots && P.option_rows) {
      const perFile = P.raw_bytes / P.raw_snapshots;
      const perRow = Math.max(0, P.db_bytes - P.raw_bytes) / P.option_rows;
      const perSession = new Map();
      D.gex_series.forEach((g) => { const k = f.etDay(g.market_ts_utc); perSession.set(k, (perSession.get(k) || 0) + 1); });
      const recent = (n) => [...perSession.keys()].sort().slice(-n).reduce((a, k) => a + perSession.get(k), 0);
      const rowsPerSnapshot = rows / D.gex_series.length;
      out.raw_bytes = files * perFile;
      out.db_bytes = recent(2) * perFile + recent(7) * rowsPerSnapshot * perRow;
    }
    return out;
  }

  /* Numbers into [data-bind] slots */
  function bind(D) {
    const L = D.latest;
    const neg = L.total_gex < 0;
    const between = L.spot >= Math.min(L.put_wall, L.call_wall) && L.spot <= Math.max(L.put_wall, L.call_wall);
    const n = (v) => `<span class="num">${v}</span>`;
    const ex = D.example_contract;

    const values = {
      spot: f.price(L.spot),
      total_gex: f.gex(L.total_gex),
      call_gex: f.gex(L.call_gex),
      put_gex: f.gex(L.put_gex),
      call_wall: f.strike(L.call_wall),
      put_wall: f.strike(L.put_wall),
      asof: f.asOf(L.market_ts_utc),
      generated: f.asOf(D.meta.generated_at_utc),
      raw_snapshots: f.int(D.pipeline.raw_snapshots),
      option_rows: f.int(D.pipeline.option_rows),
      gex_snapshots: f.int(D.pipeline.gex_snapshots),
      price_ticks: f.int(D.pipeline.price_ticks),
    };
    // Data size funnel on the pipeline screen (raw_bytes / db_bytes from 05-export, or scaled above).
    const P = D.pipeline;
    let volumeRatio = "";
    if (P.raw_bytes && P.db_bytes) {
      const pageBytes = new Blob([JSON.stringify(D)]).size;
      Object.assign(values, { raw_size: f.bytes(P.raw_bytes), db_size: f.bytes(P.db_bytes), page_size: f.bytes(pageBytes) });
      volumeRatio = `The page gets ${n(f.int(Math.round(P.raw_bytes / pageBytes)) + "×")} less data than the pipeline pulled.`;
      const max = Math.max(P.raw_bytes, P.db_bytes);
      const setBar = (k, b) => document.querySelector(`[data-bar="${k}"]`).style.setProperty("--w", (b / max) * 100 + "%");
      setBar("raw", P.raw_bytes); setBar("db", P.db_bytes); setBar("page", pageBytes); // linear on purpose
      document.querySelector("[data-volume]").hidden = false;
    }

    if (ex) {
      Object.assign(values, {
        ex_label: `${f.day(ex.expiry)} ${f.strike(ex.strike)}`,
        ex_gamma: ex.gamma,
        ex_oi: f.int(ex.open_interest),
        ex_spot: f.price(ex.spot),
        ex_gex: f.gex(ex.gex, 1),
      });
      document.querySelector("[data-example]").hidden = false;
    }
    const html = {
      strike_story:
        (between
          ? `Spot ${n(f.price(L.spot))} sits between the put wall and the call wall. `
          : `Spot ${n(f.price(L.spot))} sits outside the walls. `) +
        (neg
          ? `Net gamma is negative, so dealers chase moves instead of damping them.`
          : `Net gamma is positive, so dealers lean against moves and damp them.`),
      volume_ratio: volumeRatio,
    };

    document.querySelectorAll("[data-bind]").forEach((el) => {
      const key = el.dataset.bind;
      if (key in html) el.innerHTML = html[key];
      else if (key in values) el.textContent = values[key];
      if (el.hasAttribute("data-sign")) el.classList.add(neg ? "put" : "call");
    });

    // Wall definitions from the export, as hover hints on the labels
    document.querySelectorAll("[data-def]").forEach((el) => {
      const def = D.meta[el.dataset.def + "_definition"];
      if (def) { el.title = def; el.classList.add("has-def"); }
    });

    document.querySelectorAll("[data-regime]").forEach((el) => {
      el.textContent = neg ? "Short gamma: dealers amplify moves" : "Long gamma: dealers damp moves";
      el.classList.add(neg ? "is-short" : "is-long");
    });

    if (D.meta.demo) document.querySelector("[data-demo-badge]").hidden = false;
  }

  /* Charts. Story charts are kept so a screen switch can replay their entry animation. */
  const replay = new Map();
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function draw(D) {
    const spark = GA.charts.spark(document.getElementById("chart-hero"), D);
    replay.set("hero", spark);
    if (spark.session) document.querySelector("[data-spark-title]").textContent = `${spark.session.label}: price and net gamma, ET`;
    const narrow = matchMedia("(max-width: 960px)").matches;
    replay.set("strike", GA.charts.strike(document.getElementById("chart-strike"), D, { window: narrow ? 0.035 : 0.06, range: 0.25 }));
    let onView = () => {};
    const intra = GA.charts.intraday(document.getElementById("chart-intraday"), D, { onView: () => onView() });
    replay.set("intraday", intra);
    onView = sessionControls(intra);
    onView();

    if (intra.points < 2) {
      const note = document.querySelector("[data-intraday-note]");
      note.innerHTML =
        `The pipeline has stored <span class="num">${intra.points}</span> ` +
        `snapshot${intra.points === 1 ? "" : "s"} for this session so far. ` +
        `This chart fills in as new snapshots arrive every 5 minutes.`;
      note.hidden = false;
    }
  }

  /* Session switch for the price-and-gamma screen. Returns the function that redraws its labels. */
  function sessionControls(intra) {
    const box = document.querySelector("[data-sessions]");
    const label = box.querySelector("[data-session-label]");
    const prev = box.querySelector('[data-step="-1"]');
    const next = box.querySelector('[data-step="1"]');
    const pill = box.querySelector("[data-view-10d]");
    const foot = document.querySelector("[data-intraday-foot]");
    const S = intra.sessions;
    let lastDay = S.length - 1;

    prev.addEventListener("click", () => intra.view > 0 && intra.show(intra.view - 1));
    next.addEventListener("click", () => intra.view < S.length - 1 && intra.show(intra.view + 1));
    pill.addEventListener("click", () => intra.show(intra.view === "10d" ? lastDay : "10d"));

    return function render() {
      const v = intra.view, multi = v === "10d";
      box.hidden = !S.length;
      if (!S.length) return;
      if (!multi) lastDay = v;
      pill.hidden = S.length < 2;
      pill.setAttribute("aria-pressed", String(multi));
      prev.disabled = multi || v <= 0;
      next.disabled = multi || v >= S.length - 1;
      if (multi) {
        label.textContent = `Last ${S.length} sessions`;
        foot.textContent = "";
        return;
      }
      const s = S[v];
      const tag = s.live ? '<span class="tag tag--live">live</span>' : s.opex ? '<span class="tag">OPEX</span>' : "";
      label.innerHTML = s.label + tag;
      foot.innerHTML = s.lag
        ? `Price <span class="num">${f.hhmm(s.lastPrice)}</span> · GEX <span class="num">${f.hhmm(s.lastGex)}</span> ET`
        : "";
    };
  }

  /* Hero: change against the previous session's close, under each number */
  function deltas(D) {
    const S = GA.charts.sessions(D);
    if (S.length < 2) return;
    const L = D.latest, prev = S[S.length - 2];
    const pg = prev.gex[prev.gex.length - 1];
    const pp = prev.prices[prev.prices.length - 1].price;
    const when = f.day(prev.day);
    const up = (v) => (v < 0 ? "put" : "call");
    const pct = (L.spot / pp - 1) * 100;
    const dg = L.total_gex - pg.total_gex;
    const wall = (k) => (pg[k] === L[k] ? `same as ${when}` : `was <span class="num">${f.strike(pg[k])}</span> on ${when}`);
    const html = {
      spot: `<span class="num ${up(pct)}">${pct < 0 ? f.MINUS : "+"}${Math.abs(pct).toFixed(2)}%</span> vs ${when} close`,
      total_gex: `<span class="num ${up(dg)}">${dg < 0 ? "▼" : "▲"}</span> from <span class="num">${f.gex(pg.total_gex)}</span> on ${when}`,
      call_wall: wall("call_wall"),
      put_wall: wall("put_wall"),
    };
    document.querySelectorAll("[data-delta]").forEach((el) => (el.innerHTML = html[el.dataset.delta] || ""));
  }

  /* Scroll: the step that crosses the middle of the viewport picks the screen */
  function watchScroll() {
    const stack = document.querySelector(".screens");
    const screens = new Map([...document.querySelectorAll("[data-screen-id]")].map((s) => [s.dataset.screenId, s]));
    const steps = new Map([...document.querySelectorAll(".step")].map((s) => [s.dataset.screen, s]));
    const order = [...screens.keys()];
    const counter = document.querySelector("[data-screen-n]");
    const title = document.querySelector("[data-title]");
    const led = document.querySelector(".crt--story [data-led]");
    const rail = new Map([...document.querySelectorAll("[data-rail]")].map((a) => [a.dataset.rail, a]));
    const nav = [...document.querySelectorAll(".topnav a")];
    let current = "strike";

    // Restart a CSS animation class on an element.
    const kick = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

    const showScreen = (id) => {
      steps.forEach((s, key) => s.classList.toggle("is-active", key === id));
      if (!screens.has(id) || id === current) return;
      const from = screens.get(current), to = screens.get(id);
      stack.dataset.dir = order.indexOf(id) > order.indexOf(current) ? "next" : "back";
      current = id;

      screens.forEach((s) => s.classList.remove("is-active", "is-entering", "is-leaving"));
      screens.forEach((s, key) => s.setAttribute("aria-hidden", String(key !== id)));
      to.classList.add("is-active");
      if (counter) counter.textContent = order.indexOf(id) + 1;
      if (title) title.textContent = to.dataset.wt;
      // Always animate the switch. With "reduce motion" on, CSS swaps the roll for a short slide and fade.
      kick(from, "is-leaving");
      from.addEventListener("animationend", () => from.classList.remove("is-leaving"), { once: true });
      kick(to, "is-entering");
      if (calm) return;
      kick(led, "is-busy");
      const r = replay.get(id);
      if (r && r.opt) setTimeout(() => { r.chart.clear(); r.chart.setOption(r.opt); }, 180);
    };
    const markSection = (id) => {
      rail.forEach((a, key) => a.classList.toggle("is-active", key === id));
      nav.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + id)));
    };

    const middle = { rootMargin: "-50% 0px -50% 0px", threshold: 0 };
    const stepObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting && showScreen(e.target.dataset.screen));
    }, middle);
    steps.forEach((s) => stepObs.observe(s));
    steps.get(current).classList.add("is-active");

    // Full screen (green traffic light). Inside it, arrow keys roll between screens.
    // No bar replay on enter: the chart is already drawn at full size in the transition snapshot, and a
    // replay would redraw the canvas every frame right when the monitor lands (profiled).
    GA.zoom.init(document.querySelector('[data-monitor="hero"]'), {});
    GA.zoom.init(document.querySelector('[data-monitor="story"]'), {
      // Leave the page where the screen now is, so the monitor lands next to the matching text.
      beforeExit: () => steps.get(current).scrollIntoView({ block: "center", behavior: "instant" }),
      onKey(e) {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(current) + step))];
        showScreen(next);
      },
    });

    const sectionObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting && markSection(e.target.dataset.section));
    }, middle);
    document.querySelectorAll("[data-section]").forEach((s) => sectionObs.observe(s));
  }

  /* ?demo=1 loads a synthetic intraday session on top of the real data */
  if (new URLSearchParams(location.search).has("demo")) {
    const s = document.createElement("script");
    s.src = "data/demo.js";
    s.onload = boot;
    s.onerror = boot;
    document.head.appendChild(s);
  } else {
    boot();
  }
})();
