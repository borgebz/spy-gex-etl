/* Full screen for a monitor, driven by the macOS traffic lights.
   Enter: the monitor leaves a same-size placeholder in the page, goes position:fixed and animates its
   real box (left/top/width/height) to the centre of the window. Animating the box, not a transform,
   keeps text and charts sharp: they reflow instead of stretching. Exit runs the same path back. */
window.GA = window.GA || {};

GA.zoom = (function () {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const backdrop = document.createElement("div");
  backdrop.className = "zoom-backdrop";
  document.body.appendChild(backdrop);

  let active = null; // { m, ghost, host, opts }

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

  function enter(m, opts) {
    if (active) return;
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

    GA.charts.hold(true);
    const last = target();
    m.classList.add("is-full");
    Object.assign(m.style, px(last));
    root.classList.add("zoom-lock");
    backdrop.classList.add("is-on");
    setButtons(m, true);
    active = { m, ghost, host, opts };

    const done = () => {
      m.classList.remove("is-animating");
      GA.charts.hold(false);
      opts.onEnter && opts.onEnter();
      m.querySelector('[data-tl="zoom"]').focus({ preventScroll: true });
    };
    m.classList.add("is-animating");
    const anim = calm
      ? m.animate([{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "ease-out" })
      : m.animate([px(first), px(last)], { duration: 520, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    anim.finished.then(done);
  }

  function exit() {
    if (!active) return;
    const { m, ghost, host, opts } = active;
    active = null;
    const first = m.getBoundingClientRect();
    backdrop.classList.remove("is-on");
    root.classList.remove("zoom-lock");
    opts.beforeExit && opts.beforeExit();
    const last = ghost.getBoundingClientRect();
    GA.charts.hold(true);
    setButtons(m, false);

    const finish = () => {
      m.classList.remove("is-full", "is-animating");
      m.removeAttribute("style");
      ghost.remove();
      host.classList.remove("zoom-host");
      GA.charts.hold(false);
      opts.onExit && opts.onExit();
      m.querySelector('[data-tl="zoom"]').focus({ preventScroll: true });
    };
    m.classList.add("is-animating");
    const anim = calm
      ? m.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" })
      : m.animate([px(first), px(last)], { duration: 420, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
    anim.finished.then(() => { finish(); anim.cancel(); });
  }

  backdrop.addEventListener("click", exit);
  addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape") { e.preventDefault(); exit(); }
    else if (active.opts.onKey) active.opts.onKey(e);
  });
  addEventListener("resize", () => { if (active) Object.assign(active.m.style, px(target())); });

  function init(m, opts = {}) {
    if (!m) return;
    m.querySelector('[data-tl="zoom"]').addEventListener("click", () => (active ? exit() : enter(m, opts)));
    m.querySelectorAll('[data-tl="exit"]').forEach((b) => b.addEventListener("click", () => active && exit()));
  }

  return { init, exit, isActive: () => !!active };
})();
