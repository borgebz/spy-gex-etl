/* ECharts builders. Colours come from css/tokens.css.
   Canvas renderer (not SVG): hundreds of bars as SVG nodes were the main cost when charts replay or
   resize. Canvas draws at devicePixelRatio, so it stays sharp on retina screens. */
window.GA = window.GA || {};

GA.charts = (function () {
  const css = getComputedStyle(document.documentElement);
  const c = (name) => css.getPropertyValue(name).trim();
  const C = {
    amber: c("--amber"), dim: c("--amber-dim"), grid: c("--grid"),
    call: c("--call"), put: c("--put"), screen: c("--screen"),
    ui: c("--font-ui"), num: c("--font-num"),
  };
  const f = GA.fmt;

  const axisText = { color: C.dim, fontFamily: C.num, fontSize: 11 };
  const tooltip = {
    backgroundColor: "rgba(12, 11, 9, 0.96)", borderColor: C.grid, borderWidth: 1, padding: [8, 10],
    textStyle: { color: C.amber, fontFamily: C.ui, fontSize: 12 },
    extraCssText: "border-radius:8px;box-shadow:none;",
  };
  const row = (label, value, color) =>
    `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:${C.dim}">${label}</span>` +
    `<span style="font-family:${C.num};font-weight:600;color:${color || C.amber}">${value}</span></div>`;

  const stub = { setOption() {}, resize() {}, clear() {}, getDom: () => document.body, getZr: () => ({ refreshImmediately() {} }) };

  // While a monitor animates to or from full screen, charts skip resizing; they resize once at the end.
  const all = [];
  let held = false;
  // within: an element (the monitor). Only charts visible inside it are resized and painted now, in sync,
  // so a View Transition snapshot shows them at the new size. All others resize on the next frame.
  // Resize observers stay muted until that next frame, so each chart resizes exactly once per toggle.
  function hold(on, within) {
    held = on;
    if (on) return;
    if (!within) { all.forEach((c) => c.resize()); return; }
    held = true;
    const later = [];
    all.forEach((c) => {
      const el = c.getDom();
      const now = within.contains(el) && el.checkVisibility && el.checkVisibility({ visibilityProperty: true });
      if (now) { c.resize(); c.getZr().refreshImmediately(); } else later.push(c);
    });
    requestAnimationFrame(() => { held = false; later.forEach((c) => c.resize()); });
  }

  /** Round up to 1, 1.5, 2, 2.5, 3, 4 or 5 × 10^n, so axis ticks land on clean numbers. */
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const m = [1, 1.5, 2, 2.5, 3, 4, 5, 10].find((k) => k * p >= x - 1e-9);
    return m * p;
  }

  function init(el) {
    if (!window.echarts) {
      el.innerHTML = '<p class="chart-missing">Chart library did not load.</p>';
      return stub;
    }
    // No useDirtyRect: it only pays off for small partial updates; our charts animate as a whole
    // (replays, resizes), where its repaint-rect bookkeeping costs more than it saves (profiled).
    const chart = echarts.init(el, null, { renderer: "canvas" });
    // Coalesce resize bursts (window drag, layout settling) into one resize per frame.
    let raf = 0;
    new ResizeObserver(() => {
      if (held) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => chart.resize());
    }).observe(el);
    all.push(chart);
    return chart;
  }

  /**
   * Call and put gamma per strike. Calls stack up, puts stack down.
   * opts.window: ± fraction of spot shown at first. opts.range: ± fraction loaded (zoomable).
   */
  function strike(el, data, opts) {
    const o = Object.assign({ window: 0.06, range: 0.12, zoom: true, wallLabels: true }, opts);
    const { spot, call_wall, put_wall } = data.latest;
    const span = o.zoom ? o.range : o.window;
    const rows = data.strikes_latest.filter((r) => Math.abs(r.strike / spot - 1) <= span);
    const cats = rows.map((r) => f.strike(r.strike));
    const nearest = rows.reduce((a, r) => (Math.abs(r.strike - spot) < Math.abs(a.strike - spot) ? r : a), rows[0]);

    const inWindow = rows.filter((r) => Math.abs(r.strike / spot - 1) <= o.window);
    const peak = Math.max(...inWindow.map((r) => Math.max(r.call_gex, -r.put_gex))) / 1e9;
    const step = niceStep((peak * 1.25) / 2);
    const lim = step * 2;

    const label = (text, color, position) => ({
      show: o.wallLabels, position, distance: 6, formatter: text,
      color, fontFamily: C.ui, fontSize: 11, fontWeight: 500,
    });
    const bar = (r, key, color) => {
      const isWall = (key === "call_gex" && r.strike === call_wall) || (key === "put_gex" && r.strike === put_wall);
      return {
        value: r[key] / 1e9,
        itemStyle: { color, opacity: isWall ? 1 : 0.82 },
        label: isWall ? label(key === "call_gex" ? "Call wall" : "Put wall", color, key === "call_gex" ? "top" : "bottom") : undefined,
      };
    };

    const chart = init(el);
    const opt = {
      animationDuration: 420, animationEasing: "cubicOut", animationDurationUpdate: 250,
      grid: { left: 4, right: 8, top: 22, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, tooltip, {
        trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,179,71,0.06)" } },
        formatter(ps) {
          const r = rows[ps[0].dataIndex];
          return `<div style="font-weight:600;margin-bottom:4px">Strike <span style="font-family:${C.num}">${f.strike(r.strike)}</span></div>` +
            row("Calls", f.gex(r.call_gex), C.call) + row("Puts", f.gex(r.put_gex), C.put) + row("Net", f.gex(r.net_gex));
        },
      }),
      xAxis: {
        type: "category", data: cats,
        axisLine: { lineStyle: { color: C.grid } }, axisTick: { show: false },
        axisLabel: Object.assign({}, axisText, { hideOverlap: true, interval: (i, v) => +v % (o.window > 0.04 ? 10 : 5) === 0 }),
      },
      yAxis: {
        type: "value", min: -lim, max: lim, interval: step,
        axisLabel: Object.assign({}, axisText, { formatter: (v) => f.bn(v * 1e9, step < 1 ? 1 : 0) }),
        splitLine: { lineStyle: { color: C.grid, type: [2, 4] } },
      },
      dataZoom: o.zoom ? [{
        // "filter" drops bars outside the window from rendering; "none" would still draw them all.
        type: "inside", xAxisIndex: 0, filterMode: "filter", zoomOnMouseWheel: "shift", moveOnMouseWheel: false,
        startValue: inWindow.length ? f.strike(inWindow[0].strike) : undefined,
        endValue: inWindow.length ? f.strike(inWindow[inWindow.length - 1].strike) : undefined,
      }] : [],
      series: [
        {
          name: "Calls", type: "bar", stack: "gex", barCategoryGap: "28%",
          data: rows.map((r) => bar(r, "call_gex", C.call)),
          markLine: {
            silent: true, symbol: "none", animation: false,
            lineStyle: { color: C.amber, type: [4, 3], width: 1.5 },
            label: { color: C.amber, fontFamily: C.ui, fontSize: 12, fontWeight: 500, formatter: `Spot ${f.price(spot)}`, position: "end" },
            data: [{ xAxis: f.strike(nearest.strike) }],
          },
        },
        { name: "Puts", type: "bar", stack: "gex", data: rows.map((r) => bar(r, "put_gex", C.put)) },
      ],
    };
    chart.setOption(opt);
    return { chart, opt };
  }

  /* --- Sessions -------------------------------------------------------------------------------- */

  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
  const ms = (iso) => Date.parse(iso);

  /**
   * Regular-hours sessions (09:30–16:00 ET), oldest first:
   * { day, label, open, close, gex[], prices[], opex, live, lag }.
   * prices falls back to the spot stored with each GEX snapshot when a day has < 2 price ticks.
   * lag = minutes the last GEX snapshot trails the last price (CBOE delay), live session only.
   */
  function sessions(data) {
    const rth = (iso) => { const m = f.etMinutes(iso); return m >= 570 && m <= 960; };
    const byDay = new Map();
    const day = (iso) => {
      const k = f.etDay(iso);
      if (!byDay.has(k)) byDay.set(k, { day: k, gex: [], ticks: [] });
      return byDay.get(k);
    };
    data.gex_series.forEach((g) => rth(g.market_ts_utc) && day(g.market_ts_utc).gex.push(g));
    (data.prices || []).forEach((p) => rth(p.market_ts_utc) && day(p.market_ts_utc).ticks.push(p));

    const out = [...byDay.values()].filter((s) => s.gex.length).sort((a, b) => (a.day < b.day ? -1 : 1));
    out.forEach((s, i) => {
      s.prices = s.ticks.length >= 2 ? s.ticks : s.gex.map((g) => ({ market_ts_utc: g.market_ts_utc, price: g.spot }));
      const t0 = s.gex[0].market_ts_utc;
      // 09:30 ET on that date: step back from any timestamp by its ET minutes (offsets are whole hours).
      const d = new Date(t0);
      s.open = ms(t0) - ((f.etMinutes(t0) - 570) * 60 + d.getUTCSeconds()) * 1000 - d.getUTCMilliseconds();
      s.close = s.open + 390 * 60000;
      s.label = `${weekday.format(d)}, ${f.day(s.day)}`;
      s.opex = s.gex.some((g) => g.is_opex);
      const lastPrice = ms(s.prices[s.prices.length - 1].market_ts_utc);
      const lastGex = ms(s.gex[s.gex.length - 1].market_ts_utc);
      s.live = i === out.length - 1 && lastPrice < s.close - 60000;
      s.lag = s.live && s.ticks.length >= 2 ? Math.max(0, Math.round((lastPrice - lastGex) / 60000)) : 0;
      s.lastPrice = lastPrice; s.lastGex = lastGex;
    });
    return out;
  }

  /** Last GEX snapshot at or before t (as-of join), or null. */
  function gexAt(gex, t) {
    let lo = 0, hi = gex.length - 1, hit = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ms(gex[mid].market_ts_utc) <= t) { hit = gex[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return hit;
  }
  /** Price tick nearest to t. */
  function priceAt(prices, t) {
    let lo = 0, hi = prices.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ms(prices[mid].market_ts_utc) <= t) lo = mid; else hi = mid; }
    const a = prices[lo], b = prices[hi];
    return Math.abs(ms(a.market_ts_utc) - t) <= Math.abs(ms(b.market_ts_utc) - t) ? a : b;
  }

  /** Price axis with clean ticks; flat series get one step of room each side. */
  function priceAxis(ps) {
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const step = niceStep(Math.max(1, (hi - lo) * 1.2) / 4);
    return {
      min: Math.floor(lo / step) * step - (hi === lo ? step : 0),
      max: Math.ceil(hi / step) * step + (hi === lo ? step : 0),
      interval: step,
      digits: step < 1 ? (step % 0.5 ? 2 : 1) : 0,
    };
  }
  const gexAxisStep = (vals) => niceStep(Math.max(1e8, ...vals.map(Math.abs)) / 1e9 / 2 * 1.1);

  /** Shaded zone where price is known but CBOE gamma has not arrived yet. */
  function pendingArea(s, withLabel) {
    if (!s.lag) return undefined;
    return {
      silent: true,
      itemStyle: { color: "rgba(255, 179, 71, 0.07)" },
      // Above the plot, not inside it: the zone is narrow and the price line runs through it.
      label: withLabel ? {
        show: true, position: "top", distance: 2, color: C.dim, fontFamily: C.ui, fontSize: 10,
        formatter: "GEX pending",
      } : { show: false },
      data: [[{ xAxis: s.lastGex }, { xAxis: s.lastPrice }]],
    };
  }

  /** One session: price line (left axis) over net gamma bars (right axis), full 09:30–16:00 axis. */
  function dayOption(s) {
    const pa = priceAxis(s.prices.map((p) => p.price));
    const gStep = gexAxisStep(s.gex.map((g) => g.total_gex));
    const pendingFrom = s.lag ? s.lastGex + 5.5 * 60000 : Infinity;

    return {
      animationDuration: 420, animationEasing: "cubicOut", animationDurationUpdate: 250,
      grid: { left: 4, right: 4, top: 16, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, tooltip, {
        trigger: "axis",
        // snap off: the pointer follows the mouse, and the formatter joins both series at that time,
        // so price (1 min) and gamma (5 min, delayed) always show together.
        axisPointer: { type: "line", snap: false, lineStyle: { color: C.dim, type: [2, 3] } },
        formatter(ps) {
          const t = ps[0].axisValue;
          const p = priceAt(s.prices, t), g = gexAt(s.gex, t);
          let html = `<div style="font-family:${C.num};font-weight:600;margin-bottom:4px">${f.hhmm(t)} ET</div>`;
          html += row("Price", f.price(p.price));
          // Inside the pending zone gamma has not arrived yet: show price only.
          if (g && t <= pendingFrom) html += row("Net GEX", f.gex(g.total_gex), g.total_gex < 0 ? C.put : C.call);
          if (s.opex) html += `<div style="margin-top:4px;color:${C.dim}">Monthly expiry day</div>`;
          return html;
        },
      }),
      xAxis: {
        type: "time", min: s.open, max: s.close, minInterval: 3600000, // ECharts thins ticks on narrow screens
        axisLine: { lineStyle: { color: C.grid } }, axisTick: { show: false },
        // Bars pad the axis by a minute or two; hide those odd edge ticks (09:28, 16:01).
        axisLabel: Object.assign({}, axisText, { formatter: (v) => f.hhmm(v), hideOverlap: true, showMinLabel: false, showMaxLabel: false }),
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: "value", min: pa.min, max: pa.max, interval: pa.interval,
          axisLabel: Object.assign({}, axisText, { formatter: (v) => v.toFixed(pa.digits) }),
          splitLine: { lineStyle: { color: C.grid, type: [2, 4] } },
        },
        {
          type: "value", min: -gStep * 2, max: gStep * 2, interval: gStep,
          axisLabel: Object.assign({}, axisText, { formatter: (v) => f.bn(v * 1e9, gStep < 1 ? 1 : 0) }),
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Net GEX", type: "bar", yAxisIndex: 1, barMaxWidth: 10,
          data: s.gex.map((g) => ({
            value: [ms(g.market_ts_utc), g.total_gex / 1e9],
            itemStyle: { color: g.total_gex < 0 ? C.put : C.call, opacity: 0.6 },
          })),
        },
        {
          name: "Price", type: "line", yAxisIndex: 0, z: 3,
          showSymbol: s.prices.length < 3, symbolSize: 6,
          lineStyle: { color: C.amber, width: 2 }, itemStyle: { color: C.amber },
          data: s.prices.map((p) => [ms(p.market_ts_utc), p.price]),
          markArea: pendingArea(s, true),
        },
      ],
    };
  }

  /** Last N sessions: closing net gamma (bars) and closing price (line). Click a bar to open the day. */
  function multiOption(S) {
    const close = S.map((s) => ({ g: s.gex[s.gex.length - 1], p: s.prices[s.prices.length - 1] }));
    const pa = priceAxis(close.map((c) => c.p.price));
    const gStep = gexAxisStep(close.map((c) => c.g.total_gex));
    const tag = (s) => (s.live ? "live" : s.opex ? "OPEX" : "");
    return {
      animationDuration: 420, animationEasing: "cubicOut", animationDurationUpdate: 250,
      grid: { left: 4, right: 4, top: 16, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, tooltip, {
        trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,179,71,0.06)" } },
        formatter(ps) {
          const i = ps[0].dataIndex, s = S[i], c = close[i];
          let html = `<div style="font-family:${C.num};font-weight:600;margin-bottom:4px">${s.label}${tag(s) ? " · " + tag(s) : ""}</div>`;
          html += row(s.live ? "Price now" : "Close", f.price(c.p.price));
          html += row("Net GEX", f.gex(c.g.total_gex), c.g.total_gex < 0 ? C.put : C.call);
          return html;
        },
      }),
      xAxis: {
        type: "category", data: S.map((s) => s.day),
        axisLine: { lineStyle: { color: C.grid } }, axisTick: { show: false },
        axisLabel: Object.assign({}, axisText, {
          interval: 0, lineHeight: 14,
          formatter: (v, i) => f.day(v).replace(/^\w+ /, "") + (tag(S[i]) ? `\n{tag|${tag(S[i])}}` : "\n "),
          rich: { tag: { color: C.amber, fontFamily: C.ui, fontSize: 10 } },
        }),
      },
      yAxis: [
        {
          type: "value", min: pa.min, max: pa.max, interval: pa.interval,
          axisLabel: Object.assign({}, axisText, { formatter: (v) => v.toFixed(pa.digits) }),
          splitLine: { lineStyle: { color: C.grid, type: [2, 4] } },
        },
        {
          type: "value", min: -gStep * 2, max: gStep * 2, interval: gStep,
          axisLabel: Object.assign({}, axisText, { formatter: (v) => f.bn(v * 1e9, gStep < 1 ? 1 : 0) }),
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Net GEX", type: "bar", yAxisIndex: 1, barMaxWidth: 26, cursor: "pointer",
          data: close.map((c, i) => ({
            value: c.g.total_gex / 1e9,
            itemStyle: {
              color: c.g.total_gex < 0 ? C.put : C.call, opacity: S[i].live ? 0.4 : 0.7,
              borderColor: S[i].opex ? C.amber : "transparent", borderWidth: S[i].opex ? 1 : 0,
            },
          })),
        },
        {
          name: "Price", type: "line", yAxisIndex: 0, z: 3, symbol: "circle", symbolSize: 5,
          lineStyle: { color: C.amber, width: 2 }, itemStyle: { color: C.amber },
          data: close.map((c) => c.p.price),
        },
      ],
    };
  }

  /**
   * Price and gamma, with a view switch. view = session index or "10d".
   * Returns a controller; .opt always holds the current option (used for screen replays).
   */
  function intraday(el, data, opts = {}) {
    const S = sessions(data);
    const chart = init(el);
    const ctl = {
      chart, opt: null, sessions: S, view: S.length - 1,
      points: S.length ? S[S.length - 1].gex.length : 0,
      show(view) {
        if (!S.length) return;
        ctl.view = view;
        ctl.opt = view === "10d" ? multiOption(S) : dayOption(S[view]);
        chart.clear();
        chart.setOption(ctl.opt);
        opts.onView && opts.onView(view, S);
      },
    };
    chart.on("click", (p) => { if (ctl.view === "10d" && p.dataIndex != null) ctl.show(p.dataIndex); });
    ctl.show(ctl.view);
    return ctl;
  }

  /** Hero sparkline: the latest session, price over faint net gamma bars, no axes. */
  function spark(el, data) {
    const S = sessions(data);
    const chart = init(el);
    if (!S.length) return { chart, opt: null };
    const s = S[S.length - 1];
    const o = dayOption(s);
    o.grid = { left: 0, right: 20, top: 22, bottom: 18, containLabel: false }; // right: room for the 16:00 label
    o.xAxis.axisLine.show = false;
    o.xAxis.axisLabel = Object.assign({}, o.xAxis.axisLabel, { margin: 6 });
    o.yAxis.forEach((y) => { y.axisLabel = { show: false }; y.splitLine = { show: false }; });
    o.yAxis[1].splitLine = { show: true, lineStyle: { color: C.grid, type: [2, 4] } }; // zero line for GEX
    o.yAxis[1].interval = o.yAxis[1].max;
    o.series[0].data.forEach((d) => (d.itemStyle.opacity = 0.45));
    o.series[1].lineStyle.width = 1.6;
    o.series[1].markArea = pendingArea(s, false);
    // End-of-line marker on the latest price.
    const last = s.prices[s.prices.length - 1];
    o.series[1].markPoint = {
      silent: true, symbol: "circle", symbolSize: 7, itemStyle: { color: C.amber },
      label: { show: true, position: "top", distance: 6, color: C.amber, fontFamily: C.num, fontSize: 11, formatter: f.price(last.price) },
      data: [{ coord: [ms(last.market_ts_utc), last.price] }],
    };
    chart.setOption(o);
    return { chart, opt: o, session: s };
  }

  return { strike, intraday, spark, sessions, hold };
})();
