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

  /** SPY price (line, left axis) over net gamma (bars, right axis), regular session only. */
  function intraday(el, data) {
    // Latest session only: regular hours (09:30–16:00 ET) on the market date of the newest snapshot.
    const day = f.etDay(data.latest.market_ts_utc);
    const rth = (iso) => { const m = f.etMinutes(iso); return f.etDay(iso) === day && m >= 570 && m <= 960; };
    const gex = data.gex_series.filter((g) => rth(g.market_ts_utc));
    // Contract rule: with no price ticks, use the spot stored with each GEX snapshot.
    // Applied per session: fewer than 2 ticks today cannot draw a line.
    const ticks = (data.prices || []).filter((p) => rth(p.market_ts_utc));
    const prices = ticks.length >= 2 ? ticks : gex.map((g) => ({ market_ts_utc: g.market_ts_utc, price: g.spot }));
    const opex = new Set(gex.filter((g) => g.is_opex).map((g) => g.market_ts_utc));

    // Explicit limits: flat or tiny series otherwise collapse the axis.
    const ps = prices.map((p) => p.price);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const pStep = niceStep(Math.max(1, (hi - lo) * 1.2) / 4);
    const pMin = Math.floor(lo / pStep) * pStep - (hi === lo ? pStep : 0);
    const pMax = Math.ceil(hi / pStep) * pStep + (hi === lo ? pStep : 0);
    const gStep = niceStep(Math.max(1e8, ...gex.map((g) => Math.abs(g.total_gex))) / 1e9 / 2 * 1.1);

    const chart = init(el);
    const opt = {
      animationDuration: 420, animationEasing: "cubicOut", animationDurationUpdate: 250,
      grid: { left: 4, right: 4, top: 16, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, tooltip, {
        trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.dim, type: [2, 3] } },
        formatter(ps) {
          let html = `<div style="font-family:${C.num};font-weight:600;margin-bottom:4px">${f.hhmm(ps[0].value[0])} ET</div>`;
          ps.forEach((p) => {
            if (p.seriesName === "Price") html += row("Price", f.price(p.value[1]));
            else html += row("Net GEX", f.gex(p.value[1] * 1e9), p.value[1] < 0 ? C.put : C.call);
          });
          if (ps.some((p) => opex.has(p.value[0]))) html += `<div style="margin-top:4px;color:${C.dim}">Monthly expiry day</div>`;
          return html;
        },
      }),
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: C.grid } }, axisTick: { show: false },
        axisLabel: Object.assign({}, axisText, { formatter: (v) => f.hhmm(v), hideOverlap: true }),
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: "value",
          min: ps.length ? pMin : null, max: ps.length ? pMax : null, interval: ps.length ? pStep : null,
          axisLabel: Object.assign({}, axisText, { formatter: (v) => v.toFixed(pStep < 1 ? (pStep % 0.5 ? 2 : 1) : 0) }),
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
          data: gex.map((g) => ({
            value: [g.market_ts_utc, g.total_gex / 1e9],
            itemStyle: { color: g.total_gex < 0 ? C.put : C.call, opacity: 0.6 },
          })),
        },
        {
          name: "Price", type: "line", yAxisIndex: 0, z: 3,
          showSymbol: prices.length < 3, symbolSize: 6,
          lineStyle: { color: C.amber, width: 2 }, itemStyle: { color: C.amber },
          data: prices.map((p) => [p.market_ts_utc, p.price]),
        },
      ],
    };
    chart.setOption(opt);
    return { chart, opt, points: gex.length };
  }

  return { strike, intraday, hold };
})();
