# AGENT.md

The rulebook for everyone — human or AI — contributing to **Cascade Predator**. `README.md` explains the product; this file governs *how the repo is worked in*. `CLAUDE.md` is the operating manual for the AI coding assistant and defers to this file for standards.

---

## 1. Project context

**Track:** BNB Hack Track 2 — Strategy Skills (switched from Track 1 due to mainnet capital requirements)

Cascade Predator is a **CMC Strategy Skill** — a deployable signal generator that detects liquidation cascade setups on BSC derivatives markets. Three parts:

- **Python Skill Server** (`skill-server/`) — A FastAPI ERC-8183 provider that accepts analysis jobs, fetches live CMC derivatives data, computes a cascade probability score, confirms with Gemini, and returns a structured JSON signal as the on-chain deliverable.
- **TypeScript Signal Core** (`agent/src/signal/`, `agent/src/risk/`) — Pure, deterministic functions used by the backtest harness. No I/O, no side effects. The Python server mirrors this logic exactly.
- **Backtest Harness** (`backtest/`) — Historical replay that runs the same signal + risk modules, proving the edge net of fees.

**On-chain footprint (BSC Testnet, all free):**
- ERC-8004 agent identity: registered via `skill-server/register.py` (gas-free via MegaFuel paymaster)
- ERC-8183 job completions: signal deliverables anchored on-chain for each completed job

## 2. Repository rules

- **Monorepo, pnpm workspaces** (agent, backtest) + Python package (`skill-server/`). Respect package boundaries.
- **`main` is always submittable.** No direct pushes; all changes via PR.
- **No secrets in the repo, ever.** Only `.env.example` files are committed. Real keys in host secrets or local `.env`.
- **Determinism is sacred.** `signal/` and `risk/` (TypeScript) and `cascade_skill.py` signal scorer (Python) must produce identical output for identical input. No `Date.now()`, no network, no randomness in these paths.
- **One change, one concern.** Especially in `signal/`, `risk/`, and `cascade_skill.py`.

## 3. Coding standards

**Python (`skill-server/`)**
- Python 3.10+, type hints on all functions, `dataclasses` for data models.
- Async where needed (CMC fetch, Gemini call); sync where safe (score computation).
- No hardcoded API keys, thresholds, or addresses. All read from environment.
- Match the TypeScript signal algorithm exactly — if you change the TypeScript, update the Python too, and vice versa.
- Graceful degradation: if CMC data is unavailable, return a clear error. If Gemini is unavailable, fall back to threshold-only mode.

**TypeScript (agent, backtest)**
- Strict mode. No `any` in committed code.
- `signal/` and `risk/` are **pure functions** — no I/O, no clock, no side effects.
- Single validated config module reads env once.
- Fail safe: on any uncertainty in the signal pipeline, return no signal.

## 4. Testing requirements

**Python skill server:**
- Unit tests for `compute_cascade_score()` with fixed inputs → expected outputs.
- Mock CMC API responses to test the full pipeline without live network calls.
- Verify Gemini fallback behaviour when API key is missing.

**TypeScript agent:**
- `signal/` golden tests: fixed snapshots → expected scores.
- `risk/` near-exhaustive branch coverage.
- Backtest must show positive return net of simulated fees (0.25% per leg).

## 5. Security requirements

- **No live capital required.** Track 2 does not involve real trades. No private keys with real funds should be committed or used in the signal pipeline.
- **WALLET_PASSWORD and PRIVATE_KEY** for ERC-8004 registration are only used once, stored in the encrypted keystore (`~/.bnbagent/wallets/`), then the plaintext `PRIVATE_KEY` can be removed from `.env`.
- **CMC and Gemini API keys** are read from `.env` only, never hardcoded or logged.
- **ERC-8183 jobs:** the skill server only signs deliverable submissions — it does not hold trading capital or execute swaps.

## 6. Folder structure

```
cascade-predator/
├── SKILL.md                      # Track 2 formal deliverable
├── README.md                     # Product overview
├── AGENT.md                      # This file
├── CLAUDE.md                     # AI assistant operating manual
├── skill-server/                 # Python ERC-8183 skill server
│   ├── main.py                   # FastAPI entry point (create_erc8183_app)
│   ├── cascade_skill.py          # Core strategy logic (CMC + scorer + Gemini)
│   ├── register.py               # ERC-8004 one-shot registration
│   ├── requirements.txt
│   └── .env.example
├── agent/
│   ├── src/signal/               # TypeScript signal core (PURE — matches Python)
│   ├── src/decision/             # Gemini decision layer
│   ├── src/risk/                 # Off-chain guards (PURE)
│   ├── src/data/                 # CMC API clients
│   └── src/loop/                 # Simulation loop (paper mode)
├── backtest/                     # Historical replay harness
└── config/
    └── token-allowlist.json      # 149 eligible BEP-20 tokens
```

## 7. Commit conventions

Conventional Commits:
```
<type>(<scope>): <subject>
```
Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`.
Scopes: `skill-server`, `signal`, `risk`, `decision`, `backtest`, `docs`.

## 8. Hackathon submission checklist

- [ ] `SKILL.md` complete with input/output schema, entry/exit logic, backtest metrics
- [ ] `skill-server/` runs locally with `uvicorn main:app --port 8003`
- [ ] ERC-8004 identity registered (run `python register.py`)
- [ ] At least one ERC-8183 job completed on BSC Testnet (on-chain proof)
- [ ] Backtest shows positive return net of fees (`cd backtest && pnpm start`)
- [ ] Public repo with this README, AGENT.md, SKILL.md
- [ ] DoraHacks submission with strategy write-up and on-chain proof
- [ ] No token launches, fundraising, or airdrop activity
