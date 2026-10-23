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
    bind(D);
    draw(D);
    watchScroll();
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
    replay.set("hero", GA.charts.strike(document.getElementById("chart-hero"), D, { window: 0.035, zoom: false, wallLabels: false }));
    const narrow = matchMedia("(max-width: 960px)").matches;
    replay.set("strike", GA.charts.strike(document.getElementById("chart-strike"), D, { window: narrow ? 0.035 : 0.06, range: 0.25 }));
    const intra = GA.charts.intraday(document.getElementById("chart-intraday"), D);
    replay.set("intraday", intra);

    if (intra.points < 2) {
      const note = document.querySelector("[data-intraday-note]");
      note.innerHTML =
        `The pipeline has stored <span class="num">${intra.points}</span> ` +
        `snapshot${intra.points === 1 ? "" : "s"} for this session so far. ` +
        `This chart fills in as new snapshots arrive every 5 minutes.`;
      note.hidden = false;
    }
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
    const play = (id) => { const r = replay.get(id); if (r && r.opt && !calm) { r.chart.clear(); r.chart.setOption(r.opt); } };
    GA.zoom.init(document.querySelector('[data-monitor="hero"]'), { onEnter: () => play("hero"), onExit: () => play("hero") });
    GA.zoom.init(document.querySelector('[data-monitor="story"]'), {
      onEnter: () => play(current),
      onExit: () => play(current),
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
