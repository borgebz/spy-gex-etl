/* Full screen for a monitor, driven by the macOS traffic lights.
   The real DOM switches state once: the monitor leaves a same-size placeholder in the page and goes
   position:fixed at the centre, at full size. The motion is done by the browser:
   - View Transitions (Chrome, Edge, Safari 18+): the browser snapshots the monitor before and after and
     animates the two images on the GPU. No layout or paint per frame, all effects stay on.
   - Fallback (Firefox): animate the real box (left/top/width/height) with heavy effects switched off.
   Reduce motion: a short fade. */
window.GA = window.GA || {};

GA.zoom = (function () {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canVT = typeof document.startViewTransition === "function";
  const body = document.body;
  const backdrop = document.createElement("div");
  backdrop.className = "zoom-backdrop";
  body.appendChild(backdrop);

  let active = null; // { m, ghost, host, opts }
  let busy = false;  // ignore clicks while a transition runs

  const px = (r) => ({ left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });

  /** The full-screen box: centred, a margin all round, not wider than 1.75 × its height. */
  function target() {
    const pad = innerWidth < 700 ? 10 : 28;
    const height = innerHeight - pad * 2;
    const width = Math.min(innerWidth - pad * 2, height * 1.75, 1680);
    return { left: (innerWidth - width) / 2, top: (innerHeight - height) / 2, width, height };
  }

  function setButtons(m, on) {
    const zoom = m.querySelector('[data-tl="zoom"]');
    const label = on ? "Exit full screen" : "Enter full screen";
    zoom.setAttribute("aria-pressed", String(on));
    zoom.setAttribute("aria-label", label);
    zoom.title = label;
    m.querySelectorAll('[data-tl="exit"]').forEach((b) => (b.tabIndex = on ? 0 : -1));
  }

  /* --- the two DOM states ------------------------------------------------------------------ */

  function toFull(m, opts) {
    const first = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    const ghost = document.createElement("div");
    ghost.className = "monitor-ghost";
    Object.assign(ghost.style, {
      width: first.width + "px", height: first.height + "px", flex: "none",
      marginTop: cs.marginTop, marginLeft: cs.marginLeft, marginRight: cs.marginRight,
    });
    m.before(ghost);
    const host = m.parentElement;
    host.classList.add("zoom-host");
    m.classList.add("is-full");
    Object.assign(m.style, px(target()));
    body.classList.add("zoom-lock");
    backdrop.classList.add("is-on");
    setButtons(m, true);
    active = { m, ghost, host, opts };
    return first;
  }

  function toPage() {
    const { m, ghost, host, opts } = active;
    active = null;
    m.classList.remove("is-full", "is-animating");
    m.removeAttribute("style");
    ghost.remove();
    host.classList.remove("zoom-host");
    body.classList.remove("zoom-lock");
    backdrop.classList.remove("is-on");
    setButtons(m, false);
    opts.beforeExit && opts.beforeExit();
    return { m, opts };
  }

  /** Run a state change as a View Transition of this monitor; resolves when the motion ends. */
  // Kept off the critical path (the time between the click and the first frame of motion):
  // - only the monitor is captured (CSS opts the page root out), the dim behind it is a live CSS fade;
  // - the new state is captured "lite": no halo or big shadows (smaller snapshot) and no chart, so
  //   nothing is drawn before the motion starts. Charts are drawn once at the final size afterwards.
  function viewTransition(m, change, dir) {
    const root = document.documentElement;
    root.dataset.vt = dir;            // CSS sizes the snapshots per direction
    GA.charts.hold(true);             // mute resize observers until the motion ends
    m.style.viewTransitionName = "ga-monitor";
    const vt = document.startViewTransition(() => {
      change();
      m.style.viewTransitionName = "ga-monitor"; // toPage() cleared inline styles
      m.classList.add("vt-lite");
    });
    return vt.finished.finally(() => {
      m.style.viewTransitionName = "";
      delete root.dataset.vt;
      GA.charts.hold(false);                     // one resize per chart, at the final size
      requestAnimationFrame(() => m.classList.remove("vt-lite")); // chart fades in on the next frame
    });
  }

  /* --- enter / exit ------------------------------------------------------------------------- */

  function enter(m, opts) {
    if (active || busy) return;
    busy = true;
    const done = () => {
      busy = false;
      m.classList.remove("is-animating");
      if (!canVT || calm) GA.charts.hold(false);
      opts.onEnter && opts.onEnter();
      m.querySelector('[data-tl="zoom"]').focus({ preventScroll: true });
    };

    if (calm) {
      toFull(m, opts);
      m.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }).finished.then(done);
    } else if (canVT) {
      viewTransition(m, () => toFull(m, opts), "enter").then(done);
    } else {
      GA.charts.hold(true);
      const first = toFull(m, opts);
      m.classList.add("is-animating");
      m.animate([px(first), px(target())], { duration: 520, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }).finished.then(done);
    }
  }

  function exit() {
    if (!active || busy) return;
    busy = true;
    const { m } = active;
    const finish = (opts) => {
      busy = false;
      if (!canVT || calm) GA.charts.hold(false);
      opts.onExit && opts.onExit();
      m.querySelector('[data-tl="zoom"]').focus({ preventScroll: true });
    };

    if (calm) {
      const { opts } = toPage();
      m.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" }).finished.then(() => finish(opts));
    } else if (canVT) {
      let opts;
      viewTransition(m, () => { opts = toPage().opts; }, "exit").then(() => finish(opts));
    } else {
      const first = m.getBoundingClientRect();
      const ghostRect = () => active.ghost.getBoundingClientRect();
      active.opts.beforeExit && active.opts.beforeExit();
      const last = ghostRect();
      GA.charts.hold(true);
      m.classList.add("is-animating");
      backdrop.classList.remove("is-on");
      const anim = m.animate([px(first), px(last)], { duration: 420, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
      anim.finished.then(() => {
        const opts = active.opts;
        active.opts = Object.assign({}, opts, { beforeExit: null }); // already scrolled
        toPage();
        anim.cancel();
        finish(opts);
      });
    }
  }

  backdrop.addEventListener("click", exit);
  addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape") { e.preventDefault(); exit(); }
    else if (active.opts.onKey && !busy) active.opts.onKey(e);
  });
  addEventListener("resize", () => { if (active) Object.assign(active.m.style, px(target())); });

  function init(m, opts = {}) {
    if (!m) return;
    m.querySelector('[data-tl="zoom"]').addEventListener("click", () => (active ? exit() : enter(m, opts)));
    m.querySelectorAll('[data-tl="exit"]').forEach((b) => b.addEventListener("click", () => active && exit()));
  }

  return { init, exit, isActive: () => !!active };
})();
