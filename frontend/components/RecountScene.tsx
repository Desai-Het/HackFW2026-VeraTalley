"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export type SceneCandidate = { name: string; votes: number };

type Props = { title: string; candidates: SceneCandidate[] };

type Slab = {
  col: number;
  k: number;
  delay: number;
  jx: number;
  jz: number;
  ry: number;
  targetY: number;
  litAt: number; // clock time when the recount light reached it, or -1
};

type Phase = "falling" | "idle" | "recounting" | "done";

const SLAB_W = 1.7;
const SLAB_D = 1.15;
const SLAB_H = 0.07;
const PITCH = 0.098;
const COLUMN_GAP = 3.1;
const FALL_SECONDS = 0.85;
const SWEEP_SECONDS = 3.2;

const DIM = new THREE.Color("#aeb6b1");
const TEAL = new THREE.Color("#2fb59a");
const FLASH = new THREE.Color("#d4fff4");

const easeOutCubic = (q: number) => 1 - Math.pow(1 - q, 3);
const easeInOut = (q: number) => (q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2);
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** A small WebGL scene: every vote is a thin slab of paper stacked under its candidate. A light
 *  sweeps up through the stacks to "recount" them, ticking a counter as each slab is checked.
 *  Sample data only - on a real election the slabs would come from the chain's VoteCast events. */
export default function RecountScene({ title, candidates }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const controlsRef = useRef<{ recount: () => void; replay: () => void } | null>(null);

  const [phase, setPhase] = useState<Phase>("falling");
  const [checked, setChecked] = useState(0);
  const [unsupported, setUnsupported] = useState(false);

  const total = candidates.reduce((sum, c) => sum + c.votes, 0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setUnsupported(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0d100f, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d100f, 0.055);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    const cameraBase = new THREE.Vector3(0, 3.1, 9.4);
    const lookAt = new THREE.Vector3(0, 1.0, 0);

    // Lights: soft ambient, a key from the front right, a cool rim from behind.
    scene.add(new THREE.HemisphereLight(0xdfe9e4, 0x101614, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(4, 7, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fd0b4, 0.7);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    // Floor grid, fading into the fog.
    const grid = new THREE.GridHelper(40, 80, 0x24322d, 0x172019);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.9;
    scene.add(grid);

    // Dust in the air, very sparse.
    const dustCount = 260;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 16;
      dustPos[i * 3 + 1] = Math.random() * 6;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ color: 0x9fd9cb, size: 0.028, transparent: true, opacity: 0.45, depthWrite: false })
    );
    scene.add(dust);

    // Soft contact shadow under each stack.
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext("2d");
    if (sctx) {
      const g = sctx.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, "rgba(0,0,0,0.65)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 128, 128);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
    const n = candidates.length;
    const colX = (col: number) => (col - (n - 1) / 2) * COLUMN_GAP;
    const shadows: THREE.Mesh[] = [];
    for (let c = 0; c < n; c++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(SLAB_W * 2.1, SLAB_D * 2.3), shadowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(colX(c), 0.002, 0);
      scene.add(m);
      shadows.push(m);
    }

    // The slabs: one instance per vote.
    const slabs: Slab[] = [];
    candidates.forEach((cand, col) => {
      for (let k = 0; k < cand.votes; k++) {
        slabs.push({
          col,
          k,
          delay: (k * n + col + Math.random() * 0.8) * 0.045,
          jx: (Math.random() - 0.5) * 0.09,
          jz: (Math.random() - 0.5) * 0.09,
          ry: (Math.random() - 0.5) * 0.12,
          targetY: k * PITCH + SLAB_H / 2,
          litAt: -1,
        });
      }
    });
    const maxVotes = Math.max(1, ...candidates.map((c) => c.votes));
    const maxTop = maxVotes * PITCH;

    const slabMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(SLAB_W, SLAB_H, SLAB_D),
      new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }),
      Math.max(slabs.length, 1)
    );
    slabMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(slabs.length, 1) * 3), 3);
    scene.add(slabMesh);

    // The sweeping recount light.
    const sweep = new THREE.Group();
    const sweepPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(n * COLUMN_GAP + 1.5, 3.2),
      new THREE.MeshBasicMaterial({
        color: 0x39d0b0,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    sweepPlane.rotation.x = -Math.PI / 2;
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-(n * COLUMN_GAP + 1.5) / 2, 0, -1.6),
        new THREE.Vector3((n * COLUMN_GAP + 1.5) / 2, 0, -1.6),
        new THREE.Vector3((n * COLUMN_GAP + 1.5) / 2, 0, 1.6),
        new THREE.Vector3(-(n * COLUMN_GAP + 1.5) / 2, 0, 1.6),
      ]),
      new THREE.LineBasicMaterial({ color: 0x7bf0d3, transparent: true, opacity: 0.9 })
    );
    sweep.add(sweepPlane, edge);
    sweep.visible = false;
    scene.add(sweep);

    // Animation state.
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const clock = new THREE.Clock();
    let phaseNow: Phase = reduceMotion ? "idle" : "falling";
    let sceneStart = 0;
    let recountStart = 0;
    let lastChecked = 0;
    let visible = true;
    let raf = 0;
    const pointer = { x: 0, y: 0 };
    const smooth = { x: 0, y: 0 };

    const setPhaseBoth = (p: Phase) => {
      phaseNow = p;
      setPhase(p);
    };
    if (reduceMotion) setPhase("idle");

    const startRecount = () => {
      if (phaseNow === "recounting" || phaseNow === "falling") return;
      slabs.forEach((s) => (s.litAt = -1));
      lastChecked = 0;
      setChecked(0);
      recountStart = clock.getElapsedTime();
      sweep.visible = true;
      if (reduceMotion) {
        slabs.forEach((s) => (s.litAt = recountStart - 10));
        sweep.visible = false;
        setChecked(slabs.length);
        setPhaseBoth("done");
        return;
      }
      setPhaseBoth("recounting");
    };

    const replay = () => {
      slabs.forEach((s) => (s.litAt = -1));
      lastChecked = 0;
      setChecked(0);
      sweep.visible = false;
      sceneStart = clock.getElapsedTime();
      setPhaseBoth(reduceMotion ? "idle" : "falling");
    };
    controlsRef.current = { recount: startRecount, replay };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(h, 1);
      // Narrow screens: pull the camera back so all columns stay in frame.
      cameraBase.z = Math.max(9.4, 15.4 / Math.max(camera.aspect, 0.3));
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const onPointer = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    host.addEventListener("pointermove", onPointer);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(host);

    const tmp = new THREE.Vector3();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const now = clock.getElapsedTime();

      // Fall-in phase ends once the last slab has landed.
      const lastLanding = slabs.reduce((m, s) => Math.max(m, s.delay + FALL_SECONDS), 0);
      if (phaseNow === "falling" && now - sceneStart > lastLanding + 0.2) setPhaseBoth("idle");

      // Recount sweep.
      let sweepY = -1;
      if (phaseNow === "recounting") {
        const q = clamp01((now - recountStart) / SWEEP_SECONDS);
        sweepY = easeInOut(q) * (maxTop + 0.35);
        sweep.position.y = sweepY;
        (sweepPlane.material as THREE.MeshBasicMaterial).opacity = 0.16;
        let count = 0;
        for (const s of slabs) {
          if (s.litAt < 0 && sweepY >= s.targetY) s.litAt = now;
          if (s.litAt >= 0) count += 1;
        }
        if (count !== lastChecked) {
          lastChecked = count;
          setChecked(count);
        }
        if (q >= 1) {
          sweep.visible = false;
          setPhaseBoth("done");
        }
      }

      // Slab transforms and colours.
      let landed: number[] = candidates.map(() => 0);
      slabs.forEach((s, i) => {
        const t = now - sceneStart - s.delay;
        let y = s.targetY;
        let rot = s.ry;
        let scale = 1;
        if (!reduceMotion) {
          if (t < 0) {
            scale = 0;
          } else if (t < FALL_SECONDS) {
            const e = easeOutCubic(t / FALL_SECONDS);
            y = s.targetY + (1 - e) * 5.5;
            rot = s.ry + (1 - e) * 0.9;
          }
        }
        const hasLanded = reduceMotion || t >= FALL_SECONDS;
        if (hasLanded) landed[s.col] += 1;

        let flash = 0;
        let lit = 0;
        if (s.litAt >= 0) {
          const age = now - s.litAt;
          flash = Math.exp(-age * 3.2);
          lit = easeOutCubic(clamp01(age / 0.35));
          y += 0.05 * flash;
        }
        dummy.position.set(colX(s.col) + s.jx, y, s.jz);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        slabMesh.setMatrixAt(i, dummy.matrix);

        color.copy(DIM).lerp(TEAL, lit * 0.85).lerp(FLASH, flash * 0.9);
        slabMesh.setColorAt(i, color);
      });
      slabMesh.instanceMatrix.needsUpdate = true;
      if (slabMesh.instanceColor) slabMesh.instanceColor.needsUpdate = true;

      // Camera: slow drift plus pointer parallax.
      smooth.x += (pointer.x - smooth.x) * 0.05;
      smooth.y += (pointer.y - smooth.y) * 0.05;
      const drift = reduceMotion ? 0 : Math.sin(now * 0.17) * 0.9;
      camera.position.set(
        cameraBase.x + drift + smooth.x * 1.2,
        cameraBase.y - smooth.y * 0.5,
        cameraBase.z
      );
      camera.lookAt(lookAt);
      if (!reduceMotion) dust.rotation.y = now * 0.012;

      // Name tags follow the stack tops.
      const w = host.clientWidth;
      const h = host.clientHeight;
      candidates.forEach((c, col) => {
        const el = labelRefs.current[col];
        if (!el) return;
        const top = Math.max(landed[col], 0) * PITCH;
        tmp.set(colX(col), top + 0.45, 0).project(camera);
        el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
        const countEl = el.querySelector("[data-count]");
        if (countEl) countEl.textContent = String(landed[col]);
      });

      renderer.render(scene, camera);
    };
    sceneStart = clock.getElapsedTime();
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onPointer);
      controlsRef.current = null;
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      slabMesh.material.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
      dustGeo.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [candidates]);

  const busy = phase === "falling" || phase === "recounting";

  return (
    <div className="stage" role="img" aria-label={`3D view of ${title}: ${candidates.map((c) => `${c.name} ${c.votes} votes`).join(", ")}`}>
      <div ref={hostRef} className="stage-canvas" />

      {unsupported && (
        <div className="stage-fallback">
          <p>Your browser can&apos;t show the 3D view. The recount works the same way, just without the picture.</p>
        </div>
      )}

      {candidates.map((c, i) => (
        <div
          key={c.name}
          className="stage-tag"
          ref={(el) => {
            labelRefs.current[i] = el;
          }}
        >
          <span className="stage-tag-name">{c.name}</span>
          <span className="stage-tag-count" data-count>
            0
          </span>
        </div>
      ))}

      <div className="stage-top">
        <span className="stage-kicker">Sample election</span>
        <span className="stage-title">{title}</span>
      </div>

      <div className="stage-bottom">
        <div className="stage-actions">
          <button className="primary" onClick={() => controlsRef.current?.recount()} disabled={busy}>
            {phase === "done" ? "Recount again" : "Recount the votes"}
          </button>
          <button className="stage-ghost" onClick={() => controlsRef.current?.replay()} disabled={phase === "falling"}>
            Replay
          </button>
        </div>
        <p className="stage-status" aria-live="polite">
          {phase === "falling" && "Votes arriving..."}
          {phase === "idle" && `${total} votes cast. Press recount to check them.`}
          {phase === "recounting" && `Checking... ${checked} of ${total}`}
          {phase === "done" && `${checked} of ${total} votes counted again. They match the tally.`}
        </p>
      </div>
    </div>
  );
}
