"use client";

import { useEffect } from "react";

/** Gives every element marked `data-tilt` a gentle 3D lean toward the pointer, with a soft
 *  light that follows it. One delegated listener for the whole site, no per-card code. Skipped
 *  for touch input and for people who asked for reduced motion. */
export default function TiltEffect() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let active: HTMLElement | null = null;
    let raf = 0;

    const reset = (el: HTMLElement) => {
      el.style.removeProperty("--tilt-x");
      el.style.removeProperty("--tilt-y");
      el.removeAttribute("data-tilting");
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.("[data-tilt]") as HTMLElement | null;
      if (active && active !== el) reset(active);
      active = el;
      if (!el) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const max = Number(el.dataset.tilt) || 6;
        el.style.setProperty("--tilt-x", `${((0.5 - py) * max).toFixed(2)}deg`);
        el.style.setProperty("--tilt-y", `${((px - 0.5) * max).toFixed(2)}deg`);
        el.style.setProperty("--glow-x", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--glow-y", `${(py * 100).toFixed(1)}%`);
        el.setAttribute("data-tilting", "");
      });
    };
    const onLeave = () => {
      if (active) reset(active);
      active = null;
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
