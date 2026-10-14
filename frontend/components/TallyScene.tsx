"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { clamp, createStage, rand, type Palette } from "./three/stage";

/** The vote counts as stacks of paper tiles, one tile per vote. When a new vote shows up it
 *  drops onto its candidate's stack and lands with a flash, so a live count visibly grows. Drag
 *  to turn the view. The numbers come from the page's own reads of the chain; the scene only
 *  draws them. Big elections are fine: past 150 tiles in a stack, each tile stands for several
 *  votes (the labels always show the exact count). */

type Props = { candidates: string[]; tally: number[]; closed?: boolean; labelAll?: boolean; winners?: number[] };

const MAX_STACK_H = 3.8;
const MAX_TILE_PITCH = 0.2;
const MAX_TILES_PER_STACK = 150;
const CAPACITY = 20 * MAX_TILES_PER_STACK + 400; // 20 candidates is the ballot limit
const FALL_S = 0.62;
const FLASH_S = 0.75;

type Flyer = { cand: number; slot: number; start: number; jx: number; jz: number; ry: number; landed: boolean; landedAt: number };

export default function TallyScene({ candidates, tally, closed = false, labelAll = false, winners }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef({ tally, closed, labelAll, winners });
  dataRef.current = { tally, closed, labelAll, winners };
  const nudge = useRef<(() => void) | null>(null);

  // New numbers: wake a reduced-motion scene so it redraws; animated scenes pick them up on their own.
  useEffect(() => {
    nudge.current?.();
  }, [tally, closed]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = createStage(host, { fov: 32, maxDpr: 2 });
    if (!stage) {
      host.classList.add("no-webgl");
      return;
    }
    const { scene, camera } = stage;
    const n = candidates.length;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445550, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 9, 7);
    scene.add(key);

    const spacing = n > 1 ? Math.min(2.4, 11.5 / (n - 1)) : 0;
    const fw = Math.min(1.7, spacing * 0.8 || 1.7);
    const fd = fw * 0.68;
    const colX = (i: number) => (i - (n - 1) / 2) * spacing;

    // Plinth under each stack, so a candidate with no votes yet still has a place.
    const plinthGeo = new THREE.BoxGeometry(fw * 1.12, 0.05, fd * 1.12);
    const plinthMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(plinthGeo, plinthMat);
      m.position.set(colX(i), -0.025, 0);
      scene.add(m);
    }

    const tileGeo = new THREE.BoxGeometry(1, 1, 1);
    const tileMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    const tiles = new THREE.InstancedMesh(tileGeo, tileMat, CAPACITY);
    tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    tiles.frustumCulled = false;
    tiles.count = 0;
    scene.add(tiles);

    const floor = new THREE.GridHelper(30, 30, 0x000000, 0x000000);
    const floorMat = floor.material as THREE.LineBasicMaterial;
    floorMat.transparent = true;
    floorMat.opacity = 0.14;
    floor.position.y = -0.06;
    scene.add(floor);

    type Label = { el: HTMLDivElement; count: HTMLElement };
    const labels: Label[] = candidates.map((name) => {
      const el = document.createElement("div");
      el.className = "journey-label tally-label";
      const b = document.createElement("b");
      b.textContent = name;
      const s = document.createElement("span");
      el.append(b, s);
      host.appendChild(el);
      return { el, count: s };
    });

    // ---- tile state -------------------------------------------------------------------------
    let unit = 1; // votes per tile (grows only for very large counts)
    const scheduled = new Array<number>(n).fill(0); // tiles landed or on their way, per stack
    const landed = new Array<number>(n).fill(0); // tiles resting on the stack
    let flyers: Flyer[] = [];
    let leadersKey = "";
    let dirty = true;
    let firstSync = true;
    const topSmooth = new Array<number>(n).fill(0);

    let pal: Palette | null = null;
    const baseColor = new THREE.Color();
    const leadColor = new THREE.Color();
    const flashColor = new THREE.Color();
    stage.onTheme((p: Palette) => {
      pal = p;
      baseColor.copy(p.dark ? p.line : p.accentSoft).lerp(p.accent, p.dark ? 0.12 : 0.28);
      leadColor.copy(p.accent);
      flashColor.copy(p.dark ? p.text : p.surface).lerp(p.accent, 0.25);
      plinthMat.color.copy(p.dark ? p.line : p.line).lerp(p.bg, 0.4);
      floorMat.color.copy(p.dark ? p.line : p.muted);
      dirty = true;
    });

    let curPitch = MAX_TILE_PITCH;

    const tilesFor = (votes: number) => Math.ceil(votes / unit);

    const sync = (t: number, instant: boolean) => {
      const { tally: tl } = dataRef.current;
      const maxVotes = Math.max(0, ...tl);
      const nextUnit = Math.max(1, Math.ceil(maxVotes / MAX_TILES_PER_STACK));
      if (nextUnit !== unit) {
        unit = nextUnit;
        instant = true; // tile meaning changed: redraw the stacks at rest rather than animate
      }
      for (let i = 0; i < n; i++) {
        const want = tilesFor(tl[i] ?? 0);
        if (instant || want < scheduled[i]) {
          flyers = flyers.filter((f) => f.cand !== i);
          scheduled[i] = landed[i] = want;
          dirty = true;
        } else if (want > scheduled[i]) {
          const fresh = want - scheduled[i];
          for (let k = 0; k < fresh; k++) {
            const slot = scheduled[i] + k;
            // The first reading of an election lands as a quick cascade; later votes drop one by one.
            const stagger = firstSync ? ((slot * n + i) / (Math.max(1, ...tl.map((x) => Math.ceil(x / unit))) * n)) * 1.8 : k * 0.16;
            flyers.push({
              cand: i,
              slot,
              start: t + stagger,
              jx: (rand(i * 977 + slot) - 0.5) * 0.09,
              jz: (rand(i * 331 + slot + 7) - 0.5) * 0.09,
              ry: (rand(i * 53 + slot + 3) - 0.5) * 0.14,
              landed: false,
              landedAt: 0,
            });
          }
          scheduled[i] = want;
          dirty = true;
        }
      }
      firstSync = false;
    };

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    const draw = (t: number) => {
      const { tally: tl, winners: win } = dataRef.current;
      const maxTiles = Math.max(1, ...scheduled);
      const pitch = Math.min(MAX_TILE_PITCH, MAX_STACK_H / maxTiles);
      const th = pitch * 0.8;

      const topVal = Math.max(0, ...tl);
      const lead = win && win.length > 0 ? tl.map((_, i) => win.includes(i)) : topVal > 0 ? tl.map((x) => x === topVal) : tl.map(() => false);
      const lk = lead.join();
      if (lk !== leadersKey) {
        leadersKey = lk;
        dirty = true;
      }

      let c = 0;
      // Resting tiles. Slots that a flyer is still drawing (falling, or in its landing flash) are
      // left out so no tile is drawn twice.
      const restCount = landed.slice();
      for (const f of flyers) if (f.slot < restCount[f.cand]) restCount[f.cand] = f.slot;
      for (let i = 0; i < n; i++) {
        const baseCol = lead[i] ? leadColor : baseColor;
        for (let s = 0; s < restCount[i]; s++) {
          dummy.position.set(colX(i), s * pitch + th / 2, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(fw, th, fd);
          dummy.updateMatrix();
          tiles.setMatrixAt(c, dummy.matrix);
          col.copy(baseCol);
          // Subtle banding so a tall stack reads as layers, not one block.
          col.offsetHSL(0, 0, (s % 2 === 0 ? 0.018 : -0.018));
          tiles.setColorAt(c, col);
          c++;
        }
      }

      // Falling and just-landed tiles.
      let moving = false;
      for (const f of flyers) {
        const age = t - f.start;
        if (age < 0) {
          moving = true;
          continue; // waiting its turn: not visible yet
        }
        const restY = f.slot * pitch + th / 2;
        const baseCol = lead[f.cand] ? leadColor : baseColor;
        let y: number;
        let ry = f.ry;
        if (age < FALL_S) {
          const q = age / FALL_S;
          y = restY + (1 - q * q) * 4.4; // gravity-ish: slow at first, quick at the end
          ry = f.ry + (1 - q) * 1.2;
          moving = true;
        } else {
          if (!f.landed) {
            f.landed = true;
            f.landedAt = f.start + FALL_S;
            landed[f.cand] = Math.max(landed[f.cand], f.slot + 1);
            dirty = true;
          }
          const since = t - f.landedAt;
          y = restY + Math.max(0, 0.06 * Math.sin(since * 22) * Math.exp(-since * 9)); // tiny settle
          if (since < FLASH_S) moving = true;
        }
        dummy.position.set(colX(f.cand) + f.jx, y, f.jz);
        dummy.rotation.set(0, ry, 0);
        dummy.scale.set(fw, th, fd);
        dummy.updateMatrix();
        tiles.setMatrixAt(c, dummy.matrix);
        const since = f.landed ? t - f.landedAt : -1;
        col.copy(baseCol);
        if (age < FALL_S) col.lerp(flashColor, 0.55);
        else if (since >= 0 && since < FLASH_S) col.lerp(flashColor, 0.55 * (1 - since / FLASH_S));
        tiles.setColorAt(c, col);
        c++;
      }
      // Retire flyers once they have landed and cooled.
      if (flyers.length && flyers.every((f) => f.landed && t - f.landedAt >= FLASH_S)) {
        flyers = [];
        dirty = true;
      }

      tiles.count = c;
      tiles.instanceMatrix.needsUpdate = true;
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
      dirty = moving;
      return { pitch, th };
    };

    // ---- camera + labels ----------------------------------------------------------------------
    let yaw = -0.28;
    let pitchAng = 0.34;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const pointer = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      host.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!dragging) return;
      yaw = clamp(yaw + (e.clientX - lx) * 0.006, -1.2, 1.2);
      pitchAng = clamp(pitchAng + (e.clientY - ly) * 0.004, 0.08, 0.8);
      lx = e.clientX;
      ly = e.clientY;
      if (stage.reduced) frame(0.016, 3.2);
    };
    const onUp = () => {
      dragging = false;
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);

    const v = new THREE.Vector3();
    const frame = (dt: number, t: number) => {
      const reducedNow = stage.reduced;
      sync(t, reducedNow);
      if (reducedNow) {
        // No animation: everything is already at rest.
        for (let i = 0; i < n; i++) landed[i] = scheduled[i];
        flyers = [];
        dirty = true;
      }
      if (dirty || flyers.length > 0) curPitch = draw(t).pitch;
      const pitch = curPitch;

      const { tally: tl, labelAll: all, winners: win, closed: isClosed } = dataRef.current;
      void isClosed;
      const topVal = Math.max(0, ...tl);
      const lead = win && win.length > 0 ? tl.map((_, i) => win.includes(i)) : topVal > 0 ? tl.map((x) => x === topVal) : tl.map(() => false);

      const idleYaw = dragging || reducedNow ? 0 : Math.sin(t * 0.3) * 0.08;
      const spanX = (n - 1) * spacing + fw + 2.2;
      const dist = clamp(spanX / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) + 4, 14, 44);
      const yw = yaw + idleYaw + (dragging ? 0 : pointer.x * 0.08);
      const pt = pitchAng + (dragging ? 0 : pointer.y * 0.03);
      camera.position.set(Math.sin(yw) * dist * Math.cos(pt), Math.sin(pt) * dist + 1.4, Math.cos(yw) * dist * Math.cos(pt));
      camera.lookAt(0, 2.1, 0);
      camera.updateMatrixWorld();
      host.classList.toggle("compact", host.clientWidth < 560);

      const w = host.clientWidth;
      const h = host.clientHeight;
      for (let i = 0; i < n; i++) {
        // Smoothly follow the top of the stack so the label rides up as tiles land.
        const goal = landed[i] * pitch;
        topSmooth[i] += (goal - topSmooth[i]) * (reducedNow ? 1 : 1 - Math.exp(-10 * Math.max(dt, 0.016)));
        v.set(colX(i), topSmooth[i] + 0.2, 0).project(camera);
        const l = labels[i];
        l.el.style.display = all || n <= 8 || lead[i] ? "" : "none";
        const votes = tl[i] ?? 0;
        l.count.textContent = `${votes} ${votes === 1 ? "vote" : "votes"}`;
        l.el.classList.toggle("chosen", lead[i]);
        l.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h - (n > 8 ? (i % 2) * 30 : 0)}px)`;
      }
      void pal;
    };
    stage.run((t, dt) => frame(dt, t));
    nudge.current = () => {
      if (stage.reduced) {
        frame(0.016, 3.2);
        stage.render();
      }
    };

    return () => {
      nudge.current = null;
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      labels.forEach((l) => l.el.remove());
      stage.dispose();
      tileGeo.dispose();
      tileMat.dispose();
      plinthGeo.dispose();
      plinthMat.dispose();
      tiles.dispose();
    };
    // The scene is rebuilt only when the candidate list itself changes; counts flow in via dataRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.join("\u0000")]);

  return <div ref={hostRef} className="journey tally-scene" aria-hidden="true" />;
}
