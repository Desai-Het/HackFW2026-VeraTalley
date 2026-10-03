// Increment B deploy script: no ElectionFactory yet (that's Increment C), so this deploys one
// VoterRegistry and one ElectionBallot directly, registers a demo voter list, and opens voting -
// enough for the thin golden-path demo (cast a vote end to end, second attempt refused).
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Comma-separated wallet addresses to register as eligible voters, e.g. for a real Amoy demo
// with specific judge/presenter wallets. Falls back to a few of the local Hardhat signers so
// `npm run contracts:deploy:local` works with zero configuration.
const DEMO_VOTER_ADDRESSES = (process.env.DEMO_VOTER_ADDRESSES || "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);

async function main() {
  const { ethers, network } = hre;
  const [deployer, localVoter1, localVoter2] = await ethers.getSigners();

  console.log("Deploying with account:", deployer.address);
  console.log("Network:", network.name);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "POL");

  const VoterRegistry = await ethers.getContractFactory("VoterRegistry");
  const registry = await VoterRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("VoterRegistry deployed to:", registryAddress);

  const ElectionBallot = await ethers.getContractFactory("ElectionBallot");
  const ballot = await ElectionBallot.deploy(
    "VeraTally Thin Golden Path Demo",
    ["Option A", "Option B"],
    registryAddress
  );
  await ballot.waitForDeployment();
  const ballotAddress = await ballot.getAddress();
  console.log("ElectionBallot deployed to:", ballotAddress);

  // On the local/hardhat network, default to registering two of the auto-funded local signers
  // so `npm run contracts:deploy:local` plus the frontend works immediately, no setup needed.
  const votersToRegister =
    DEMO_VOTER_ADDRESSES.length > 0
      ? DEMO_VOTER_ADDRESSES
      : network.name === "localhost" || network.name === "hardhat"
        ? [localVoter1.address, localVoter2.address]
        : [];

  if (votersToRegister.length > 0) {
    const tx = await registry.registerVoters(votersToRegister);
    await tx.wait();
    console.log("Registered demo voters:", votersToRegister);
  } else {
    console.log(
      "No DEMO_VOTER_ADDRESSES set - skipping voter registration. Set it (comma-separated) " +
        "or call registry.registerVoters([...]) yourself before opening voting."
    );
  }

  const openTx = await ballot.openVoting();
  await openTx.wait();
  console.log("Voting opened.");

  const deployedInfo = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    voterRegistry: registryAddress,
    electionBallot: ballotAddress,
    registeredVoters: votersToRegister,
    deployedAt: new Date().toISOString(),
  };
  const outPath = path.join(__dirname, "..", `deployed-addresses.${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deployedInfo, null, 2) + "\n");
  console.log("Wrote", outPath);

  console.log("\nNext steps:");
  console.log(`  1. Put these in frontend/.env.local:`);
  console.log(`       NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`       NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS=${ballotAddress}`);
  console.log(`       NEXT_PUBLIC_CHAIN_ID=${deployedInfo.chainId}`);
  if (network.name === "amoy") {
    console.log(`  2. Verify on Polygonscan: npx hardhat verify --network amoy ${registryAddress}`);
    console.log(
      `     npx hardhat verify --network amoy ${ballotAddress} "VeraTally Thin Golden Path Demo" ` +
        `'["Option A","Option B"]' ${registryAddress}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
