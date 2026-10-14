"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { clamp, createStage, easeInOut, easeOutCubic, type Palette } from "./three/stage";

/** The landing page's centrepiece: a chain of blocks (the public record), a ballot slab that
 *  drops into the newest one, and a pulse that runs back down the chain as each block confirms
 *  the one before it. Drag or move the pointer to turn it. */

const BLOCKS = 5;
const GAP = 2.45;
const BLOCK = new THREE.BoxGeometry(1.9, 1.3, 1.9);
const SLAB = new THREE.BoxGeometry(1.5, 0.07, 1.0);
const LINK = new THREE.BoxGeometry(GAP - 1.9 + 0.1, 0.12, 0.12);

const CYCLE = 7.2; // seconds per vote

export default function HeroLedger() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = createStage(host, { fov: 34, maxDpr: 2 });
    if (!stage) {
      host.classList.add("no-webgl");
      return;
    }
    const { scene, camera } = stage;

    const root = new THREE.Group();
    scene.add(root);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x445550, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 8, 6);
    scene.add(hemi, key);

    const blockMats: THREE.MeshStandardMaterial[] = [];
    const edgeMats: THREE.LineBasicMaterial[] = [];
    const blocks: THREE.Group[] = [];
    const edgeGeo = new THREE.EdgesGeometry(BLOCK);
    for (let i = 0; i < BLOCKS; i++) {
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.9, emissiveIntensity: 0 });
      const e = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
      g.add(new THREE.Mesh(BLOCK, m), new THREE.LineSegments(edgeGeo, e));
      // A small "hash stripe" on the front face so each block reads as data, not just a box.
      g.position.set((i - (BLOCKS - 1) / 2) * GAP, 0, 0);
      root.add(g);
      blocks.push(g);
      blockMats.push(m);
      edgeMats.push(e);
    }
    const linkMats: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < BLOCKS - 1; i++) {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 0.1 });
      const l = new THREE.Mesh(LINK, m);
      l.position.set((i - (BLOCKS - 1) / 2 + 0.5) * GAP, 0, 0);
      root.add(l);
      linkMats.push(m);
    }

    // Stripes: three thin bars per block on the top face.
    const stripeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35 });
    const stripeGeo = new THREE.BoxGeometry(1.3, 0.02, 0.1);
    blocks.forEach((b) => {
      for (let k = 0; k < 3; k++) {
        const s = new THREE.Mesh(stripeGeo, stripeMat);
        s.position.set(0, 0.66, -0.45 + k * 0.45);
        b.add(s);
      }
    });

    const slabMat = new THREE.MeshStandardMaterial({ roughness: 0.5, emissiveIntensity: 0.15 });
    const slabEdgeMat = new THREE.LineBasicMaterial({});
    const slab = new THREE.Group();
    slab.add(new THREE.Mesh(SLAB, slabMat), new THREE.LineSegments(new THREE.EdgesGeometry(SLAB), slabEdgeMat));
    root.add(slab);

    // Floor ring that pulses outwards when a vote lands.
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.0, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.7;
    root.add(ring);

    // Floor grid.
    const grid = new THREE.GridHelper(30, 30, 0x000000, 0x000000);
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.18;
    grid.position.y = -0.75;
    root.add(grid);

    let pal: Palette | null = null;
    stage.onTheme((p) => {
      pal = p;
      blocks.forEach((_, i) => {
        blockMats[i].color.copy(p.dark ? p.surface : p.accentSoft).lerp(p.accent, p.dark ? 0.12 : 0.1);
        blockMats[i].emissive.copy(p.accent);
        edgeMats[i].color.copy(p.accent);
      });
      linkMats.forEach((m) => {
        m.color.copy(p.accent);
        m.emissive.copy(p.accent);
      });
      stripeMat.color.copy(p.accent);
      slabMat.color.copy(p.dark ? p.text : p.surface);
      slabMat.emissive.copy(p.accent);
      slabEdgeMat.color.copy(p.accent);
      ringMat.color.copy(p.accent);
      gridMat.color.copy(p.dark ? p.line : p.muted);
      hemi.color.set(p.dark ? 0x9fb8b0 : 0xffffff);
      hemi.groundColor.set(p.dark ? 0x0a0f0d : 0xc6d4ce);
      hemi.intensity = p.dark ? 0.9 : 1.5;
    });

    // View: drag to turn, pointer to tilt, slow idle sway.
    let yaw = -0.95;
    let pitch = 0.36;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let idle = 0;
    const pointer = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      host.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.008;
      pitch = clamp(pitch + (e.clientY - lastY) * 0.005, 0.1, 0.95);
      lastX = e.clientX;
      lastY = e.clientY;
      if (stage.reduced) stage.render();
    };
    const onUp = () => {
      dragging = false;
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);

    const newest = BLOCKS - 1;
    const update = (t: number, dt: number) => {
      const c = (t % CYCLE) / CYCLE; // 0..1 through one vote

      // Phases: 0-.30 slab drops, .30-.40 impact, .40-.85 confirmation pulse travels back, rest settle.
      const drop = clamp(c / 0.3, 0, 1);
      const x = blocks[newest].position.x;
      const topY = 0.65 + 0.04;
      const startY = 4.2;
      const fall = startY - (startY - topY) * easeOutCubic(drop);
      const sink = c >= 0.3 && c < 0.42 ? easeInOut((c - 0.3) / 0.12) : c >= 0.42 ? 1 : 0;
      slab.position.set(x, c < 0.3 ? fall : topY - sink * 0.5, 0);
      slab.rotation.y = (1 - easeOutCubic(drop)) * 1.3;
      const slabVisible = c < 0.5 ? 1 : clamp(1 - (c - 0.5) / 0.1, 0, 1);
      slabMat.opacity = slabVisible;
      slabMat.transparent = true;
      slabEdgeMat.transparent = true;
      slabEdgeMat.opacity = slabVisible;
      slab.visible = slabVisible > 0.01;

      // Impact ring.
      const ringT = clamp((c - 0.3) / 0.25, 0, 1);
      ring.position.x = x;
      ring.scale.setScalar(1 + ringT * 2.6);
      ringMat.opacity = ringT > 0 && ringT < 1 ? (1 - ringT) * 0.7 : 0;

      // Pulse runs from the newest block back to the first.
      const pulseT = clamp((c - 0.4) / 0.45, 0, 1);
      const front = pulseT * (BLOCKS - 1); // block index (fractional) the pulse has reached from the newest
      blocks.forEach((b, i) => {
        const fromNewest = newest - i;
        const reached = clamp(front - fromNewest + 1, 0, 1); // 0..1 as the pulse arrives
        const flash = reached > 0 && reached < 1 ? Math.sin(reached * Math.PI) : 0;
        const settled = pulseT >= 1 || front - fromNewest >= 1 ? 1 : reached;
        const impact = i === newest && c >= 0.3 && c < 0.55 ? Math.sin(clamp((c - 0.3) / 0.25, 0, 1) * Math.PI) : 0;
        blockMats[i].emissiveIntensity = 0.05 + flash * 0.9 + impact * 0.9 + (pulseT > 0 && pulseT < 1 ? settled * 0.12 : 0);
        b.position.y = (flash * 0.12 + impact * 0.1) * 1;
      });
      linkMats.forEach((m, i) => {
        const fromNewest = newest - 1 - i;
        const on = clamp(front - fromNewest, 0, 1);
        m.emissiveIntensity = 0.15 + (pulseT > 0 && pulseT < 1 ? on * 0.8 * (1 - clamp(front - fromNewest - 1, 0, 1)) : 0);
      });

      // Camera.
      idle += dt;
      const sway = Math.sin(idle * 0.25) * 0.18;
      const targetYaw = yaw + sway + (dragging ? 0 : pointer.x * 0.12);
      const targetPitch = pitch + (dragging ? 0 : pointer.y * 0.05);
      const R = 18.5;
      camera.position.set(Math.sin(targetYaw) * R * Math.cos(targetPitch), Math.sin(targetPitch) * R + 1.2, Math.cos(targetYaw) * R * Math.cos(targetPitch));
      camera.lookAt(0.0, 0.5, 0);
      void pal;
    };
    stage.run(update);

    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      stage.dispose();
    };
  }, []);

  return <div ref={hostRef} className="hero-ledger" aria-hidden="true" />;
}
