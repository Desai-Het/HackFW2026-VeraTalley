"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { clamp, createStage, damp, easeInOut, type Palette } from "./three/stage";

/** A 3D picture of one vote's trip: the voter's ID, the transaction, the ballot contract, and
 *  the candidate it was counted for. A glowing ballot travels the route. It only illustrates
 *  facts the page has already read from the chain (it draws nothing the chain didn't say). */

type Props = {
  voterLabel: string;
  senderLabel: string;
  ballotLabel: string;
  candidates: string[];
  tally: number[];
  chosen: number;
};

export default function VoteJourney({ voterLabel, senderLabel, ballotLabel, candidates, tally, chosen }: Props) {
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

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445550, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 7, 6);
    scene.add(key);

    const mats: Record<string, THREE.MeshStandardMaterial> = {};
    const mk = (name: string, o: THREE.MeshStandardMaterialParameters = {}) =>
      (mats[name] = new THREE.MeshStandardMaterial({ roughness: 0.4, ...o }));
    const voterMat = mk("voter");
    const txMat = mk("tx", { flatShading: true });
    const boxMat = mk("box", { transparent: true, opacity: 0.22, depthWrite: false });
    const pillarMat = mk("pillar", { transparent: true, opacity: 0.85 });
    const chosenMat = mk("chosen", { emissiveIntensity: 0.45 });
    const packetMat = new THREE.MeshBasicMaterial({});
    const lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
    const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
    const dimEdge = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45 });

    // Nodes.
    const voterPos = new THREE.Vector3(-8.2, 0.2, 0);
    const txPos = new THREE.Vector3(-5.1, 0.4, 0);
    const boxPos = new THREE.Vector3(-1.6, 0.4, 0);

    const voter = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 24), voterMat);
    voter.position.copy(voterPos);
    const tx = new THREE.Mesh(new THREE.OctahedronGeometry(0.72), txMat);
    tx.position.copy(txPos);
    const boxGeo = new THREE.BoxGeometry(2.6, 2.2, 2.6);
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.copy(boxPos);
    const boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), edgeMat);
    boxEdges.position.copy(boxPos);
    scene.add(voter, tx, box, boxEdges);

    // Candidate pillars, in a row going away from the camera.
    const n = candidates.length;
    const maxTally = Math.max(1, ...tally);
    const first = 2.4;
    const spacing = n > 1 ? Math.min(2.0, 6.4 / (n - 1)) : 0;
    const pillars: THREE.Mesh[] = [];
    const pillarTops: THREE.Vector3[] = [];
    candidates.forEach((_, i) => {
      const h = 0.5 + (tally[i] / maxTally) * 2.6;
      const w = Math.min(0.9, spacing * 0.6 || 0.9);
      const geo = new THREE.BoxGeometry(w, h, w);
      const m = new THREE.Mesh(geo, i === chosen ? chosenMat : pillarMat);
      const x = first + i * spacing;
      m.position.set(x, h / 2 - 0.7, 0);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), i === chosen ? edgeMat : dimEdge);
      edges.position.copy(m.position);
      scene.add(m, edges);
      pillars.push(m);
      pillarTops.push(new THREE.Vector3(x, h - 0.7 + 0.25, 0));
    });

    // Floor.
    const floor = new THREE.GridHelper(26, 26, 0x000000, 0x000000);
    const floorMat = floor.material as THREE.LineBasicMaterial;
    floorMat.transparent = true;
    floorMat.opacity = 0.14;
    floor.position.y = -0.72;
    scene.add(floor);

    // The route, as a smooth curve through the four stops.
    const target = pillarTops[chosen] ?? new THREE.Vector3(first, 1, 0);
    const route = new THREE.CatmullRomCurve3(
      [
        voterPos,
        new THREE.Vector3(-6.7, 1.7, 0),
        txPos,
        new THREE.Vector3(-3.4, 1.9, 0),
        new THREE.Vector3(boxPos.x, boxPos.y + 0.2, 0),
        new THREE.Vector3((boxPos.x + target.x) / 2, 2.4 + target.y * 0.3, 0),
        target,
      ],
      false,
      "catmullrom",
      0.4
    );
    const routeGeo = new THREE.BufferGeometry().setFromPoints(route.getPoints(120));
    scene.add(new THREE.Line(routeGeo, lineMat));

    const packet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.34), packetMat);
    scene.add(packet);
    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.34), packetMat.clone());
      (tr.material as THREE.MeshBasicMaterial).transparent = true;
      (tr.material as THREE.MeshBasicMaterial).opacity = 0.5 - i * 0.07;
      scene.add(tr);
      trail.push(tr);
    }

    // HTML labels pinned to 3D points.
    type Label = { el: HTMLDivElement; at: THREE.Vector3; lift: number };
    const labels: Label[] = [];
    const addLabel = (text: string, sub: string, at: THREE.Vector3, lift: number, cls = "") => {
      const el = document.createElement("div");
      el.className = `journey-label ${cls}`;
      const b = document.createElement("b");
      b.textContent = text;
      const s = document.createElement("span");
      s.textContent = sub;
      el.append(b, s);
      host.appendChild(el);
      labels.push({ el, at, lift });
    };
    addLabel("Voter ID", voterLabel, voterPos, 1.25);
    addLabel("Transaction", senderLabel, txPos, 1.35);
    addLabel("Ballot contract", ballotLabel, boxPos, 1.9);
    const manyLabels = n <= 5;
    candidates.forEach((name, i) => {
      if (i !== chosen && !manyLabels) return;
      const sub = `${tally[i]} ${tally[i] === 1 ? "vote" : "votes"}`;
      addLabel(i === chosen ? `${name}` : name, i === chosen ? `${sub} · your vote` : sub, pillarTops[i], 0.35, i === chosen ? "chosen" : "dim");
    });

    stage.onTheme((p: Palette) => {
      voterMat.color.copy(p.accent);
      txMat.color.copy(p.accent).lerp(p.surface, 0.35);
      boxMat.color.copy(p.accent);
      pillarMat.color.copy(p.line);
      chosenMat.color.copy(p.accent);
      chosenMat.emissive.copy(p.accent);
      packetMat.color.copy(p.dark ? p.text : p.accent);
      trail.forEach((tr) => (tr.material as THREE.MeshBasicMaterial).color.copy(p.accent));
      lineMat.color.copy(p.accent);
      lineMat.opacity = p.dark ? 0.7 : 0.8;
      edgeMat.color.copy(p.accent);
      dimEdge.color.copy(p.muted);
      floorMat.color.copy(p.dark ? p.line : p.muted);
    });

    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (stage.reduced) {
        place(0, 3.2);
        stage.render();
      }
    };
    host.addEventListener("pointermove", onMove);

    const CYCLE = 6;
    const v = new THREE.Vector3();
    const place = (dt: number, t: number) => {
      const c = (t % CYCLE) / CYCLE;
      const travel = stage.reduced ? 1 : easeInOut(clamp(c / 0.8, 0, 1));
      const at = stage.reduced ? 1 : travel;
      route.getPointAt(at, packet.position);
      packet.rotation.y = t * 1.5;
      packet.visible = true;
      trail.forEach((tr, i) => {
        route.getPointAt(clamp(at - (i + 1) * 0.018, 0, 1), tr.position);
        tr.visible = at > 0.02 && at < 0.999;
      });
      // Landing pulse on the chosen pillar.
      const landed = c > 0.8 || stage.reduced ? 1 : 0;
      chosenMat.emissiveIntensity = 0.35 + (landed ? 0.5 * (0.5 + 0.5 * Math.sin(t * 5)) : 0);
      tx.rotation.y = t * 0.8;
      tx.rotation.x = Math.sin(t * 0.6) * 0.3;
      voter.position.y = voterPos.y + Math.sin(t * 1.4) * 0.06;
      boxMat.opacity = 0.18 + 0.12 * Math.max(0, Math.sin((c - 0.35) * Math.PI * 2.4)) * (c > 0.35 && c < 0.6 ? 1 : 0);

      camera.position.x = damp(camera.position.x, pointer.x * 1.4, 2.5, dt || 0.016);
      camera.position.y = damp(camera.position.y, 3.0 - pointer.y * 0.8, 2.5, dt || 0.016);
      camera.position.z = clamp(10.4 / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect), 11, 34);
      camera.lookAt(0.4, 0.5, 0);
      camera.updateMatrixWorld();
      host.classList.toggle("compact", host.clientWidth < 560);

      const w = host.clientWidth;
      const h = host.clientHeight;
      labels.forEach((l) => {
        v.copy(l.at);
        v.y += l.lift;
        v.project(camera);
        l.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      });
    };
    stage.run((t, dt) => place(dt, t));

    return () => {
      host.removeEventListener("pointermove", onMove);
      labels.forEach((l) => l.el.remove());
      stage.dispose();
    };
  }, [voterLabel, senderLabel, ballotLabel, candidates, tally, chosen]);

  return <div ref={hostRef} className="journey" aria-hidden="true" />;
}
