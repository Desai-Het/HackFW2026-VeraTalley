"use client";

import dynamic from "next/dynamic";

const RecountScene = dynamic(() => import("@/components/RecountScene"), {
  ssr: false,
  loading: () => <div className="stage" />,
});

// Defined outside the component so the scene isn't rebuilt on every render.
const SAMPLE = [
  { name: "Ada", votes: 18 },
  { name: "Grace", votes: 9 },
  { name: "Linus", votes: 2 },
];

export default function RecountDemoPage() {
  return (
    <main className="page-wide">
      <div className="page-title-row">
        <h1>The recount, made visible</h1>
        <p className="lede">
          A concept for the verify page. Each slab is one recorded vote. Press recount and a light passes through every
          stack, checking each vote once and adding it up.
        </p>
      </div>

      <RecountScene title="Club president" candidates={SAMPLE} />

      <p className="hint" style={{ marginTop: 14 }}>
        Preview with sample numbers. In the real version the slabs would be the actual votes read from the blockchain, so
        what you watch is the same check the verify page runs today. Move the mouse over the scene to shift the view.
      </p>
    </main>
  );
}
