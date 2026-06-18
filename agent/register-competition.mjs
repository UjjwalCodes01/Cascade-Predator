/**
 * Competition Registration Script
 *
 * Registers the agent EOA at the official BNB Hack competition contract.
 * Contract: 0x212c61B9B72C95d95BF29CF032F5E5635629Aed5 (BSC Mainnet)
 * Deadline: June 25, 2026 00:00 UTC
 *
 * IMPORTANT: The agent wallet needs real BNB on BSC Mainnet for gas.
 * Registration costs roughly 0.001–0.003 BNB in gas.
 *
 * Usage:
 *   TWAK_WALLET_PASSWORD=cascade-predator-2026 node register-competition.mjs
 *
 * Or use twak CLI (once TWAK API credentials are configured):
 *   TWAK_WALLET_PASSWORD=cascade-predator-2026 twak compete register
 */

import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Competition contract (from TWAK CLI source) ─────────────────────────────
const COMPETITION_ADDRESS = "0x212c61B9B72C95d95BF29CF032F5E5635629Aed5";
const BSC_MAINNET_RPC     = process.env.BSC_MAINNET_RPC ?? "https://bsc-dataseed.binance.org";
const KEYSTORE_PATH       = process.env.TWAK_SIGNER_PATH ?? "./twak-keystore.json";
const PASSWORD            = process.env.TWAK_WALLET_PASSWORD;
const AGENT_EOA           = "0xe98179D277811d99bBF8b0fa3e0914008111B0a5";

const COMPETITION_ABI = [
  "function register() external",
  "function isRegistered(address) view returns (bool)",
  "function registrationStart() view returns (uint256)",
  "function registrationDeadline() view returns (uint256)",
  "event Registered(address indexed participant)",
];

if (!PASSWORD) {
  console.error("❌ TWAK_WALLET_PASSWORD env var is required.");
  process.exit(1);
}

const absKeystore = resolve(KEYSTORE_PATH);
if (!existsSync(absKeystore)) {
  console.error(`❌ Keystore not found: ${absKeystore}`);
  console.error("   Run: node create-keystore.mjs first");
  process.exit(1);
}

// ── Setup provider + signer ─────────────────────────────────────────────────
console.log("Connecting to BSC Mainnet...");
const provider = new ethers.JsonRpcProvider(BSC_MAINNET_RPC, 56, { staticNetwork: true });

// Read chain to confirm connectivity
const network = await provider.getNetwork();
console.log(`✅ Connected to chain: ${network.name} (chainId: ${network.chainId})`);

// Decrypt keystore via TWAK pattern
console.log("Decrypting TWAK keystore...");
const keystoreJson = readFileSync(absKeystore, "utf8");
const wallet = (await ethers.Wallet.fromEncryptedJson(keystoreJson, PASSWORD)).connect(provider);
console.log(`✅ Agent wallet: ${wallet.address}`);

if (wallet.address.toLowerCase() !== AGENT_EOA.toLowerCase()) {
  console.error(`❌ Keystore address (${wallet.address}) doesn't match AGENT_EOA (${AGENT_EOA})`);
  process.exit(1);
}

// ── Check BNB balance ───────────────────────────────────────────────────────
const balWei = await provider.getBalance(wallet.address);
const balBNB = parseFloat(ethers.formatEther(balWei));
console.log(`Agent BNB balance: ${balBNB} BNB`);

if (balBNB < 0.001) {
  console.error(`\n❌ INSUFFICIENT BNB for gas.`);
  console.error(`   Current balance: ${balBNB} BNB`);
  console.error(`   Required: ~0.001–0.003 BNB`);
  console.error(`\n   Send real BNB to: ${wallet.address}`);
  console.error(`   Then run this script again.`);
  process.exit(1);
}

// ── Check current registration status ──────────────────────────────────────
const contract = new ethers.Contract(COMPETITION_ADDRESS, COMPETITION_ABI, wallet);

const [isRegistered, regStart, regDeadline] = await Promise.all([
  contract.isRegistered(wallet.address),
  contract.registrationStart(),
  contract.registrationDeadline(),
]);

const startDate    = new Date(Number(regStart) * 1000);
const deadlineDate = new Date(Number(regDeadline) * 1000);
const now          = new Date();

console.log(`\nCompetition contract: ${COMPETITION_ADDRESS}`);
console.log(`Registration open:    ${startDate.toISOString()}`);
console.log(`Registration closes:  ${deadlineDate.toISOString()}`);
console.log(`Current time:         ${now.toISOString()}`);

if (isRegistered) {
  console.log(`\n✅ Agent already registered! Nothing to do.`);
  console.log(`   Address: ${wallet.address}`);
  console.log(`   Submit this address on DoraHacks: https://dorahacks.io/hackathon/bnbhack-twt-cmc/`);
  process.exit(0);
}

if (now > deadlineDate) {
  console.error(`\n❌ Registration deadline has PASSED (${deadlineDate.toISOString()})`);
  process.exit(1);
}

if (now < startDate) {
  console.error(`\n❌ Registration not open yet (opens: ${startDate.toISOString()})`);
  process.exit(1);
}

// ── Execute registration ────────────────────────────────────────────────────
console.log(`\n🚀 Registering agent at competition contract...`);
console.log(`   Sending register() from: ${wallet.address}`);

const feeData = await provider.getFeeData();
const tx = await contract.register({
  gasLimit: 100_000n,
  maxFeePerGas: feeData.maxFeePerGas,
  maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
});

console.log(`   TX submitted: ${tx.hash}`);
console.log(`   Waiting for confirmation...`);

const receipt = await tx.wait(1);

if (receipt?.status !== 1) {
  console.error(`❌ Transaction failed. Hash: ${tx.hash}`);
  process.exit(1);
}

// Verify registration event
const registeredEvent = receipt.logs.find(log => {
  try { return contract.interface.parseLog(log)?.name === "Registered"; }
  catch { return false; }
});

if (!registeredEvent) {
  console.error(`❌ No Registered event emitted. Something went wrong.`);
  process.exit(1);
}

console.log(`\n✅✅✅ REGISTERED SUCCESSFULLY`);
console.log(`   Agent EOA:   ${wallet.address}`);
console.log(`   TX Hash:     ${receipt.hash}`);
console.log(`   Block:       ${receipt.blockNumber}`);
console.log(`   BscScan:     https://bscscan.com/tx/${receipt.hash}`);
console.log(`\n📋 Next steps:`);
console.log(`   1. Paste this TX hash in your README.md smart-contract-addresses table`);
console.log(`   2. Submit agent address + TX hash on DoraHacks`);
console.log(`   3. Fund the RiskVault with capital before June 22`);
