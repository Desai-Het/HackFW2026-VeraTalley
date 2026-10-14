"use client";

import dynamic from "next/dynamic";

export default dynamic(() => import("./TallyScene"), {
  ssr: false,
  loading: () => <div className="journey tally-scene" aria-hidden="true" />,
});
