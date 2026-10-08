// Copies compiled contract ABIs into the frontend so it has a self-contained copy - no
// cross-package filesystem reads at runtime (frontend/contracts are deployed separately, with
// no backend, per OOS-07).
const fs = require("fs");
const path = require("path");

const CONTRACTS = ["VoterRegistry", "ElectionBallot", "ElectionFactory"];

for (const name of CONTRACTS) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact for ${name} not found. Run \`npm run contracts:compile\` first.`);
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abiJson = JSON.stringify(artifact.abi, null, 2) + "\n";

  const target = path.join(__dirname, "..", "..", "frontend", "lib", "abi", `${name}.abi.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, abiJson);
  console.log("Wrote", path.relative(process.cwd(), target));
}
