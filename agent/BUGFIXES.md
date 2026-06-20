# Cascade Predator — Pre-Submission Bug Fixes

Nine fixes from the code review. Do them in the order below. Each one stands alone — finish, commit, move on. After the last fix the repo is in shape for the bigger strategic changes (real backtest, CMC-native data, etc.).

**Branch strategy:** make these on a single `fix/pre-submission` branch, one commit per fix, then merge to `main`. That way if any one fix breaks something you can `git revert` just that commit.

---

## Fix 1 — Remove the committed keystore *(security, do first)*

The encrypted keystore for the agent's BSC wallet (`agent/twak-keystore.json`) is tracked by git even though it's listed in `.gitignore`. Anyone reading the public repo can see the encrypted blob and the wallet address `0x3660362beb3a95ce16d981e7d30e1e025e741393`.

Encryption helps, but a brute-force-able keystore tied to a known address is a "why is this here" question you don't want a judge asking. Treat the existing wallet as burned.

### Steps

```bash
# 1. Untrack the file (keeps the local copy)
git rm --cached agent/twak-keystore.json

# 2. Confirm it stays ignored
grep '^twak-keystore.json$' agent/.gitignore  # should print the line

# 3. Commit
git commit -m "sec(agent): remove committed TWAK keystore"

# 4. Generate a fresh wallet & keystore (the current one is compromised)
cd agent
node create-keystore.mjs       # follow prompts; new address printed at the end
cd ..

# 5. Fund the NEW agent address on BSC mainnet (BNB for gas + USDT/WBNB for trading)
# 6. Update agent role on RiskVault to the new address:
cast send $RISK_VAULT_ADDRESS "setAgent(address)" $NEW_AGENT_ADDRESS \
  --rpc-url $BSC_RPC_URL --private-key $OWNER_PRIVATE_KEY
# 7. Re-register the new agent at the competition contract before the trading window
twak compete register
```

### Note on git history

`git rm --cached` removes the file from the *current* commit, but the keystore is still in the repo's history. For a hackathon submission this is acceptable since you've burned the wallet — judges won't `git log -p` for old blobs. If you want it fully gone, `git filter-repo --path agent/twak-keystore.json --invert-paths` then force-push, but only if you control the only clone.

---

## Fix 2 — Token registry matches monitored tokens *(crash blocker)*

`main.py` defaults to monitoring `WBNB,CAKE,FLOKI,TWT,PENDLE`, but `tokens.py` only knows `WBNB, CAKE, ETH, BTC, USDT`. The server crashes on any FLOKI / TWT / PENDLE job with `ValueError: Token '…' is not in the registry`. The demo dies.

### Decision

Add the missing tokens to the registry rather than shrinking the default list — more covered tokens means more cascade signals during the demo.

### Patch — `skill-server/tokens.py`

Add these entries inside `TOKEN_REGISTRY`:

```python
"FLOKI": {
    "address": "0xfb5B838b6cfEEdC2873aB27866079AC55363D37E",
    "futuresPair": "FLOKIUSDT",
    "cmcSymbol": "FLOKI",
},
"TWT": {
    "address": "0x4B0F1812e5Df2A09796481Ff14017e6005508003",
    "futuresPair": "TWTUSDT",
    "cmcSymbol": "TWT",
},
"PENDLE": {
    "address": "0xb3Ed0A426155B79B898849803E3B36552f7ED507",
    "futuresPair": "PENDLEUSDT",
    "cmcSymbol": "PENDLE",
},
```

### Mirror the change in `agent/src/tokens/index.ts`

`tokens.py` is documented to mirror the TS file exactly. Add the same three entries there too so paper/live mode and the skill server stay in sync.

### Verify

```bash
cd skill-server
python -c "from tokens import get_token_info; [print(t, get_token_info(t)['futuresPair']) for t in ['WBNB','CAKE','FLOKI','TWT','PENDLE']]"
# Should print 5 lines with no exception.
```

### Important — verify the BSC addresses before trusting them

The addresses above are the commonly-used BSC mainnet contracts for those tokens, but **always verify against BscScan before committing** — a wrong address means the agent could route a swap into a fake token. Cross-check each on `https://bscscan.com/token/<address>` and confirm the symbol matches.

### Commit

```
fix(skill-server): add FLOKI/TWT/PENDLE to token registry to match default MONITORED_TOKENS
```

---

## Fix 3 — Wire x402 to a real 402→pay→retry call *(judging-impact)*

`agent/src/x402/index.ts` currently signs an EIP-191 message and writes the signature into the DB under a column called `txHash`. There is no HTTP 402, no payment, no retry, no settlement. The TWAK criteria explicitly say: *"Real, not a README mention."* A judge that opens the file will see this in 30 seconds.

### Minimum viable fix for the deadline

Pick **one** real call in the trade loop and route it through `X402Service.executeWithPayment`. The cleanest target is a CMC data fetch in `agent/src/data/index.ts` — the function `X402Service.executeWithPayment` already exists and handles the 402→pay→retry flow correctly. You just have to *use* it.

### Patch — wherever you fetch a CMC paid endpoint

Replace a direct `fetch()` call with the wrapped variant. Pseudocode of the change:

```ts
// BEFORE
const res = await fetch(cmcUrl, { headers: { "X-CMC_PRO_API_KEY": apiKey } });
const data = await res.json();

// AFTER — uses the existing x402 wrapper
const data = await X402Service.executeWithPayment(
  async (paymentHeader) => {
    const headers: Record<string, string> = { "X-CMC_PRO_API_KEY": apiKey };
    if (paymentHeader) headers["Authorization"] = paymentHeader;
    const r = await fetch(cmcUrl, { headers });
    return { status: r.status, data: r.status === 200 ? await r.json() : undefined };
  },
  `cmc/${endpointName}`,
  "0.01"     // cost per request
);
```

### Also fix the misleading DB column

The `txHash` column in `X402Ledger` stores an EIP-191 signature, not a tx hash. Rename it in `prisma/schema.prisma`:

```prisma
// BEFORE
model X402Ledger {
  ...
  txHash      String
  ...
}

// AFTER
model X402Ledger {
  ...
  paymentProof String   // EIP-191 signature payload
  ...
}
```

Run `pnpm prisma migrate dev --name rename-x402-txhash-to-paymentproof` and update the two references in `x402/index.ts` (`txHash` → `paymentProof`).

### What this gets you

A judge opening the code sees: real 402 response handling, a real signed payment header on the retry, real ledger entries labeled correctly. The story changes from "you logged signatures" to "you metered one real CMC call through x402, and the wrapper is generic enough to meter more." That's the bare minimum that survives scrutiny.

### Commit

```
fix(x402): route one real CMC call through 402→pay→retry; rename txHash to paymentProof
```

---

## Fix 4 — `SKILL.md` data-source table tells the truth *(credibility)*

The "CMC Data Dependencies" table in `SKILL.md` lists `/v1/cryptocurrency/market-pairs/latest` and `/v2/cryptocurrency/funding-fee/latest` as the sources for OI and funding rate. The code does not call either — derivatives come from Binance Futures. A Track 2 judge reads the spec, then opens the code. The mismatch reads as misleading.

### Two options — pick the honest one

**Option A (faster, what to do for the deadline):** rewrite the table to match what the code actually does. Then add a note explaining why.

**Option B (better, but bigger change):** actually switch the derivatives source to CMC's endpoints. This is the Tier-1 strategic move from the follow-up plan. Do it *after* the bug fixes are merged and the repo is stable.

### Patch for Option A — replace the table in `SKILL.md`

```markdown
## Data Dependencies

The cascade signal combines two complementary live data sources:

| Source | Endpoint / Method | Fields Used | Why |
|---|---|---|---|
| **CoinMarketCap Agent Hub (MCP)** | `detect_market_regime` skill | `fear_greed_value`, `market_regime`, `leverage_state`, `liquidation_state`, `conviction` | Regime context — gates entries so the skill doesn't fire in trending/euphoric markets |
| **CoinMarketCap REST API** | `GET /v2/cryptocurrency/quotes/latest` | `price`, `volume_24h`, `percent_change_1h` | Spot price + recent momentum |
| **CoinMarketCap REST API** | `GET /v3/fear-and-greed/latest` | `value` | Fallback regime input if the MCP call fails |
| **Binance Futures (public API)** | `premiumIndex`, `openInterest`, `globalLongShortAccountRatio`, `takerlongshortRatio` | `lastFundingRate`, `openInterest`, taker buy/sell volume | Per-token derivatives — used to estimate liquidation intensity |

> **Note:** Per-token funding rate and open interest are sourced from Binance Futures because CMC's derivatives endpoints aggregate across exchanges, while cascade detection needs the venue-specific snapshot a single perp market sees. The regime layer (fear & greed, leverage/liquidation state, market regime) is sourced entirely from CMC via MCP. CMC-native derivatives sourcing is on the roadmap.
```

### Commit

```
docs(skill): correct data-source table to match actual code; document Binance derivatives use
```

---

## Fix 5 — Remove dead HMAC code in `cascade_skill.py` *(cleanliness)*

In `check_token_risk_with_twak` → `_twak_sign_request` the HMAC signature is computed twice. The first (hex) result is immediately overwritten by the second (base64) result, and there's an `import base64` mid-function with a "fix:" comment. It works, but it screams "draft code."

### Patch — `skill-server/cascade_skill.py`

Find the block inside `_twak_sign_request`:

```python
# BEFORE
signature = hmac.new(
    TWAK_HMAC_SECRET.encode(),
    plaintext.encode(),
    hashlib.sha256
).hexdigest()
# CLI uses base64, not hex — fix:
import base64
signature = base64.b64encode(
    hmac.new(TWAK_HMAC_SECRET.encode(), plaintext.encode(), hashlib.sha256).digest()
).decode()
```

Replace with:

```python
# AFTER
signature = base64.b64encode(
    hmac.new(TWAK_HMAC_SECRET.encode(), plaintext.encode(), hashlib.sha256).digest()
).decode()
```

And move `import base64` to the top of the file with the other imports.

### Commit

```
refactor(skill): remove dead HMAC hex computation; hoist base64 import
```

---

## Fix 6 — Persist price history across restarts *(correctness)*

`_price_history` in `cascade_skill.py` is a module-level dict that lives only in memory. If the uvicorn process restarts during the competition week — crash, redeploy, server reboot — every token's history resets to empty. The next ~20 ticks compute `priceDeviation` against a short, non-representative window and emit misleading scores. During a live judging week that's a real risk.

### Patch — three small pieces

**1. Add a Prisma model in `skill-server`** (or sqlite if you prefer keeping the skill server stateless from Postgres). Simplest: SQLite via the standard library, in `skill-server/price_history.py`:

```python
import sqlite3
from pathlib import Path

_DB_PATH = Path(__file__).parent / ".agent-data" / "price_history.sqlite"
_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.execute("""CREATE TABLE IF NOT EXISTS price_history (
        token TEXT NOT NULL,
        price REAL NOT NULL,
        ts INTEGER NOT NULL
    )""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_price_token_ts ON price_history(token, ts DESC)")
    return c

def append(token: str, price: float, ts: int, max_keep: int = 20) -> None:
    with _conn() as c:
        c.execute("INSERT INTO price_history (token, price, ts) VALUES (?, ?, ?)",
                  (token, price, ts))
        # Keep only the latest max_keep rows per token
        c.execute("""DELETE FROM price_history
                     WHERE rowid IN (
                       SELECT rowid FROM price_history
                       WHERE token = ?
                       ORDER BY ts DESC
                       LIMIT -1 OFFSET ?
                     )""", (token, max_keep))

def load(token: str, max_keep: int = 20) -> list[float]:
    with _conn() as c:
        rows = c.execute("""SELECT price FROM price_history
                            WHERE token = ?
                            ORDER BY ts ASC
                            LIMIT ?""", (token, max_keep)).fetchall()
    return [r[0] for r in rows]
```

**2. Replace the in-memory dict in `cascade_skill.py`:**

```python
# BEFORE
_price_history: dict[str, list[float]] = {}

async def analyze_token(token: str) -> dict:
    ...
    if token not in _price_history:
        _price_history[token] = []
    _price_history[token].append(snapshot.price)
    if len(_price_history[token]) > 20:
        _price_history[token] = _price_history[token][-20:]
    cascade_score, components = compute_cascade_score(snapshot, _price_history[token])
```

```python
# AFTER
from price_history import append as ph_append, load as ph_load

async def analyze_token(token: str) -> dict:
    ...
    ph_append(token, snapshot.price, snapshot.timestamp)
    history = ph_load(token)
    cascade_score, components = compute_cascade_score(snapshot, history)
```

**3. Update `agent/.gitignore` and root `.gitignore`** to exclude the sqlite file:

```
skill-server/.agent-data/
```

(The directory already exists in the zip; just make sure its contents aren't committed.)

### Commit

```
fix(skill): persist price history to SQLite so restarts don't corrupt cascade scores
```

---

## Fix 7 — Defensive CMC quote parsing *(robustness)*

```python
quote_data = quote_resp.json()["data"][token_info["cmcSymbol"]][0]["quote"]["USD"]
```

CMC's `quotes/latest` response shape for `data[SYMBOL]` is sometimes a list (when multiple coins share the symbol) and sometimes a dict (when only one). The `[0]` assumes list. On any token where CMC returns a dict, this raises `KeyError: 0` and the snapshot fetch fails silently — meaning that token never trades.

### Patch — `skill-server/cascade_skill.py`

```python
# BEFORE
quote_data = quote_resp.json()["data"][token_info["cmcSymbol"]][0]["quote"]["USD"]

# AFTER
raw = quote_resp.json()["data"][token_info["cmcSymbol"]]
entry = raw[0] if isinstance(raw, list) else raw
quote_data = entry["quote"]["USD"]
```

### Mirror in `agent/src/data/index.ts`

If the TS data layer has the same access pattern, apply the equivalent normalization (check `Array.isArray(raw) ? raw[0] : raw`).

### Commit

```
fix(skill,agent): handle both list and dict shapes from CMC quotes/latest
```

---

## Fix 8 — Gitignore the registration artifact *(housekeeping)*

`skill-server/.agent-registration.json` is written by `register.py` and committed to the repo. It contains the testnet agent ID and tx hash. Not a security problem (testnet), but it shouldn't be in source control — it's an output, not a config.

### Patch — append to root `.gitignore`

```
# Generated by register.py
skill-server/.agent-registration.json
```

Then:

```bash
git rm --cached skill-server/.agent-registration.json
git add .gitignore
git commit -m "chore: gitignore generated agent registration artifact"
```

(Keep the local copy — `git rm --cached` removes only from the index. Future runs of `register.py` will overwrite it locally and it won't be re-tracked.)

---

## Fix 9 — Ship a runnable backtest with committed results *(Track 2 deliverable)*

Track 2 explicitly asks for a *backtestable strategy spec*. The SKILL.md documents `cd backtest && pnpm start -- --from 2026-01-01 --to 2026-04-01`, but there is no `backtest/` directory. A judge who follows the README hits "no such file or directory" and the submission is incomplete.

**Strictly speaking this is bigger than a bug fix** — it's the Tier-1 strategic deliverable. But it has to ship for the submission to be valid, so it stays on this list as item 9 with a smaller scope: a *minimum-viable* backtest that proves the harness exists, replays the live signal code, and emits results.

### Scope for the deadline version

- A `backtest/` package that imports `signal/` and `risk/` from the agent **unchanged** (so the live and backtest signal logic are provably identical).
- Replays historical CMC + Binance data (cached to JSON to avoid hitting rate limits during repeated runs).
- Simulates 0.25% per-leg fees (= 0.50% round-trip), matching the SKILL.md spec.
- Emits a CSV of trades and a small `RESULTS.md` with: cumulative return, max drawdown, win rate, average hold, trade count, comparison vs. buy-and-hold.

A v2 with walk-forward, regime stratification, and equity-curve plot is the Tier-1 follow-up — out of scope for this bug-fix pass.

### Concretely

```
backtest/
├── package.json
├── src/
│   ├── replay.ts          # iterates historical snapshots, calls SignalService.computeScore
│   ├── fees.ts            # applies 0.25%/leg
│   ├── metrics.ts         # cumulative return, MDD, win rate, hold time
│   └── index.ts           # CLI: parses --from --to, writes results
├── data/                  # cached historical snapshots (JSON, gitignored)
└── RESULTS.md             # committed; latest run's numbers
```

### Commit

```
feat(backtest): minimum-viable replay harness + committed RESULTS.md
```

---

## After all nine fixes

1. Re-run the local smoke test on every entrypoint:

```bash
cd skill-server && uvicorn main:app --port 8003 &   # ensure boot
sleep 3
curl -s http://localhost:8003/skill/info | jq .name # should print cascade-predator
curl -s http://localhost:8003/skill/scan/CAKE | jq '.cascadeScore'
kill %1
cd ../agent && pnpm build                            # compiles clean
cd ../backtest && pnpm start -- --from 2026-01-01 --to 2026-04-01
```

2. Merge `fix/pre-submission` to `main`.

3. Tag the merge commit as `v0.9-bugfix` so you can always come back to a known-good state before the strategic-change work begins.

```bash
git tag -a v0.9-bugfix -m "All 9 pre-submission bug fixes merged"
git push origin v0.9-bugfix
```

After this you're cleared for the bigger strategic work: CMC-native derivatives sourcing, real CMC Skill packaging, regime self-disable gate, demo video, writeup.
