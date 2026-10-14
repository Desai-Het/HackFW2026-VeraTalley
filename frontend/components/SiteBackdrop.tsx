"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import * as THREE from "three";
import { clamp, createStage, damp, rand, type Palette } from "./three/stage";

/** A quiet 3D backdrop for the whole site: a few dozen thin "ballot" slabs floating behind the
 *  page. Each page asks for a different arrangement and the slabs glide there when you navigate:
 *  a rising spiral on the landing page, drifting sheets on most pages, and tidy columns - like a
 *  recount - on the verify and check pages. Purely decorative and kept faint so text stays easy
 *  to read. */

type Mode = "home" | "drift" | "columns" | "stack";

const COUNT = 36;
const SLAB = new THREE.BoxGeometry(1.7, 0.07, 1.15);

function modeFor(path: string): Mode {
  if (path === "/") return "home";
  if (/\/(verify|live)$/.test(path) || path.startsWith("/check")) return "columns";
  if (/\/vote$/.test(path)) return "stack";
  return "drift";
}

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };

/** Where slab `i` of COUNT sits in a given mode, before the aspect-ratio squeeze on x. */
function pose(mode: Mode, i: number): Pose {
  const r1 = rand(i + 1);
  const r2 = rand(i + 101);
  const r3 = rand(i + 211);
  const side = i % 2 === 0 ? -1 : 1;
  switch (mode) {
    case "home": {
      // A slow spiral staircase, like blocks being added to a chain.
      const a = i * 0.62;
      return { x: Math.cos(a) * 7.2, y: (i - COUNT / 2) * 0.55, z: Math.sin(a) * 4.2 - 3, rx: 0, ry: -a, rz: 0 };
    }
    case "columns": {
      // Stacks of slabs standing in columns at the edges - a tally being counted.
      const col = i % 6;
      const level = Math.floor(i / 6);
      const xs = [-10.6, -8.6, -6.6, 6.6, 8.6, 10.6];
      return { x: xs[col], y: -4.4 + level * 0.78 + (col % 3) * 0.2, z: -4 + (col % 3) * 0.8, rx: 0, ry: (r1 - 0.5) * 0.35, rz: 0 };
    }
    case "stack": {
      // Sheets fanned toward the middle-bottom, as if dropping into a box.
      const t = i / COUNT;
      return { x: side * (5.2 + r1 * 4.5), y: 3.6 - t * 8.2, z: -2.5 - r2 * 3, rx: 0.5 + r3 * 0.5, ry: side * (0.5 + r1), rz: side * 0.25 };
    }
    default:
      return { x: side * (5.4 + r1 * 5.8), y: (r2 - 0.5) * 11, z: -6 + r3 * 5, rx: (r3 - 0.5) * 1.6, ry: (r1 - 0.5) * 2.4, rz: (r2 - 0.5) * 0.9 };
  }
}

export default function SiteBackdrop() {
  const hostRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname() || "/";
  const modeRef = useRef<Mode>(modeFor(pathname));
  const snapRef = useRef<(() => void) | null>(null);

  // Route change: just retarget; the loop glides the slabs there.
  useEffect(() => {
    modeRef.current = modeFor(pathname);
    snapRef.current?.(); // only does anything when motion is reduced (no loop to animate it)
  }, [pathname]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = createStage(host, { fov: 42, maxDpr: 1.5 });
    if (!stage) return;
    const { scene, camera } = stage;

    const fillMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12, depthWrite: false });
    const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
    const edgeGeo = new THREE.EdgesGeometry(SLAB);
    const accentFillMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false });
    const accentEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });

    const slabs: { g: THREE.Group; cur: Pose; phase: number; accent: boolean }[] = [];
    for (let i = 0; i < COUNT; i++) {
      const accent = i % 7 === 3; // a few slabs carry the accent colour: "the counted ones"
      const g = new THREE.Group();
      g.add(new THREE.Mesh(SLAB, accent ? accentFillMat : fillMat));
      g.add(new THREE.LineSegments(edgeGeo, accent ? accentEdgeMat : edgeMat));
      scene.add(g);
      const p = pose(modeRef.current, i);
      slabs.push({ g, cur: { ...p }, phase: rand(i + 7) * Math.PI * 2, accent });
    }

    // Fine dust for depth.
    const dustN = 140;
    const dustPos = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      dustPos[i * 3] = (rand(i + 5) - 0.5) * 30;
      dustPos[i * 3 + 1] = (rand(i + 55) - 0.5) * 16;
      dustPos[i * 3 + 2] = -10 + rand(i + 95) * 12;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ size: 0.05, transparent: true, opacity: 0.5, depthWrite: false });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    camera.position.set(0, 0, 14);

    stage.onTheme((p: Palette) => {
      fillMat.color.copy(p.dark ? p.accent : p.line);
      fillMat.opacity = p.dark ? 0.1 : 0.2;
      edgeMat.color.copy(p.dark ? p.line : p.muted);
      edgeMat.opacity = p.dark ? 0.55 : 0.4;
      accentFillMat.color.copy(p.accent);
      accentFillMat.opacity = p.dark ? 0.22 : 0.2;
      accentEdgeMat.color.copy(p.accent);
      dustMat.color.copy(p.dark ? p.accent : p.muted);
      dustMat.opacity = p.dark ? 0.5 : 0.35;
      scene.fog = new THREE.Fog(p.bg, 12, 30);
    });

    // Pointer and scroll nudge the camera a little, so the scene feels attached to the page.
    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const apply = (dt: number, t: number, snap: boolean) => {
      const mode = modeRef.current;
      const aspect = camera.aspect;
      const squeeze = clamp(aspect / 1.75, 0.5, 1.15);
      const scroll = typeof window !== "undefined" ? window.scrollY : 0;
      const spin = mode === "home" ? t * 0.12 : 0;
      slabs.forEach((s, i) => {
        const base = pose(mode, i);
        // Home spiral turns slowly; everything else bobs gently.
        const target: Pose =
          mode === "home"
            ? {
                x: Math.cos(i * 0.62 + spin) * 7.2 * squeeze,
                y: base.y,
                z: Math.sin(i * 0.62 + spin) * 4.2 - 3,
                rx: 0,
                ry: -(i * 0.62 + spin),
                rz: 0,
              }
            : { ...base, x: base.x * squeeze, y: base.y + Math.sin(t * 0.5 + s.phase) * 0.18 };
        const k = snap ? 1000 : 2.2;
        s.cur.x = damp(s.cur.x, target.x, k, dt);
        s.cur.y = damp(s.cur.y, target.y, k, dt);
        s.cur.z = damp(s.cur.z, target.z, k, dt);
        s.cur.rx = damp(s.cur.rx, target.rx, k, dt);
        s.cur.ry = damp(s.cur.ry, target.ry + (mode === "drift" ? Math.sin(t * 0.25 + s.phase) * 0.15 : 0), k, dt);
        s.cur.rz = damp(s.cur.rz, target.rz, k, dt);
        s.g.position.set(s.cur.x, s.cur.y, s.cur.z);
        s.g.rotation.set(s.cur.rx, s.cur.ry, s.cur.rz);
      });
      dust.rotation.y = t * 0.01;
      const cx = pointer.x * 0.7;
      const cy = -pointer.y * 0.5 - scroll * 0.0016;
      camera.position.x = damp(camera.position.x, cx, 2, dt || 0.016);
      camera.position.y = damp(camera.position.y, cy, 2, dt || 0.016);
      camera.lookAt(0, 0, 0);
    };

    stage.run((t, dt) => apply(dt || 0.016, t, stage.reduced));
    if (stage.reduced) {
      snapRef.current = () => {
        apply(0.016, 3.2, true);
        stage.render();
      };
      window.addEventListener("scroll", snapRef.current, { passive: true });
    }

    return () => {
      window.removeEventListener("pointermove", onMove);
      if (snapRef.current) window.removeEventListener("scroll", snapRef.current);
      snapRef.current = null;
      stage.dispose();
      edgeGeo.dispose();
      fillMat.dispose();
      edgeMat.dispose();
      accentFillMat.dispose();
      accentEdgeMat.dispose();
    };
  }, []);

  return <div ref={hostRef} className="site-backdrop" aria-hidden="true" />;
}
