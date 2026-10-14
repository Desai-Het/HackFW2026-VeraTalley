"use client";

import dynamic from "next/dynamic";

// Loaded after the page is interactive, and never on the server: the scene is decoration.
const SiteBackdrop = dynamic(() => import("./SiteBackdrop"), { ssr: false });

export default function Backdrop() {
  return <SiteBackdrop />;
}
