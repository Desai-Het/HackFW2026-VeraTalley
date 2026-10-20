// Read-only: finds your recent transactions to the factory, shows whether each succeeded, how much
// gas it had vs used, and replays failed ones to get the revert reason. Sends nothing, costs nothing.
// Usage:  npx hardhat run scripts/diagnose-tx.js --network amoy
// Optional: set TX=0xhash1,0xhash2 to inspect specific transactions instead.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const provider = ethers.provider;
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, "..", `deployed-addresses.${network.name}.json`), "utf8"));
  const factoryAddr = info.electionFactory.toLowerCase();
  const [me] = await ethers.getSigners();
  const iface = (await ethers.getContractFactory("ElectionFactory")).interface;
  console.log("Account:", me.address, "| nonce (txs sent):", await provider.getTransactionCount(me.address));

  let hashes = (process.env.TX || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hashes.length === 0) {
    try {
      const r = await provider.send("alchemy_getAssetTransfers", [
        { fromAddress: me.address, category: ["external"], order: "desc", maxCount: "0xa", withMetadata: false },
      ]);
      hashes = r.transfers.map((t) => t.hash);
    } catch (e) {
      const latest = await provider.getBlockNumber();
      for (let n = latest; n > latest - 300 && n >= 0; n--) {
        const b = await provider.getBlock(n, true);
        for (const tx of b.prefetchedTransactions || []) {
          if (tx.from.toLowerCase() === me.address.toLowerCase()) hashes.push(tx.hash);
        }
      }
    }
  }
  if (hashes.length === 0) console.log("No transactions found for this account.");

  for (const h of hashes) {
    const tx = await provider.getTransaction(h);
    const rc = await provider.getTransactionReceipt(h);
    if (!tx) { console.log("\n" + h, "-> not found"); continue; }
    const isFactory = tx.to && tx.to.toLowerCase() === factoryAddr;
    console.log("\nTx", h);
    console.log("  to:", tx.to, isFactory ? "(the factory)" : "");
    if (!rc) { console.log("  status: still pending / not mined"); continue; }
    console.log("  status:", rc.status === 1 ? "SUCCESS" : "FAILED");
    console.log("  gas limit:", String(tx.gasLimit), "| gas used:", String(rc.gasUsed),
      "| used %:", ((Number(rc.gasUsed) / Number(tx.gasLimit)) * 100).toFixed(1));
    console.log("  fee paid:", ethers.formatEther(rc.gasUsed * rc.gasPrice), "POL");
    try {
      const parsed = iface.parseTransaction({ data: tx.data });
      if (parsed) console.log("  call:", parsed.name, JSON.stringify(parsed.args.map((a) => (Array.isArray(a) ? [...a] : a))));
    } catch (_) {}
    if (rc.status !== 1) {
      try {
        await provider.call({ from: tx.from, to: tx.to, data: tx.data, value: tx.value, gasLimit: tx.gasLimit }, rc.blockNumber - 1);
        console.log("  replay: did NOT revert when replayed with the same gas (likely ran out of gas or was a gas-limit issue)");
      } catch (e) {
        console.log("  replay revert reason:", e.shortMessage || e.reason || e.message);
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
