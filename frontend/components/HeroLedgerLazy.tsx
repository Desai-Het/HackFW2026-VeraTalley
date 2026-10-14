"use client";

import dynamic from "next/dynamic";

export default dynamic(() => import("./HeroLedger"), {
  ssr: false,
  loading: () => <div className="hero-ledger" aria-hidden="true" />,
});
