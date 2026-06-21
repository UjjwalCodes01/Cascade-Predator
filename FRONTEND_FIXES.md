# FRONTEND_FIXES.md — Pre-Submission Frontend Bugs

Three real bugs found reviewing `cascade-predator-latest.zip`. Confirmed against the actual code, not guessed. Fix in order — #1 is the most dangerous, #3 unblocks the others being verifiable.

---

## Fix 1 — Remove the hardcoded fallback vault address *(highest priority, do first)*

Two files silently fall back to a contract address that is **not** the deployed RiskVault. The real one is `0x0dae11b453fdfc8cbc71bbeeb9caa5c9a0778726`. The fallback string `0xd69B4f5FAF6E3626F1E9C595a170F388798f713D` is wrong, of unknown origin, and currently shipping in two places:

- `frontend/app/api/vault/route.ts`
- `frontend/app/page.tsx`

If `NEXT_PUBLIC_RISK_VAULT_ADDRESS` is ever unset — a missing Vercel env var, a fresh local `.env`, a typo — the dashboard silently reads and offers transactions against the wrong contract. No error, no warning. This is the kind of bug that only surfaces when someone clicks "Pause" during a demo and nothing happens, or worse, happens against an address nobody controls.

### Patch — `frontend/app/api/vault/route.ts`

```ts
// BEFORE
const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-testnet.publicnode.com";
const vaultAddress = process.env.NEXT_PUBLIC_RISK_VAULT_ADDRESS || "0xd69B4f5FAF6E3626F1E9C595a170F388798f713D";

try {
  const provider = new JsonRpcProvider(rpcUrl);
  const vault = new Contract(vaultAddress, abi, provider);
  ...

// AFTER
const rpcUrl = process.env.BSC_RPC_URL;
const vaultAddress = process.env.NEXT_PUBLIC_RISK_VAULT_ADDRESS;

if (!rpcUrl || !vaultAddress) {
  return NextResponse.json(
    { error: "Server misconfigured: BSC_RPC_URL or NEXT_PUBLIC_RISK_VAULT_ADDRESS is not set." },
    { status: 500 }
  );
}

try {
  const provider = new JsonRpcProvider(rpcUrl);
  const vault = new Contract(vaultAddress, abi, provider);
  ...
```

No fallback URL either — `bsc-testnet.publicnode.com` silently reading testnet while you trade on mainnet is its own version of the same bug. Fail loud, not quiet.

### Patch — `frontend/app/page.tsx`

```ts
// BEFORE
const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "56");
const vaultAddress = process.env.NEXT_PUBLIC_RISK_VAULT_ADDRESS || "0xd69B4f5FAF6E3626F1E9C595a170F388798f713D";

// AFTER
const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "56"); // 56 default is fine — it's correct, not a guess
const vaultAddress = process.env.NEXT_PUBLIC_RISK_VAULT_ADDRESS;

if (!vaultAddress) {
  // Surface this immediately rather than letting togglePause silently target undefined/wrong address
  console.error("NEXT_PUBLIC_RISK_VAULT_ADDRESS is not set — vault actions are disabled.");
}
```

Then guard `togglePause` to refuse to run if `vaultAddress` is falsy:

```ts
const togglePause = async () => {
  if (!vaultAddress) {
    setErrorMsg("Vault address not configured. Contact the team — this should never happen in production.");
    return;
  }
  if (!account || !vault) return;
  ...
```

### Verify

```bash
cd frontend
grep -rn "0xd69B4f5FAF6E3626F1E9C595a170F388798f713D" app/   # should return nothing after the fix
```

Then confirm `NEXT_PUBLIC_RISK_VAULT_ADDRESS=0x0dae11b453fdfc8cbc71bbeeb9caa5c9a0778726` is actually set in Vercel project settings — this fix only protects against silent failure, it doesn't set the real value for you.

---

## Fix 2 — Make Sandbox Mode impossible to mistake for live data

`isSimSandbox` currently overrides every live value (`activeIntensity`, `activeDeviation`, `activeFunding`, `activeRegimeBlocked`) with manually-set slider values, and the only visual difference from Live Feed is a small toggle pill at the top of the page. The orb itself — the hero element, the thing a judge screenshots — looks **identical** whether driven by real agent data or a slider someone dragged.

This is a real risk during the actual demo recording, not just a hypothetical: one accidental click on "Sandbox Mode" while screen-recording, and the footage shows a manufactured cascade score with no indication it's fake.

### Decision

Keep Sandbox Mode — it's genuinely useful for testing the orb's visual states without waiting for a real cascade to form. But it must be **unmistakably** a different mode, not a toggle pill easy to miss.

### Patch — `frontend/app/page.tsx`

**1. Add a hazard-style border and label directly on the orb when sandbox is active.** Find the orb container `div` (`relative flex items-center justify-center rounded-full...`) and conditionally add a dashed warning border:

```tsx
<div
  className={`relative flex items-center justify-center rounded-full aspect-square w-[280px] md:w-[360px] z-10 select-none ${
    pulsePeriod > 0 ? "animate-orb-pulse" : ""
  } ${isSimSandbox ? "ring-2 ring-dashed ring-amber-500/60 ring-offset-4 ring-offset-[#0a0b0d]" : ""}`}
  ...
```

**2. Add a persistent banner above the orb whenever sandbox is active** — not just the toggle pill, an unmissable strip:

```tsx
{isSimSandbox && (
  <div className="w-full bg-amber-500/10 border border-amber-500/40 text-amber-300 text-xs font-data font-bold tracking-widest text-center py-2 rounded-md mb-2">
    ⚠ SANDBOX MODE — NOT LIVE DATA — FOR TESTING ONLY
  </div>
)}
```

Place this directly above the "Main CascadeOrb Centerpiece Container" div so it's structurally impossible to show the orb without the banner when sandbox is on.

**3. Make the toggle itself harder to hit by accident.** Add a one-step confirm — clicking "Sandbox Mode" while on Live Feed should require a second click or a brief hold, not a single click, since this is the control most likely to cause an accidental demo mistake:

```tsx
const [sandboxArmed, setSandboxArmed] = useState(false);

// In the toggle button:
<button
  onClick={() => {
    if (!sandboxArmed) {
      setSandboxArmed(true);
      setTimeout(() => setSandboxArmed(false), 2000); // arm window closes after 2s
      return;
    }
    setIsSimSandbox(true);
    setSandboxArmed(false);
  }}
  className={...}
>
  {sandboxArmed ? "Click again to confirm" : "Sandbox Mode"}
</button>
```

This is a small UX add, not a big lift, and it removes the "one misclick ruins the demo recording" risk entirely.

### Verify

Toggle into sandbox, confirm the banner and ring both appear immediately and are visually loud enough to notice from across a room (the bar judges will be sitting in). Toggle back to Live Feed, confirm both disappear cleanly.

---

## Fix 3 — Frontend must read `cascadeScore` from the agent, never recompute it

The signal core (`agent/src/signal/index.ts`) already computes the cascade score correctly — confirmed: `const cascadeScore = parseFloat(Math.min(rawScore, 100).toFixed(2));`. That value is written to the `Snapshot` table's `cascadeScore` field, which is **already returned by `/api/snapshot`** as `recentSnapshots[].cascadeScore`. The data is there and correct.

But `page.tsx` ignores it and recomputes its own score client-side:

```ts
// Score = sum of components
const computedScore = activeIntensity + activeDeviation + activeFunding;
const activeScore = Math.min(100, computedScore);
```

This is a duplicate, unaudited scoring formula sitting next to the real one, with no guarantee they agree (rounding, weighting, whatever logic lives in `SignalService` that a flat sum doesn't replicate). It directly violates the Phase 1 principle that the frontend is a *reader*, never a recalculator — the same principle that governs why the frontend never touches `agent/src/signal/`.

### Patch — `frontend/app/page.tsx`

Remove the recomputation. Read the real score directly from the live snapshot (or sandbox override only for the *display* value, never blended into real state):

```ts
// BEFORE
// Determine current active metrics based on Sandbox vs Live Mode
const activeIntensity = isSimSandbox ? simLiqIntensity : liveSnapshot.liquidationIntensity;
const activeDeviation = isSimSandbox ? simPriceDeviation : liveSnapshot.priceDeviation;
const activeFunding = isSimSandbox ? simFundingStress : liveSnapshot.fundingStress;
const activeRegimeBlocked = isSimSandbox ? simRegimeBlocked : liveSnapshot.regimeGateBlocked;

// Score = sum of components
const computedScore = activeIntensity + activeDeviation + activeFunding;
const activeScore = Math.min(100, computedScore);

// AFTER
const activeIntensity = isSimSandbox ? simLiqIntensity : liveSnapshot.liquidationIntensity;
const activeDeviation = isSimSandbox ? simPriceDeviation : liveSnapshot.priceDeviation;
const activeFunding = isSimSandbox ? simFundingStress : liveSnapshot.fundingStress;
const activeRegimeBlocked = isSimSandbox ? simRegimeBlocked : liveSnapshot.regimeGateBlocked;

// In sandbox, derive a display score from the slider components (sandbox has no real
// cascadeScore to read, since nothing is actually being scored by the agent).
// In live mode, ALWAYS read the agent's own computed score — never recompute it here.
const activeScore = isSimSandbox
  ? Math.min(100, activeIntensity + activeDeviation + activeFunding)
  : liveSnapshot.cascadeScore;
```

This keeps the sandbox slider math (it has to derive *something* to display since there's no real agent score to read in sandbox mode — that's fine, it's clearly labeled fake now per Fix 2) but guarantees **live mode always shows the exact number the agent computed**, with zero risk of drift between what the strategy actually decided and what the orb displays.

### Why this matters beyond correctness

If a judge ever cross-references the dashboard score against a value logged elsewhere (the ledger, a BscScan-linked trade's recorded `cascadeScore`, the backtest), the numbers must match exactly. A silent frontend recompute is exactly the kind of inconsistency a technical judge probing "is this real or cosmetic" would catch.

### Verify

```bash
cd frontend
grep -n "computedScore" app/page.tsx   # should return nothing after the fix
```

Then run the agent in paper mode for a few ticks, confirm the orb's displayed number matches the `cascadeScore` value being written to the `Snapshot` table (check via `prisma studio` or a direct query) — they should be identical, not just close.

---

## After all three fixes

```bash
cd frontend
pnpm typecheck
pnpm lint
pnpm build
```

Smoke test locally:
1. Load `/` with `NEXT_PUBLIC_RISK_VAULT_ADDRESS` correctly set — confirm vault data loads.
2. Temporarily unset `NEXT_PUBLIC_RISK_VAULT_ADDRESS` locally — confirm the app fails loudly (visible error, not silent wrong-address behavior), then restore the env var.
3. Toggle Sandbox Mode — confirm the banner and ring are unmistakable, confirm the two-click arm works.
4. Confirm the orb's number in Live Feed matches the agent's `Snapshot.cascadeScore` exactly.

Redeploy to Vercel once all three are verified.
