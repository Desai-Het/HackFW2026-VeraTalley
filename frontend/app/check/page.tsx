import { Suspense } from "react";
import CheckVote from "@/components/CheckVote";

export const metadata = {
  title: "Check a vote - VeraTally",
  description: "Paste a transaction ID and see which election and candidate that vote was recorded for.",
};

export default function CheckPage() {
  return (
    <Suspense fallback={<main><h1>Check a vote</h1></main>}>
      <CheckVote />
    </Suspense>
  );
}
