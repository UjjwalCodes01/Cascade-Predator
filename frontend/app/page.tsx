"use client";

import { useEffect, useState, startTransition } from "react";
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

export default function LiveDashboard() {
  const [metric, setMetric] = useState<SnapshotMetric | null>(null);
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [recentSnapshots, setRecentSnapshots] = useState<RecentSnapshot[]>([]);
  const [vault, setVault] = useState<VaultData | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Wallet connection state
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPendingTx, setIsPendingTx] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);

  const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "56"); // BSC Mainnet = 56, Testnet = 97
  const vaultAddress = process.env.NEXT_PUBLIC_RISK_VAULT_ADDRESS || "0xd69B4f5FAF6E3626F1E9C595a170F388798f713D";

  const fetchLiveState = async () => {
    try {
      const snapRes = await fetch("/api/snapshot");
      const snapData = await snapRes.json();
      if (snapRes.ok) {
        setMetric(snapData.metric);
        setOpenPositions(snapData.openPositions || []);
        setRecentSnapshots(snapData.recentSnapshots || []);
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

  const tokens = Object.values(latestTokenSnapshots);

  return (
    <div className={`flex flex-col gap-6 relative transition-opacity duration-300 ${isStale ? "opacity-60" : "opacity-100"}`}>
      {/* Quiet State Banner */}
      {isStale && (
        <div className="bg-amber-950/80 border border-amber-500/50 text-amber-300 px-4 py-3 rounded-lg flex items-center justify-between z-10 animate-pulse">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono">⚠️ AGENT QUIET</span>
            <span className="text-sm">No tick activity detected from the agent for over 30 seconds. System might be offline or sleeping.</span>
          </div>
          <span className="text-xs font-mono">As of: {asOf ? new Date(asOf).toLocaleTimeString() : "Never"}</span>
        </div>
      )}

      {/* Header Panel */}
      <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 font-mono">Live Strategy Monitor</h1>
          <p className="text-sm text-zinc-400">Autonomous DEX cascade hunter running on BSC</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {errorMsg && (
            <div className="bg-red-950/80 border border-red-500/50 text-red-300 text-xs px-3 py-2 rounded-md">
              {errorMsg}
            </div>
          )}

          {isPendingTx && (
            <div className="bg-amber-950/80 border border-amber-500/50 text-amber-300 text-xs px-3 py-2 rounded-md flex items-center gap-2">
              <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
              <span>Tx Pending... {pendingTxHash && <a href={`https://bscscan.com/tx/${pendingTxHash}`} target="_blank" className="underline font-mono ml-1">{pendingTxHash.slice(0, 10)}...</a>}</span>
            </div>
          )}

          {!account ? (
            <button
              onClick={connectWallet}
              className="bg-amber-600 hover:bg-amber-500 text-zinc-950 text-sm font-semibold px-4 py-2 rounded-lg font-mono transition-colors"
            >
              Connect Wallet
            </button>
          ) : chainId !== targetChainId ? (
            <button
              onClick={switchNetwork}
              className="bg-red-600 hover:bg-red-500 text-zinc-100 text-sm font-semibold px-4 py-2 rounded-lg font-mono transition-colors animate-pulse"
            >
              Switch to BSC (Chain: {targetChainId})
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-md">
                Connected: {account.slice(0, 6)}...{account.slice(-4)}
              </span>

              {vault && (
                <button
                  onClick={togglePause}
                  disabled={isPendingTx}
                  className={`px-4 py-2 rounded-lg font-mono text-sm font-semibold transition-all ${
                    vault.paused
                      ? "bg-emerald-600 hover:bg-emerald-500 text-zinc-950"
                      : "bg-red-600 hover:bg-red-500 text-zinc-100"
                  } disabled:opacity-50`}
                >
                  {vault.paused ? "▶ UNPAUSE VAULT" : "⏸ PAUSE VAULT"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Grid Status Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-5">
          <div className="text-xs text-zinc-400 font-mono">VAULT BALANCE</div>
          <div className="text-2xl font-bold text-zinc-100 font-mono mt-1">
            {metric ? `${parseFloat(metric.vaultBalance).toFixed(4)} WBNB` : "N/A"}
          </div>
        </div>

        <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-5">
          <div className="text-xs text-zinc-400 font-mono">DAILY VOL / CAP</div>
          <div className="text-2xl font-bold text-zinc-100 font-mono mt-1">
            {vault ? `${parseFloat(vault.dailyVolume).toFixed(2)} / ${parseFloat(vault.dailyVolumeCap).toFixed(0)} WBNB` : "N/A"}
          </div>
        </div>

        <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-5">
          <div className="text-xs text-zinc-400 font-mono">DAILY COUNT / CAP</div>
          <div className="text-2xl font-bold text-zinc-100 font-mono mt-1">
            {vault ? `${vault.dailyCount} / ${vault.dailyCountCap}` : "N/A"}
          </div>
        </div>

        <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-5">
          <div className="text-xs text-zinc-400 font-mono">MAX DRAWDOWN</div>
          <div className="text-2xl font-bold text-red-400 font-mono mt-1">
            {metric ? `${metric.drawdownPct.toFixed(2)}%` : "0.00%"}
          </div>
        </div>
      </div>

      {/* Monitored Tokens Cascade Scores */}
      <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-6">
        <h2 className="text-lg font-bold font-mono text-zinc-200 mb-4 border-b border-zinc-800 pb-2">Monitored Cascade Scores</h2>

        {tokens.length === 0 ? (
          <p className="text-sm text-zinc-500 font-mono py-4">No active live snapshots. Ensure the agent loop is running.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {tokens.map((tok) => (
              <div key={tok.token} className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-2xl font-bold font-mono text-zinc-100">{tok.token}</span>
                    <span className="text-xs font-mono text-zinc-400 block mt-0.5">FEAR & GREED: {tok.fearGreed}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-4xl font-extrabold font-mono text-amber-500">{tok.cascadeScore.toFixed(0)}</span>
                    <span className="text-xs font-mono text-zinc-500 block">CASCADE SCORE</span>
                  </div>
                </div>

                {/* Score Component Bars */}
                <div className="flex flex-col gap-2.5">
                  <div>
                    <div className="flex justify-between text-xs font-mono text-zinc-400 mb-1">
                      <span>Liquidation Intensity (40% max)</span>
                      <span>{tok.liquidationIntensity}%</span>
                    </div>
                    <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden border border-zinc-800">
                      <div className="bg-amber-600 h-2 rounded-full" style={{ width: `${(tok.liquidationIntensity / 40) * 100}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-mono text-zinc-400 mb-1">
                      <span>Price Deviation Overshoot (40% max)</span>
                      <span>{tok.priceDeviation}%</span>
                    </div>
                    <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden border border-zinc-800">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${(tok.priceDeviation / 40) * 100}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-mono text-zinc-400 mb-1">
                      <span>Funding Rate Stress (20% max)</span>
                      <span>{tok.fundingStress}%</span>
                    </div>
                    <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden border border-zinc-800">
                      <div className="bg-red-600 h-2 rounded-full" style={{ width: `${(tok.fundingStress / 20) * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Position Section */}
      <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-6">
        <h2 className="text-lg font-bold font-mono text-zinc-200 mb-4 border-b border-zinc-800 pb-2">Active Positions</h2>

        {openPositions.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-zinc-800 rounded-lg text-zinc-500 font-mono text-sm">
            No active positions open. Hunting cascades...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {openPositions.map((pos) => {
              const currentPnl = pos.pnl ?? 0;
              return (
                <div key={pos.id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-5">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
                    <span className="text-lg font-bold font-mono text-emerald-400">{pos.token} BUY POSITION</span>
                    <span className={`text-sm font-bold font-mono ${currentPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      PnL: {currentPnl >= 0 ? "+" : ""}{(currentPnl * 100).toFixed(2)}%
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono text-zinc-400">
                    <div>Entry Price: <span className="text-zinc-200 block text-sm mt-0.5">${pos.entryPrice.toFixed(4)}</span></div>
                    <div>Position Size: <span className="text-zinc-200 block text-sm mt-0.5">{parseFloat(pos.amount).toFixed(4)} {pos.token}</span></div>
                    <div>Opened At: <span className="text-zinc-200 block text-xs mt-0.5">{new Date(pos.openedAt).toLocaleTimeString()}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
