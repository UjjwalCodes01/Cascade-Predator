/**
 * TWAK Keystore Generator
 *
 * Run this ONCE to create the AES-256 encrypted keystore from your raw private key.
 * After running, DELETE the raw key from .env and add only TWAK_WALLET_PASSWORD.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... TWAK_WALLET_PASSWORD=your-password node create-keystore.js
 *
 * Output: ./twak-keystore.json  (AES-encrypted, safe to store on disk)
 */
import { Wallet } from "ethers";
import { writeFileSync } from "fs";
import { resolve } from "path";

const privateKey = process.env.AGENT_PRIVATE_KEY;
const password   = process.env.TWAK_WALLET_PASSWORD;
const outputPath = process.env.TWAK_SIGNER_PATH ?? "./twak-keystore.json";

if (!privateKey || !password) {
  console.error("❌ Both AGENT_PRIVATE_KEY and TWAK_WALLET_PASSWORD must be set.");
  console.error("   Example: AGENT_PRIVATE_KEY=0x... TWAK_WALLET_PASSWORD=secret node create-keystore.js");
  process.exit(1);
}

console.log("🔐 Creating AES-256 encrypted TWAK keystore...");
console.log("   This may take a few seconds (scrypt key derivation)...");

const wallet = new Wallet(privateKey);
console.log(`   Agent wallet address: ${wallet.address}`);

const encrypted = await wallet.encrypt(password);

const absPath = resolve(outputPath);
writeFileSync(absPath, encrypted, "utf8");

console.log(`\n✅ Keystore written to: ${absPath}`);
console.log(`\n⚠️  Next steps:`);
console.log(`   1. REMOVE AGENT_PRIVATE_KEY from your .env file`);
console.log(`   2. ADD TWAK_WALLET_PASSWORD=<your-password> to .env`);
console.log(`   3. ADD TWAK_SIGNER_PATH=${outputPath} to .env (already the default)`);
console.log(`   4. The keystore file is AES-256 encrypted — safe on disk`);
console.log(`   5. NEVER commit twak-keystore.json or your password to git`);
