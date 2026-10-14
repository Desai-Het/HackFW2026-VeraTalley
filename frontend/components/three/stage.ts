import * as THREE from "three";

/** Shared plumbing for the site's small WebGL scenes: renderer, resize, pause when off-screen or
 *  in a background tab, a single still frame for people who asked for reduced motion, and a
 *  palette that follows the page's light/dark colours. Everything is decorative, so a browser
 *  without WebGL simply gets no scene (createStage returns null). */

export type Palette = {
  dark: boolean;
  accent: THREE.Color;
  accentSoft: THREE.Color;
  bg: THREE.Color;
  surface: THREE.Color;
  line: THREE.Color;
  text: THREE.Color;
  muted: THREE.Color;
};

function cssColor(cs: CSSStyleDeclaration, name: string, fallback: string): THREE.Color {
  const raw = cs.getPropertyValue(name).trim() || fallback;
  try {
    return new THREE.Color(raw);
  } catch {
    return new THREE.Color(fallback);
  }
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  return {
    dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    accent: cssColor(cs, "--accent", "#17695a"),
    accentSoft: cssColor(cs, "--accent-soft", "#e3f0ec"),
    bg: cssColor(cs, "--bg", "#fafaf8"),
    surface: cssColor(cs, "--surface", "#ffffff"),
    line: cssColor(cs, "--line-strong", "#cfcfc7"),
    text: cssColor(cs, "--text", "#191a18"),
    muted: cssColor(cs, "--muted", "#666862"),
  };
}

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  reduced: boolean;
  /** Draws one frame now (used for the still frame and after a resize while paused). */
  render: () => void;
  /** Starts the loop. `update` gets seconds since start and seconds since the last frame. */
  run: (update: (t: number, dt: number) => void) => void;
  /** Called now and whenever the light/dark scheme changes. */
  onTheme: (cb: (p: Palette) => void) => void;
  dispose: () => void;
};

type Options = { fov?: number; alpha?: boolean; maxDpr?: number; near?: number; far?: number };

export function createStage(host: HTMLElement, opts: Options = {}): Stage | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: opts.alpha ?? true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  const maxDpr = opts.maxDpr ?? 1.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  if (opts.alpha ?? true) renderer.setClearColor(0x000000, 0);
  const el = renderer.domElement;
  el.setAttribute("aria-hidden", "true");
  el.style.display = "block";
  el.style.width = "100%";
  el.style.height = "100%";
  host.appendChild(el);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 40, 1, opts.near ?? 0.1, opts.far ?? 120);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let raf = 0;
  let visible = true;
  let running = false;
  let updateFn: ((t: number, dt: number) => void) | null = null;
  let last = 0;
  let clock = 0;

  const resize = () => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(() => {
    resize();
    if (!running || reduced) render();
  });
  ro.observe(host);

  function render() {
    renderer.render(scene, camera);
  }

  const frame = (now: number) => {
    raf = 0;
    if (!running) return;
    const dt = Math.min((now - last) / 1000 || 0.016, 0.05);
    last = now;
    clock += dt;
    updateFn?.(clock, dt);
    render();
    schedule();
  };
  const schedule = () => {
    if (!raf && running && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) {
      last = performance.now();
      schedule();
    }
  });
  io.observe(host);
  const onVis = () => {
    if (!document.hidden) {
      last = performance.now();
      schedule();
    }
  };
  document.addEventListener("visibilitychange", onVis);

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  let themeCb: ((p: Palette) => void) | null = null;
  const onScheme = () => {
    themeCb?.(readPalette());
    if (!running || reduced) render();
  };
  mq.addEventListener("change", onScheme);

  return {
    renderer,
    scene,
    camera,
    reduced,
    render,
    run(update) {
      updateFn = update;
      if (reduced) {
        update(3.2, 0); // one settled frame, no animation
        render();
        return;
      }
      running = true;
      last = performance.now();
      schedule();
    },
    onTheme(cb) {
      themeCb = cb;
      cb(readPalette());
    },
    dispose() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onScheme);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      el.remove();
    },
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const damp = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));
export const easeOutCubic = (q: number) => 1 - Math.pow(1 - q, 3);
export const easeInOut = (q: number) => (q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2);

/** Deterministic pseudo-random in [0,1) so a given slab always lands in the same place. */
export function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
