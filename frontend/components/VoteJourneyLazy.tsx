"use client";

import dynamic from "next/dynamic";

export default dynamic(() => import("./VoteJourney"), {
  ssr: false,
  loading: () => <div className="journey" aria-hidden="true" />,
});
