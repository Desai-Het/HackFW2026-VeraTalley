// Read-only health check for a deployed ElectionFactory. Sends no transactions, costs nothing.
// Usage:  npx hardhat run scripts/diagnose.js --network amoy
// It reads the factory address from deployed-addresses.<network>.json.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const file = path.join(__dirname, "..", `deployed-addresses.${network.name}.json`);
  const info = JSON.parse(fs.readFileSync(file, "utf8"));
  const addr = info.electionFactory;
  const provider = ethers.provider;
  const net = await provider.getNetwork();
  console.log("Network:", network.name, "chainId", Number(net.chainId));
  console.log("Factory:", addr);

  const code = await provider.getCode(addr);
  console.log("Contract code at that address:", code === "0x" ? "NONE (nothing is deployed there!)" : `${(code.length - 2) / 2} bytes`);
  if (code === "0x") return;

  const [signer] = await ethers.getSigners();
  console.log("Deployer/first signer:", signer.address);
  const factory = await ethers.getContractAt("ElectionFactory", addr);
  console.log("electionCount():", String(await factory.electionCount()));

  const who = process.env.FROM || signer.address;
  console.log("Simulating createElection as:", who);
  const args = ["Diagnose test", ["Option A", "Option B"]];
  try {
    const res = await factory.createElection.staticCall(...args, { from: who });
    console.log("Simulation OK. It would create election id", String(res[0]));
  } catch (e) {
    console.log("Simulation FAILED:", e.shortMessage || e.message);
  }
  try {
    const gas = await factory.createElection.estimateGas(...args, { from: who });
    console.log("Estimated gas:", String(gas));
  } catch (e) {
    console.log("Gas estimate FAILED:", e.shortMessage || e.message);
  }
  const fee = await provider.getFeeData();
  console.log("Network gas price (gwei):", fee.gasPrice ? ethers.formatUnits(fee.gasPrice, "gwei") : "n/a",
    "| priority tip (gwei):", fee.maxPriorityFeePerGas ? ethers.formatUnits(fee.maxPriorityFeePerGas, "gwei") : "n/a");
  console.log("Balance of", who, ":", ethers.formatEther(await provider.getBalance(who)), "POL");
}
main().catch((e) => { console.error(e); process.exit(1); });
