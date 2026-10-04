require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Pin to a locally-bundled solc build (via the "solc" npm package) instead of letting Hardhat
// fetch one from binaries.soliditylang.org, since some network policies block that host. This
// never tries to download a compiler at compile/test time.
// Resolve via require.resolve rather than a hardcoded relative path, since npm workspaces may
// hoist "solc" up to the repo root's node_modules instead of contracts/node_modules.
const LOCAL_SOLCJS_PATH = path.join(path.dirname(require.resolve("solc/package.json")), "soljson.js");
const LOCAL_SOLC_VERSION = "0.8.24";
const LOCAL_SOLC_LONG_VERSION = "0.8.24+commit.e11b9ed9.Emscripten.clang";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }) => {
  if (solcVersion !== LOCAL_SOLC_VERSION) {
    throw new Error(
      `This project is pinned to solc ${LOCAL_SOLC_VERSION} (bundled locally, no network download). ` +
        `Requested version was ${solcVersion} - update LOCAL_SOLC_VERSION/pragma together if you need to change it.`
    );
  }
  return {
    version: LOCAL_SOLC_VERSION,
    longVersion: LOCAL_SOLC_LONG_VERSION,
    compilerPath: LOCAL_SOLCJS_PATH,
    isSolcJs: true,
  };
});

const AMOY_RPC_URL = process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology/";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
// Etherscan's unified V2 API covers Polygon Amoy with a single Etherscan.io key. The old
// per-explorer config (apiKey: { polygonAmoy: ... }) makes hardhat-verify call Polygonscan's V1
// API, which Etherscan has retired - so verification (CR-05) would fail. POLYGONSCAN_API_KEY is
// still read as a fallback name so older .env files keep working.
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || process.env.POLYGONSCAN_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    amoy: {
      url: AMOY_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 80002,
    },
  },
  etherscan: {
    // A single string (not a per-network object) is what selects the Etherscan V2 API.
    apiKey: ETHERSCAN_API_KEY,
  },
};
