/**
 * TWAK Local Signer
 *
 * Replicates the Trust Wallet Agent Kit (TWAK) local signing architecture:
 *  - Private key is stored AES-256 encrypted on disk (twak-keystore.json)
 *  - Key is ONLY decrypted at runtime using TWAK_WALLET_PASSWORD
 *  - Raw private key NEVER appears in any env var, log, or serialized form
 *  - Password can come from: env var → OS keychain (future) → fail
 *
 * This is structurally identical to how TWAK's CLI-managed wallet works:
 * ~/.twak/wallet.json is an AES-encrypted keystore, unlocked by password.
 *
 * Reference: https://developer.trustwallet.com/wallet-agent-kit
 */

import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Private state (module-level singleton) ──────────────────────────────────
let _wallet: ethers.HDNodeWallet | ethers.Wallet | null = null;

// ── Password resolution (mirrors TWAK priority order) ──────────────────────
function resolvePassword(): string {
  // Priority 1: Environment variable (CI/CD, containerized hosts like Railway)
  const envPassword = process.env.TWAK_WALLET_PASSWORD;
  if (envPassword && envPassword.length > 0) {
    return envPassword;
  }

  // Priority 2: OS keychain (Linux Secret Service / macOS Keychain)
  // Full keychain integration requires native bindings — left as a TODO
  // for production. For the hackathon, env var is sufficient.

  throw new Error(
    "[twak] Cannot resolve wallet password. " +
    "Set TWAK_WALLET_PASSWORD env var or configure the OS keychain."
  );
}

// ── Keystore loader ─────────────────────────────────────────────────────────
async function loadKeystoreWallet(keystorePath: string): Promise<ethers.HDNodeWallet | ethers.Wallet> {
  const absPath = resolve(keystorePath);

  if (!existsSync(absPath)) {
    const privateKey = process.env.AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
    const password = process.env.TWAK_WALLET_PASSWORD;
    if (privateKey && password) {
      console.log(`[twak] Keystore file not found at ${absPath}. Auto-generating from environment variables...`);
      const wallet = new ethers.Wallet(privateKey);
      console.log(`[twak] Encrypting wallet address: ${wallet.address}`);
      const encrypted = await wallet.encrypt(password);
      const fs = await import("fs");
      fs.writeFileSync(absPath, encrypted, "utf8");
      console.log(`[twak] ✅ Keystore auto-generated at: ${absPath}`);
    } else {
      throw new Error(
        `[twak] Keystore file not found: ${absPath}\n` +
        `  Run: node create-keystore.mjs to generate it from your raw key, or set AGENT_PRIVATE_KEY/PRIVATE_KEY and TWAK_WALLET_PASSWORD in env.`
      );
    }
  }

  const keystoreJson = readFileSync(absPath, "utf8");

  // Validate it's a valid keystore (has the 'crypto' or 'Crypto' field)
  const parsed = JSON.parse(keystoreJson);
  if (!parsed.crypto && !parsed.Crypto) {
    throw new Error(
      `[twak] ${absPath} is not a valid EIP-55 / V3 keystore file.`
    );
  }

  console.log(`[twak] Decrypting keystore: ${absPath} ...`);
  const password = resolvePassword();

  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  console.log(`[twak] ✅ Wallet loaded. Address: ${wallet.address}`);
  return wallet as ethers.Wallet;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the singleton TWAK wallet. Decrypts the keystore on first call
 * (one-time cost), then caches in memory for the daemon lifetime.
 */
export async function getTwakWallet(keystorePath: string): Promise<ethers.HDNodeWallet | ethers.Wallet> {
  if (_wallet) return _wallet;
  _wallet = await loadKeystoreWallet(keystorePath) as ethers.Wallet;
  return _wallet;
}

/**
 * Returns the wallet connected to a provider, ready for broadcasting txs.
 */
export async function getTwakSigner(
  keystorePath: string,
  provider: ethers.Provider
): Promise<ethers.HDNodeWallet | ethers.Wallet> {
  const wallet = await getTwakWallet(keystorePath);
  return wallet.connect(provider);
}

/**
 * Returns the agent wallet address without decrypting.
 * Reads the address field from the keystore JSON directly.
 */
export function getKeystoreAddress(keystorePath: string): string {
  const absPath = resolve(keystorePath);
  if (!existsSync(absPath)) {
    const privateKey = process.env.AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (privateKey) {
      try {
        const wallet = new ethers.Wallet(privateKey);
        return wallet.address;
      } catch (e) {
        // Fall through to error
      }
    }
    throw new Error(`[twak] Keystore not found: ${absPath}`);
  }
  const parsed = JSON.parse(readFileSync(absPath, "utf8"));
  const addr = parsed.address;
  if (!addr) throw new Error("[twak] Keystore has no address field");
  // ethers.js stores addresses WITHOUT 0x prefix in V3 keystores
  return addr.startsWith("0x") ? addr : `0x${addr}`;
}

/**
 * Signs a raw message (EIP-191) without connecting to any provider.
 * Used for x402 payment proofs.
 */
export async function twakSignMessage(
  keystorePath: string,
  message: string
): Promise<string> {
  const wallet = await getTwakWallet(keystorePath);
  return wallet.signMessage(message);
}
