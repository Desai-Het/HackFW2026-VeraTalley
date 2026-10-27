// Deploy script. Deploys the ElectionFactory - the only contract that has to exist up front,
// since every election is created through it from the app.
//
// Locally (localhost / hardhat) it also creates and opens a small demo election, so
// `npm run contracts:deploy:local` plus the frontend works with zero setup.
// On a public network (Amoy) it deploys the factory ONLY, which keeps the gas bill small; create
// real elections from the app. To also create a demo election there, set CREATE_DEMO_ELECTION=true
// (and DEMO_VOTER_ADDRESSES) in contracts/.env. CREATE_DEMO_ELECTION=false skips it locally too.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Comma-separated wallet addresses to register as eligible voters, e.g. for a real Amoy demo
// with specific judge/presenter wallets. Falls back to a few of the local Hardhat signers so
// `npm run contracts:deploy:local` works with zero configuration.
const CREATE_DEMO_ELECTION_ENV = (process.env.CREATE_DEMO_ELECTION || "").trim().toLowerCase();
const DEMO_VOTER_ADDRESSES = (process.env.DEMO_VOTER_ADDRESSES || "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);

const ELECTION_TITLE = "VeraTally Thin Golden Path Demo";
const CANDIDATES = ["Option A", "Option B"];

async function main() {
  const { ethers, network } = hre;
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  const createDemo = CREATE_DEMO_ELECTION_ENV ? CREATE_DEMO_ELECTION_ENV === "true" : isLocal;

  // Check everything we can BEFORE spending gas, so a bad config never leaves half-deployed,
  // unusable contracts on Amoy.
  if (!isLocal && !process.env.AMOY_RPC_URL) {
    throw new Error(
      "AMOY_RPC_URL is not set in contracts/.env. Polygon's free public Amoy endpoint has been " +
        "shut down - use a provider URL (Alchemy, QuickNode, dRPC...) that contains 'polygon-amoy'."
    );
  }
  if (createDemo && !isLocal && DEMO_VOTER_ADDRESSES.length === 0) {
    throw new Error(
      "DEMO_VOTER_ADDRESSES is empty. On a public network, set it in contracts/.env to the " +
        "comma-separated wallet addresses that should be able to vote - otherwise the election " +
        "would open with nobody registered."
    );
  }
  const badAddresses = DEMO_VOTER_ADDRESSES.filter((a) => !ethers.isAddress(a));
  if (badAddresses.length > 0) {
    throw new Error(`Not valid wallet addresses in DEMO_VOTER_ADDRESSES: ${badAddresses.join(", ")}`);
  }

  const [deployer, localVoter1, localVoter2] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No deployer account for network "${network.name}". Set PRIVATE_KEY in contracts/.env ` +
        "(a throwaway wallet funded from an Amoy faucet - never a real one)."
    );
  }

  console.log("Deploying with account:", deployer.address);
  console.log("Network:", network.name);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "POL");

  // Deploy the factory once, then create the demo election through it - the same path any
  // user's election takes. The deployer calls createElection, so the deployer is the admin of
  // the new VoterRegistry and ElectionBallot (and the factory holds no authority over them).
  const ElectionFactory = await ethers.getContractFactory("ElectionFactory");
  const factory = await ElectionFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("ElectionFactory deployed to:", factoryAddress);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  if (!createDemo) {
    const info = {
      network: network.name,
      chainId,
      electionFactory: factoryAddress,
      deployedAt: new Date().toISOString(),
    };
    const out = path.join(__dirname, "..", `deployed-addresses.${network.name}.json`);
    fs.writeFileSync(out, JSON.stringify(info, null, 2) + "\n");
    console.log("No demo election created. Wrote", out);
    console.log("\nNext steps:");
    console.log("  1. Put these in the frontend settings (frontend/.env.local, or your host's settings):");
    console.log(`       NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS=${factoryAddress}`);
    console.log(`       NEXT_PUBLIC_CHAIN_ID=${chainId}`);
    if (!isLocal) {
      console.log("  2. Optional: verify the source on Polygonscan (ETHERSCAN_API_KEY set in contracts/.env):");
      console.log(`       npx hardhat verify --network ${network.name} ${factoryAddress}`);
    }
    return;
  }

  const createTx = await factory.createElection(ELECTION_TITLE, CANDIDATES);
  const createReceipt = await createTx.wait();
  const created = createReceipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "ElectionCreated");
  if (!created) {
    throw new Error("createElection succeeded but no ElectionCreated event was found in its receipt.");
  }
  const registryAddress = created.args.registry;
  const ballotAddress = created.args.ballot;
  console.log("VoterRegistry created at:", registryAddress);
  console.log("ElectionBallot created at:", ballotAddress);

  const registry = await ethers.getContractAt("VoterRegistry", registryAddress);
  const ballot = await ethers.getContractAt("ElectionBallot", ballotAddress);

  // On the local/hardhat network, default to registering two of the auto-funded local signers
  // so `npm run contracts:deploy:local` plus the frontend works immediately, no setup needed.
  const votersToRegister =
    DEMO_VOTER_ADDRESSES.length > 0 ? DEMO_VOTER_ADDRESSES : [localVoter1.address, localVoter2.address];

  const tx = await registry.registerVoters(votersToRegister);
  await tx.wait();
  console.log("Registered demo voters:", votersToRegister);

  const openTx = await ballot.openVoting();
  await openTx.wait();
  console.log("Voting opened.");

  const deployedInfo = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    electionFactory: factoryAddress,
    electionId: Number(created.args.electionId),
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
  console.log(`       NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS=${factoryAddress}`);
  if (!isLocal) {
    // The ballot's constructor takes a string[], which `hardhat verify` cannot take as a
    // command-line argument (it would be encoded as one string and verification would fail), so
    // write the arguments to a module and pass it with --constructor-args. The registry and
    // ballot were created by the factory, but their constructor arguments are still the ones the
    // factory passed: the deployer's address as admin, plus (for the ballot) the title,
    // candidates and the registry address.
    const argsFile = `verify-args.${network.name}.js`;
    fs.writeFileSync(
      path.join(__dirname, "..", argsFile),
      "// Constructor arguments for verifying ElectionBallot. Generated by scripts/deploy.js.\n" +
        `module.exports = ${JSON.stringify([ELECTION_TITLE, CANDIDATES, registryAddress, deployer.address], null, 2)};\n`
    );
    console.log("  2. Verify on Polygonscan (run from the contracts/ folder, ETHERSCAN_API_KEY set in .env):");
    console.log(`       npx hardhat verify --network ${network.name} ${factoryAddress}`);
    console.log(`       npx hardhat verify --network ${network.name} ${registryAddress} ${deployer.address}`);
    console.log(
      `       npx hardhat verify --network ${network.name} --constructor-args ${argsFile} ${ballotAddress}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
