# CLAUDE.md

Operating manual for the AI coding assistant working in **Cascade Predator**. Read this before editing. `AGENT.md` holds detailed standards; this file is the behavioural contract.

---

## 1. Project context

**Track:** BNB Hack Track 2 — Strategy Skills (switched from Track 1)

Cascade Predator is a **CMC Strategy Skill** — not a live trading agent. It generates backtestable entry signals for liquidation cascade setups on BSC derivatives markets. Two codebases:

- **Python** (`skill-server/`) — ERC-8183 skill provider: CMC data fetch + cascade scorer + Gemini confirm. Serves signals as on-chain ERC-8183 deliverables.
- **TypeScript** (`agent/src/signal/`, `agent/src/risk/`, `backtest/`) — Pure signal functions and backtest harness.

**There is NO live trading, NO real capital, NO on-chain swaps.** The only on-chain activity is:
1. ERC-8004 identity registration (gas-free, BSC Testnet)
2. ERC-8183 job deliverable submissions (BSC Testnet, U tokens from faucet)

---

## 2. Golden rules — never violate

1. **The Python signal scorer and TypeScript signal core must stay in sync.** If you change the cascade score algorithm in one, update the other immediately. The backtest imports the TypeScript version; the skill server runs the Python version. They must produce identical output for identical inputs.
2. **No hardcoded values in signal or risk functions.** All thresholds, weights, and limits come from environment variables or the validated config module.
3. **Never log, print, or serialize API keys or wallet private keys.** The `PRIVATE_KEY` env var is for ERC-8004 registration only and is immediately stored in the encrypted keystore.
4. **signal/ and risk/ are pure functions.** No I/O, no clock, no randomness, no network calls. Any data needed must be passed as arguments. This is what makes the backtest deterministic.
5. **Backtest must remain deterministic.** Never introduce `Date.now()`, `Math.random()`, or network calls into `signal/` or `risk/`.
6. **No token launches, fundraising, or airdrop logic anywhere.**
7. **Never disable a test to make CI pass.** Fix the code.
8. **Graceful degradation is mandatory.** If CMC is down → return a clear error, not a false signal. If Gemini is down → fall back to threshold-only mode, not silence.

---

## 3. The two critical sync points

Any change to the cascade scoring algorithm needs to happen in **both** places:

| File | Language | Role |
|---|---|---|
| `agent/src/signal/index.ts` | TypeScript | Source of truth used by backtest |
| `skill-server/cascade_skill.py` | Python | Used by the live skill server |

If these diverge, the backtested performance metrics and the live signal output will disagree — a judge will notice.

---

## 4. Commands you will use

```bash
# Python skill server
cd skill-server
pip install -r requirements.txt
python register.py                     # ERC-8004 registration (run once)
uvicorn main:app --port 8003 --reload  # Development server
curl http://localhost:8003/skill/scan/CAKE   # Quick test without a job

# TypeScript agent (signal + risk only — no live trading)
cd agent && pnpm install
pnpm run typecheck
pnpm run lint
pnpm test                              # Signal golden tests + risk coverage
pnpm run paper                         # Simulation loop (no real trades)

# Backtest
cd backtest && pnpm install
pnpm start -- --from 2026-01-01 --to 2026-04-01
```

---

## 5. Module contracts

**Python (`skill-server/`):**
- `fetch_market_snapshot(token)` → `MarketSnapshot` — async, network I/O, may raise.
- `compute_cascade_score(snapshot, price_history)` → `(float, SignalComponents)` — PURE, no I/O.
- `consult_gemini(snapshot, score, components)` → `(bool, int, str)` — async, may fall back.
- `analyze_token(token)` → `dict` — the full pipeline, called by the ERC-8183 job handler.

**TypeScript:**
- `data/` → normalized `MarketSnapshot` object.
- `signal/` (PURE) → `{ token, cascadeScore, components }`.
- `decision/` → Gemini confirm → `TradeIntent | null`.
- `risk/` (PURE) → `{ approved, reason }`.

---

## 6. When you are unsure

- Prefer returning a **clear error** over a potentially wrong signal. Wrong signals are worse than no signals — a judge will read the output.
- Keep changes **minimal and inside the owning layer**. A targeted fix in `cascade_skill.py` beats a refactor that touches `main.py` and `register.py`.
- If a request conflicts with a golden rule, **do not comply silently** — surface the conflict.
- Do not fabricate CMC data, backtest results, or on-chain addresses. Use placeholders.

---

## 8. Quick reference

- Network: BSC Testnet (97) — all on-chain activity is here, gas-free
- ERC-8004 registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e` (testnet)
- ERC-8183 commerce: `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de` (testnet)
- Competition: Track 2, submit by June 21 on DoraHacks
- No live trading, no real capital, no mainnet
