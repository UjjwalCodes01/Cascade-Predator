"use client";

import { useEffect, useState, startTransition, useRef } from "react";
import { BrowserProvider, Contract } from "ethers";
import vaultAbi from "@/abi/RiskVault.json";

interface SnapshotMetric {
  vaultBalance: string;
  dailyVolume: string;
  dailyCount: number;
  drawdownPct: number;
}

interface OpenPosition {
  id: string;
  token: string;
  entryPrice: number;
  exitPrice: number | null;
  amount: string;
  status: string;
  openedAt: string;
  pnl: number | null;
}

interface RecentSnapshot {
  id: string;
  token: string;
  cascadeScore: number;
  liquidationIntensity: number;
  priceDeviation: number;
  fundingStress: number;
  fearGreed: number;
  regimeGateBlocked: boolean;
  timestamp: string;
}

interface VaultData {
  owner: string;
  agent: string;
  paused: boolean;
  maxPositionBps: number;
  dailyVolume: string;
  dailyCount: number;
  dailyVolumeCap: string;
  dailyCountCap: number;
}

// ── Custom State Machine Hook for the CascadeOrb ─────────────────────────────
interface OrbStateInput {
  score: number;
  components: { liquidationIntensity: number; priceDeviation: number; fundingStress: number };
  activePosition: OpenPosition | null;
  regimeGateBlocked: boolean;
  isStale: boolean;
  recentTrades: any[];
}

function useOrbState({
  score,
  components,
  activePosition,
  regimeGateBlocked,
  isStale,
  recentTrades,
}: OrbStateInput) {
  const [state, setState] = useState<"quiet" | "climbing" | "igniting" | "live" | "exit-tp" | "exit-sl" | "blocked" | "stale">("quiet");
  const [prevPosition, setPrevPosition] = useState<OpenPosition | null>(null);
  const [ignitionKey, setIgnitionKey] = useState(0);
  const [prevScore, setPrevScore] = useState(score);

  // Monitor position close transitions
  useEffect(() => {
    if (prevPosition && !activePosition) {
      // Position just closed. Check PnL
      const wasProfitable = prevPosition.pnl ? prevPosition.pnl > 0 : false;
      if (wasProfitable) {
        setState("exit-tp");
        const t = setTimeout(() => setState("quiet"), 600);
        return () => clearTimeout(t);
      } else {
        setState("exit-sl");
        const t = setTimeout(() => setState("quiet"), 600);
        return () => clearTimeout(t);
      }
    }
    setPrevPosition(activePosition);
  }, [activePosition, prevPosition]);

  // Monitor threshold crossing (ignition event)
  useEffect(() => {
    if (prevScore < 70 && score >= 70 && !activePosition && state !== "igniting") {
      setState("igniting");
      setIgnitionKey((k) => k + 1);
      const t = setTimeout(() => {
        setState(activePosition ? "live" : "quiet");
      }, 600);
      return () => clearTimeout(t);
    }
    setPrevScore(score);
  }, [score, prevScore, activePosition, state]);

  // General state update
  useEffect(() => {
    if (state === "exit-tp" || state === "exit-sl" || state === "igniting") {
      return;
    }

    if (isStale) {
      setState("stale");
    } else if (regimeGateBlocked) {
      setState("blocked");
    } else if (activePosition) {
      setState("live");
    } else if (score >= 70) {
      setState("live"); // transition state
    } else if (score >= 40) {
      setState("climbing");
    } else {
      setState("quiet");
    }
  }, [score, activePosition, regimeGateBlocked, isStale, state]);

  // Compute ring color based on state and score
  let ringColor = "#4d6478"; // quiet default
  if (state === "blocked") ringColor = "#6c7480"; // desaturated grey
  else if (state === "stale") ringColor = "rgba(77, 100, 120, 0.4)";
  else if (state === "exit-tp") ringColor = "#5fb38a";
  else if (state === "exit-sl") ringColor = "#e34b3a";
  else if (state === "igniting" || state === "live") ringColor = "#e34b3a";
  else if (state === "climbing") {
    // Interpolate: score 40 -> 70 (0% -> 100% of range)
    const pct = Math.max(0, Math.min(1, (score - 40) / 30));
    const r = Math.round(77 + (217 - 77) * pct);
    const g = Math.round(100 + (146 - 100) * pct);
    const b = Math.round(120 + (87 - 120) * pct);
    ringColor = `rgb(${r}, ${g}, ${b})`;
  }

  // Compute pulse breathing period
  let pulsePeriod = 2.0; // 2 seconds
  if (state === "climbing") {
    // Speed up pulse period linearly from 2s (at score 40) to 1s (at score 70)
    pulsePeriod = 2.0 - Math.max(0, Math.min(1, (score - 40) / 30)) * 1.0;
  } else if (state === "igniting" || state === "live") {
    pulsePeriod = 1.0;
  } else if (state === "blocked" || state === "stale") {
    pulsePeriod = 0; // stop pulsing
  }

  return { state, ringColor, pulsePeriod, ignitionKey };
}

export default function LiveDashboard() {
  const [metric, setMetric] = useState<SnapshotMetric | null>(null);
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [recentSnapshots, setRecentSnapshots] = useState<RecentSnapshot[]>([]);
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [vault, setVault] = useState<VaultData | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string>("WBNB");

  // Sandbox/Simulation mode state
  const [isSimSandbox, setIsSimSandbox] = useState(false);
  const [simLiqIntensity, setSimLiqIntensity] = useState(15);
  const [simPriceDeviation, setSimPriceDeviation] = useState(12);
  const [simFundingStress, setSimFundingStress] = useState(5);
  const [simRegimeBlocked, setSimRegimeBlocked] = useState(false);
  const [sandboxArmed, setSandboxArmed] = useState(false);

  // Wallet connection state
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPendingTx, setIsPendingTx] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);

  const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "56");
  const vaultAddress = process.env.NEXT_PUBLIC_RISK_VAULT_ADDRESS;

  useEffect(() => {
    if (!vaultAddress) {
      console.error("NEXT_PUBLIC_RISK_VAULT_ADDRESS is not set — vault actions are disabled.");
    }
  }, [vaultAddress]);

  const fetchLiveState = async () => {
    try {
      const snapRes = await fetch("/api/snapshot");
      const snapData = await snapRes.json();
      if (snapRes.ok) {
        setMetric(snapData.metric);
        setOpenPositions(snapData.openPositions || []);
        setRecentSnapshots(snapData.recentSnapshots || []);
        setRecentTrades(snapData.recentTrades || []);
        setAsOf(snapData.asOf);

        // Check if data is older than 30 seconds
        if (snapData.asOf) {
          const diff = Date.now() - new Date(snapData.asOf).getTime();
          setIsStale(diff > 30000);
        }
      }

      const vaultRes = await fetch("/api/vault");
      const vaultData = await vaultRes.json();
      if (vaultRes.ok) {
        setVault(vaultData);
      }
    } catch (e) {
      console.error("Failed to fetch dashboard data", e);
    }
  };

  useEffect(() => {
    fetchLiveState();
    const interval = setInterval(fetchLiveState, 5000);
    return () => clearInterval(interval);
  }, []);

  // Detect wallet status and network changes
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).ethereum) {
      const eth = (window as any).ethereum;

      const handleAccountsChanged = (accounts: string[]) => {
        startTransition(() => {
          setAccount(accounts[0] || null);
          setErrorMsg(null);
        });
      };

      const handleChainChanged = (hexId: string) => {
        startTransition(() => {
          setChainId(parseInt(hexId, 16));
          setErrorMsg(null);
        });
      };

      eth.request({ method: "eth_accounts" }).then((accounts: string[]) => {
        if (accounts.length > 0) setAccount(accounts[0]);
      });

      eth.request({ method: "eth_chainId" }).then((hexId: string) => {
        setChainId(parseInt(hexId, 16));
      });

      eth.on("accountsChanged", handleAccountsChanged);
      eth.on("chainChanged", handleChainChanged);

      return () => {
        eth.removeListener("accountsChanged", handleAccountsChanged);
        eth.removeListener("chainChanged", handleChainChanged);
      };
    }
  }, []);

  const connectWallet = async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      setErrorMsg("MetaMask is not installed. Please get MetaMask.");
      return;
    }
    try {
      const eth = (window as any).ethereum;
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      const hexId = await eth.request({ method: "eth_chainId" });
      setChainId(parseInt(hexId, 16));
      setErrorMsg(null);
    } catch (e: any) {
      if (e.code === 4001) {
        setErrorMsg("Connection rejected. Please retry.");
      } else {
        setErrorMsg(`Failed to connect wallet: ${e.message}`);
      }
    }
  };

  const switchNetwork = async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) return;
    try {
      const eth = (window as any).ethereum;
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
    } catch (e: any) {
      setErrorMsg(`Failed to switch network: ${e.message}`);
    }
  };

  const togglePause = async () => {
    if (!vaultAddress) {
      setErrorMsg("Vault address not configured. Contact the team — this should never happen in production.");
      return;
    }
    if (!account || !vault) return;
    if (account.toLowerCase() !== vault.owner.toLowerCase()) {
      setErrorMsg(`Only the vault owner (${vault.owner.slice(0, 6)}...) can pause or unpause.`);
      return;
    }
    if (chainId !== targetChainId) {
      setErrorMsg(`Please switch to target chain (ID ${targetChainId}) first.`);
      return;
    }

    try {
      setIsPendingTx(true);
      setErrorMsg(null);

      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const vaultContract = new Contract(vaultAddress, vaultAbi, signer);

      const tx = vault.paused ? await vaultContract.unpause() : await vaultContract.pause();
      setPendingTxHash(tx.hash);

      await tx.wait();
      setIsPendingTx(false);
      setPendingTxHash(null);
      fetchLiveState();
    } catch (e: any) {
      setIsPendingTx(false);
      setPendingTxHash(null);
      if (e.code === "ACTION_REJECTED") {
        setErrorMsg("Transaction rejected by user.");
      } else {
        setErrorMsg(`Transaction failed: ${e.message}`);
      }
    }
  };

  // Group latest snapshots by token symbol
  const latestTokenSnapshots = recentSnapshots.reduce((acc, current) => {
    if (!acc[current.token]) {
      acc[current.token] = current;
    }
    return acc;
  }, {} as Record<string, RecentSnapshot>);

  const monitoredTokens = Array.from(
    new Set(["WBNB", "CAKE", "FLOKI", "TWT", "PENDLE", ...Object.keys(latestTokenSnapshots)])
  );

  // Extract variables for the selected token
  const liveSnapshot = latestTokenSnapshots[selectedToken] || {
    cascadeScore: 0,
    liquidationIntensity: 0,
    priceDeviation: 0,
    fundingStress: 0,
    fearGreed: 50,
    regimeGateBlocked: false,
    timestamp: new Date().toISOString(),
  };

  // Determine current active metrics based on Sandbox vs Live Mode
  const activeIntensity = isSimSandbox ? simLiqIntensity : liveSnapshot.liquidationIntensity;
  const activeDeviation = isSimSandbox ? simPriceDeviation : liveSnapshot.priceDeviation;
  const activeFunding = isSimSandbox ? simFundingStress : liveSnapshot.fundingStress;
  const activeRegimeBlocked = isSimSandbox ? simRegimeBlocked : liveSnapshot.regimeGateBlocked;

  // In sandbox, derive a display score from the slider components.
  // In live mode, ALWAYS read the agent's own computed score — never recompute it client-side.
  const activeScore = isSimSandbox
    ? Math.min(100, activeIntensity + activeDeviation + activeFunding)
    : liveSnapshot.cascadeScore;

  const activePosition = openPositions.find((p) => p.token === selectedToken) || null;

  const getTokenPriceFallback = (token: string): number => {
    const defaults: Record<string, number> = {
      WBNB: 310.5,
      CAKE: 2.45,
      FLOKI: 0.00018,
      TWT: 1.15,
      PENDLE: 5.25
    };
    return defaults[token] || 1.0;
  };

  const currentPrice = activePosition && activePosition.pnl !== null
    ? activePosition.entryPrice * (1 + activePosition.pnl)
    : getTokenPriceFallback(selectedToken);

  // Drive hook state
  const { state, ringColor, pulsePeriod, ignitionKey } = useOrbState({
    score: activeScore,
    components: {
      liquidationIntensity: activeIntensity,
      priceDeviation: activeDeviation,
      fundingStress: activeFunding,
    },
    activePosition,
    regimeGateBlocked: activeRegimeBlocked,
    isStale: isStale && !isSimSandbox,
    recentTrades,
  });

  // Calculate ladder percentage for open positions
  const getLadderPct = (currentPrice: number, entryPrice: number) => {
    const tpPrice = entryPrice * 1.03;
    const slPrice = entryPrice * 0.985;
    const pct = ((currentPrice - slPrice) / (tpPrice - slPrice)) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  // Calculate elapsed time-stop percentage (12 ticks = ~12 mins/hours)
  const [elapsedSecs, setElapsedSecs] = useState<Record<string, number>>({});
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSecs((prev) => {
        const next = { ...prev };
        openPositions.forEach((pos) => {
          const diffMs = Date.now() - new Date(pos.openedAt).getTime();
          next[pos.id] = Math.floor(diffMs / 1000);
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [openPositions]);

  // Calculate time remaining bar (assuming 12 ticks/minutes = 720s for demo/monitoring purposes)
  const maxHoldDuration = 720; // 12 minutes standard time-stop representation
  const lastCompletedTrade = recentTrades.length > 0 ? recentTrades[0] : null;

  return (
    <div className="flex flex-col gap-8 relative max-w-5xl mx-auto px-4 md:px-0">
      
      {/* Quiet State / Agent Quiet Alert */}
      {isStale && !isSimSandbox && (
        <div className="bg-amber-950/40 border border-amber-500/20 text-amber-300/90 px-4 py-3 rounded-lg flex items-center justify-between z-10 animate-pulse font-data text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold">⚠️ AGENT QUIET</span>
            <span>No loop ticks recorded for 30s. Strategy dormant or waiting for volatility.</span>
          </div>
          <span>As of: {asOf ? new Date(asOf).toLocaleTimeString() : "Never"}</span>
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-[rgba(255,255,255,0.06)] pb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold font-data text-zinc-100 tracking-wider">CASCADE PREDATOR</h1>
          <p className="text-xs text-zinc-400 font-data mt-1">Autonomous Liquidation Squeeze Hunter</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {errorMsg && (
            <div className="bg-red-950/40 border border-red-500/20 text-red-300 text-xs px-3 py-2 rounded-md font-data">
              {errorMsg}
            </div>
          )}

          {isPendingTx && (
            <div className="bg-amber-950/40 border border-amber-500/20 text-amber-300 text-xs px-3 py-2 rounded-md flex items-center gap-2 font-data">
              <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
              <span>Tx Pending... {pendingTxHash && <a href={`https://bscscan.com/tx/${pendingTxHash}`} target="_blank" className="underline">{pendingTxHash.slice(0, 8)}...</a>}</span>
            </div>
          )}

          {!account ? (
            <button
              onClick={connectWallet}
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-semibold px-4 py-2 rounded font-data transition-colors"
            >
              Connect Wallet
            </button>
          ) : chainId !== targetChainId ? (
            <button
              onClick={switchNetwork}
              className="bg-red-950 border border-red-800 hover:bg-red-900 text-red-200 text-xs font-semibold px-4 py-2 rounded font-data transition-colors animate-pulse"
            >
              Switch Chain ({targetChainId})
            </button>
          ) : (
            <div className="flex items-center gap-3 font-data">
              <span className="text-[10px] text-zinc-400 bg-zinc-950 border border-zinc-800 px-3 py-2 rounded">
                {account.slice(0, 6)}...{account.slice(-4)}
              </span>

              {vault && (
                <button
                  onClick={togglePause}
                  disabled={isPendingTx}
                  className={`px-4 py-2 rounded text-xs font-semibold border transition-all ${
                    vault.paused
                      ? "bg-emerald-950/40 border-emerald-800 text-emerald-300 hover:bg-emerald-900/40"
                      : "bg-red-950/40 border-red-800 text-red-300 hover:bg-red-900/40"
                  } disabled:opacity-50`}
                >
                  {vault.paused ? "▶ UNPAUSE STRATEGY" : "⏸ PAUSE STRATEGY"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Token Pill Selection Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {monitoredTokens.map((tok) => (
            <button
              key={tok}
              onClick={() => setSelectedToken(tok)}
              className={`px-3 py-1.5 rounded font-data text-xs transition-colors border ${
                selectedToken === tok
                  ? "bg-zinc-800 border-zinc-600 text-zinc-100 font-bold"
                  : "bg-zinc-950 border-[rgba(255,255,255,0.06)] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tok}
            </button>
          ))}
        </div>

        {/* Live vs Sandbox Switch */}
        <div className="flex items-center gap-3 bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-1.5 font-data text-xs">
          <button
            onClick={() => {
              setIsSimSandbox(false);
              setSandboxArmed(false);
            }}
            className={`px-3 py-1 rounded transition-colors ${
              !isSimSandbox ? "bg-zinc-800 text-zinc-100 font-medium" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Live Feed
          </button>
          <button
            onClick={() => {
              if (isSimSandbox) return;
              if (!sandboxArmed) {
                setSandboxArmed(true);
                setTimeout(() => setSandboxArmed(false), 2000); // arm window closes after 2s
                return;
              }
              setIsSimSandbox(true);
              setSandboxArmed(false);
            }}
            className={`px-3 py-1 rounded transition-colors ${
              isSimSandbox ? "bg-zinc-800 text-zinc-100 font-medium" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {sandboxArmed ? "Click again to confirm" : "Sandbox Mode"}
          </button>
        </div>
      </div>

      {isSimSandbox && (
        <div className="w-full bg-amber-500/10 border border-amber-500/40 text-amber-300 text-xs font-data font-bold tracking-widest text-center py-2 rounded-md mb-2">
          ⚠ SANDBOX MODE — NOT LIVE DATA — FOR TESTING ONLY
        </div>
      )}

      {/* Main CascadeOrb Centerpiece Container */}
      <div className="relative flex flex-col items-center justify-center py-10">
        
        {/* Hairline horizontal ignition line */}
        {state === "igniting" && (
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none z-0">
            <svg width="100%" height="2" className="w-full">
              <line
                x1="0"
                y1="1"
                x2="100%"
                y2="1"
                stroke="var(--cs-hot)"
                strokeWidth="1"
                className="animate-ignition-line"
              />
            </svg>
          </div>
        )}

        {/* The CascadeOrb itself */}
        <div
          className={`relative flex items-center justify-center rounded-full aspect-square w-[280px] md:w-[360px] z-10 select-none ${
            pulsePeriod > 0 ? "animate-orb-pulse" : ""
          } ${isSimSandbox ? "ring-2 ring-dashed ring-amber-500/60 ring-offset-4 ring-offset-[#0a0b0d]" : ""}`}
          style={
            {
              "--orb-pulse-duration": `${pulsePeriod}s`,
              border: `1px solid rgba(255, 255, 255, 0.02)`,
              background:
                activePosition && activePosition.pnl !== null
                  ? activePosition.pnl >= 0
                    ? "radial-gradient(circle, rgba(95, 179, 138, 0.08) 0%, rgba(10, 11, 13, 0) 70%)"
                    : "radial-gradient(circle, rgba(227, 75, 58, 0.08) 0%, rgba(10, 11, 13, 0) 70%)"
                  : "transparent",
              transition: "background 0.4s ease",
            } as React.CSSProperties
          }
          aria-live="polite"
          aria-label={`Cascade Score is ${activeScore}%. Strategy status is ${state}`}
        >
          {/* SVG ring overlay */}
          <div className="absolute inset-0">
            <svg width="100%" height="100%" viewBox="0 0 360 360" className="w-full h-full">
              <circle
                cx="180"
                cy="180"
                r="150"
                fill="transparent"
                stroke="rgba(255, 255, 255, 0.03)"
                strokeWidth="2"
              />
              <circle
                cx="180"
                cy="180"
                r="150"
                fill="transparent"
                stroke={ringColor}
                strokeWidth="3"
                strokeDasharray="942.48"
                strokeDashoffset={942.48 - (942.48 * activeScore) / 100}
                strokeLinecap="round"
                transform="rotate(-90 180 180)"
                style={{
                  transition: "stroke-dashoffset 0.4s ease, stroke 0.4s ease",
                }}
              />
            </svg>
          </div>

          {/* Core Numeral and Status text labels */}
          <div className="flex flex-col items-center justify-center text-center z-20">
            {/* Top Indicator text */}
            {state === "stale" && (
              <span className="text-[10px] uppercase font-bold text-amber-500 font-data mb-1 tracking-widest">
                AGENT QUIET
              </span>
            )}
            {state === "blocked" && (
              <span className="text-[10px] uppercase font-bold text-zinc-500 font-data mb-1 tracking-widest">
                REGIME BLOCKED
              </span>
            )}
            {activePosition && (
              <span className="text-[10px] uppercase font-bold text-emerald-400 font-data mb-1 tracking-widest">
                POSITION ACTIVE
              </span>
            )}

            {/* Central Score Numeral */}
            <span
              key={`${selectedToken}-${ignitionKey}`}
              className={`font-display text-8xl md:text-9xl font-normal text-zinc-200 select-none ${
                state === "igniting" ? "animate-numeral-pop text-red-500" : ""
              }`}
              style={{
                color: state === "blocked" ? "var(--cs-text-muted)" : undefined,
              }}
            >
              {activeScore}
            </span>

            {/* Bottom Inner Indicator (PnL / Status) */}
            {activePosition ? (
              <span
                className={`font-data text-xs font-semibold mt-2 ${
                  (activePosition.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                PnL: {(activePosition.pnl ?? 0) >= 0 ? "+" : ""}
                {((activePosition.pnl ?? 0) * 100).toFixed(2)}%
              </span>
            ) : state === "blocked" ? (
              <span className="font-data text-[10px] text-zinc-500 mt-1 max-w-[180px] leading-relaxed">
                trending regime gate active
              </span>
            ) : (
              <span className="font-data text-[9px] text-zinc-500 tracking-wider mt-2">
                CASCADE SCORE
              </span>
            )}
          </div>
        </div>

        {/* Open Position details (SL/TP Ladder & Time-stop Countdowns) */}
        {activePosition && (
          <div className="mt-8 bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-5 w-full max-w-sm font-data">
            <div className="flex justify-between items-center text-xs font-semibold text-zinc-300 border-b border-zinc-900 pb-2 mb-3">
              <span>{activePosition.token} Vault Position</span>
              <span className="text-[10px] bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded uppercase">
                BUY
              </span>
            </div>

            {/* Price targets ladder */}
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>SL Target (-1.5%)</span>
                <span>Entry Price</span>
                <span>TP Target (+3.0%)</span>
              </div>
              <div className="flex justify-between text-xs text-zinc-300 font-semibold">
                <span>${(activePosition.entryPrice * 0.985).toFixed(4)}</span>
                <span>${activePosition.entryPrice.toFixed(4)}</span>
                <span>${(activePosition.entryPrice * 1.03).toFixed(4)}</span>
              </div>
              
              {/* Horizontal Position marker track */}
              <div className="relative w-full h-1 bg-zinc-900 rounded-full mt-2">
                <div
                  className="absolute w-2 h-2 rounded-full bg-zinc-100 -top-0.5 -translate-x-1/2 shadow"
                  style={{
                    left: `${getLadderPct(currentPrice, activePosition.entryPrice)}%`,
                    transition: "left 0.5s ease",
                  }}
                />
              </div>
            </div>

            {/* Time-stop progress bar */}
            <div>
              <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                <span>Time-Stop Countdown</span>
                <span>
                  {Math.max(0, maxHoldDuration - (elapsedSecs[activePosition.id] || 0))}s left
                </span>
              </div>
              <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="bg-amber-600 h-full transition-all duration-1000"
                  style={{
                    width: `${Math.max(
                      0,
                      100 - ((elapsedSecs[activePosition.id] || 0) / maxHoldDuration) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Details readouts when NO active position */}
        {!activePosition && (
          <div className="mt-6 flex flex-wrap justify-center items-center gap-6 font-data text-xs text-zinc-500">
            <div>
              asset: <span className="text-zinc-300 font-bold">{selectedToken}</span>
            </div>
            <div>
              price: <span className="text-zinc-300">${currentPrice.toFixed(4)}</span>
            </div>
            <div>
              threshold: <span className="text-zinc-300 font-semibold">70</span>
            </div>
            <div>
              regime:{" "}
              <span className="text-zinc-300 font-semibold">
                {isSimSandbox
                  ? simRegimeBlocked
                    ? "trending"
                    : "choppy"
                  : liveSnapshot.regimeGateBlocked
                  ? "trending"
                  : "choppy"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sub-component sliders / controls */}
      <div className="bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-6 max-w-lg mx-auto w-full font-data">
        <h3 className="text-xs font-bold text-zinc-400 tracking-widest uppercase mb-4 text-center">
          {isSimSandbox ? "Sandbox Simulator Controls" : "Live Signal Components"}
        </h3>

        <div className="flex flex-col gap-6">
          {/* Component 1: Liquidation Intensity */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-zinc-400">Liquidation Intensity (40% max)</span>
              <span className="text-zinc-200 font-semibold">{activeIntensity.toFixed(1)}%</span>
            </div>
            {isSimSandbox ? (
              <input
                type="range"
                min="0"
                max="40"
                step="0.5"
                value={simLiqIntensity}
                onChange={(e) => setSimLiqIntensity(parseFloat(e.target.value))}
                className="w-full accent-amber-500 bg-zinc-900 h-1 rounded-lg appearance-none cursor-pointer"
              />
            ) : (
              <div className="w-full bg-zinc-900 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-amber-600 h-full transition-all duration-500"
                  style={{ width: `${(activeIntensity / 40) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Component 2: Price Deviation */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-zinc-400">Price Deviation Overshoot (40% max)</span>
              <span className="text-zinc-200 font-semibold">{activeDeviation.toFixed(1)}%</span>
            </div>
            {isSimSandbox ? (
              <input
                type="range"
                min="0"
                max="40"
                step="0.5"
                value={simPriceDeviation}
                onChange={(e) => setSimPriceDeviation(parseFloat(e.target.value))}
                className="w-full accent-blue-500 bg-zinc-900 h-1 rounded-lg appearance-none cursor-pointer"
              />
            ) : (
              <div className="w-full bg-zinc-900 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-blue-600 h-full transition-all duration-500"
                  style={{ width: `${(activeDeviation / 40) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Component 3: Funding Rate Stress */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-zinc-400">Funding Rate Stress (20% max)</span>
              <span className="text-zinc-200 font-semibold">{activeFunding.toFixed(1)}%</span>
            </div>
            {isSimSandbox ? (
              <input
                type="range"
                min="0"
                max="20"
                step="0.5"
                value={simFundingStress}
                onChange={(e) => setSimFundingStress(parseFloat(e.target.value))}
                className="w-full accent-red-500 bg-zinc-900 h-1 rounded-lg appearance-none cursor-pointer"
              />
            ) : (
              <div className="w-full bg-zinc-900 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-red-600 h-full transition-all duration-500"
                  style={{ width: `${(activeFunding / 20) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Sandbox Only controls (Regime trigger toggle) */}
          {isSimSandbox && (
            <div className="border-t border-zinc-900 pt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Force Regime Block (trending/euphoric)</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simRegimeBlocked}
                    onChange={(e) => setSimRegimeBlocked(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-zinc-600 peer-checked:after:bg-zinc-100"></div>
                </label>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    setSimLiqIntensity(30);
                    setSimPriceDeviation(28);
                    setSimFundingStress(15);
                    setSimRegimeBlocked(false);
                  }}
                  className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-[10px] text-zinc-300 py-1.5 rounded transition-colors uppercase font-semibold"
                >
                  Force Squeeze (73)
                </button>
                <button
                  onClick={() => {
                    setSimLiqIntensity(15);
                    setSimPriceDeviation(12);
                    setSimFundingStress(5);
                    setSimRegimeBlocked(false);
                  }}
                  className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-[10px] text-zinc-300 py-1.5 rounded transition-colors uppercase font-semibold"
                >
                  Reset sandbox
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grid Status Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-data">
        <div className="bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Vault Balance</div>
          <div className="text-xl font-bold text-zinc-200 mt-1">
            {metric ? `${parseFloat(metric.vaultBalance).toFixed(4)} WBNB` : "N/A"}
          </div>
        </div>

        <div className="bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Daily Vol / Cap</div>
          <div className="text-xl font-bold text-zinc-200 mt-1">
            {vault ? `${parseFloat(vault.dailyVolume).toFixed(2)} / ${parseFloat(vault.dailyVolumeCap).toFixed(0)} WBNB` : "N/A"}
          </div>
        </div>

        <div className="bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Daily Trades / Cap</div>
          <div className="text-xl font-bold text-zinc-200 mt-1">
            {vault ? `${vault.dailyCount} / ${vault.dailyCountCap}` : "N/A"}
          </div>
        </div>

        <div className="bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Max Drawdown</div>
          <div className="text-xl font-bold text-red-500 mt-1">
            {metric ? `${metric.drawdownPct.toFixed(2)}%` : "0.00%"}
          </div>
        </div>
      </div>

      {/* Ledger Excerpt (Fade-in/out banner of last completed trade) */}
      {lastCompletedTrade && (
        <div className="border border-[rgba(255,255,255,0.06)] bg-zinc-950/20 p-4 rounded-lg flex flex-col sm:flex-row items-center justify-between text-xs font-data text-zinc-400 gap-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
            <span>LAST EXITED POSITION:</span>
            <span className="font-bold text-zinc-300">{lastCompletedTrade.tokenIn}</span>
            <span className="text-zinc-500">at score {lastCompletedTrade.cascadeScore}%</span>
          </div>
          <div className="flex items-center gap-4">
            <span>
              Return:{" "}
              <span className="text-emerald-400 font-bold">
                +{(3.0).toFixed(2)}%
              </span>
            </span>
            <span className="text-zinc-600">
              Tx:{" "}
              {lastCompletedTrade.txHash ? (
                <a
                  href={`https://bscscan.com/tx/${lastCompletedTrade.txHash}`}
                  target="_blank"
                  className="underline hover:text-zinc-200"
                >
                  {lastCompletedTrade.txHash.slice(0, 10)}...
                </a>
              ) : (
                "N/A"
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
