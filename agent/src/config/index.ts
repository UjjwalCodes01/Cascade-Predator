import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  BSC_RPC_URL: z.string().url().default("https://bsc-testnet.publicnode.com"),
  RISK_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid RiskVault address"),
  AGENT_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid agent wallet address"),
  TWAK_SIGNER_PATH: z.string().min(1).default("./twak-keystore.json"),
  TWAK_WALLET_PASSWORD: z.string().min(1), // Unlocks the encrypted keystore — never a raw private key
  CMC_API_KEY: z.string().min(1),
  X402_WALLET: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid X402 wallet address"),
  DATABASE_URL: z.string().default("postgresql://localhost:5432/cascade_predator"),
  CASCADE_SCORE_THRESHOLD: z.coerce.number().min(0).max(100).default(70),
  MAX_DRAWDOWN_PCT: z.coerce.number().min(1).max(29).default(20),
  EXIT_TIMEOUT_CANDLES: z.coerce.number().min(1).default(12),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // --- Trading Parameters (configurable, never hardcoded) ---
  TAKE_PROFIT_PCT: z.coerce.number().min(0.1).max(50).default(5),
  STOP_LOSS_PCT: z.coerce.number().min(0.1).max(20).default(3),
  TRADE_SIZE_PCT: z.coerce.number().min(1).max(100).default(10),
  VOLATILITY_LIQUIDATION_THRESHOLD: z.coerce.number().min(1000).default(100000),
  MONITORED_TOKENS: z.string().default("WBNB,CAKE"),
  // --- LLM (Google Gemini) ---
  GEMINI_API_KEY: z.string().optional(), // Required for live mode; paper mode falls back to threshold-only logic
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Environment configuration validation failed:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const config = parsed.data;

/** Parsed array of token symbols from MONITORED_TOKENS env var */
export const monitoredTokens: string[] = config.MONITORED_TOKENS
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter((t) => t.length > 0);

export type Config = typeof config;
