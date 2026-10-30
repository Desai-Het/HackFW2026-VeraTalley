"use client";

import { useEffect, useId, useState } from "react";

// Keep in sync with the inline script in app/layout.tsx, which sets data-theme before paint.
const STORAGE_KEY = "veratally-theme";

type Theme = "dark" | "light";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Dark/light switch styled as one block in a chain: the hexagon flips like a coin between a
 *  moon and a sun face, and the two small nodes beside it pulse gently, as if still linked to the
 *  rest of the chain. Dark is VeraTally's default (set by app/layout.tsx's inline script, not the
 *  OS theme) - this only ever overrides it for a viewer who asks, and remembers that choice. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const maskId = useId();

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function toggle() {
    if (theme === null) return;
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing or storage disabled - the toggle still works, it just won't be
      // remembered next visit.
    }
  }

  // Unknown until mounted - the server can't see localStorage - so hold the layout's place
  // rather than guess and risk a flash of the wrong icon.
  if (theme === null) {
    return <span className="theme-toggle theme-toggle-placeholder" aria-hidden="true" />;
  }

  const isLight = theme === "light";

  return (
    <button
      type="button"
      className="theme-toggle"
      data-mode={theme}
      onClick={toggle}
      aria-pressed={isLight}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      >
        <span className="theme-toggle-node theme-toggle-node-left" aria-hidden="true" />
      <span className="theme-toggle-block" aria-hidden="true">
        <svg viewBox="0 0 28 28" className="theme-toggle-hex">
          <polygon points="14,1.5 25,7.75 25,20.25 14,26.5 3,20.25 3,7.75" className="theme-toggle-hex-shape" />
        </svg>
        <svg viewBox="0 0 28 28" className="theme-toggle-icon theme-toggle-icon-moon">
          {/* The outer disc is centered on (14,14), the hexagon's exact center, same as the sun's
              circle below - the cutout circle is what's offset, to form the crescent. */}
          <mask id={maskId}>
            {/* Inline styles, not just fill="...", so the parent's inherited `fill: var(--accent)`
                (set below for the crescent itself) can never bleed into the mask's own
                black/white luminance and silently break the cutout. */}
            <rect x="0" y="0" width="28" height="28" style={{ fill: "#ffffff" }} />
            <circle cx="17.2" cy="10.6" r="5.3" style={{ fill: "#000000" }} />
          </mask>
          <circle cx="14" cy="14" r="6.1" mask={`url(#${maskId})`} />
        </svg>
        <svg viewBox="0 0 28 28" className="theme-toggle-icon theme-toggle-icon-sun">
          <circle cx="14" cy="14" r="4.2" />
          <g className="theme-toggle-rays">
            <line x1="14" y1="3.6" x2="14" y2="6.4" />
            <line x1="14" y1="21.6" x2="14" y2="24.4" />
            <line x1="3.6" y1="14" x2="6.4" y2="14" />
            <line x1="21.6" y1="14" x2="24.4" y2="14" />
            <line x1="6.4" y1="6.4" x2="8.4" y2="8.4" />
            <line x1="19.6" y1="19.6" x2="21.6" y2="21.6" />
            <line x1="6.4" y1="21.6" x2="8.4" y2="19.6" />
            <line x1="19.6" y1="8.4" x2="21.6" y2="6.4" />
          </g>
        </svg>
      </span>
        <span className="theme-toggle-node theme-toggle-node-right" aria-hidden="true" />
    </button>
  );
}
