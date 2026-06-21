import { NextResponse } from "next/server";
import { JsonRpcProvider, Contract } from "ethers";
import abi from "@/abi/RiskVault.json";

export const dynamic = "force-dynamic";
export const revalidate = 5; // cache for 5s; cheap relief on the RPC

export async function GET() {
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
    const vault = new Contract(
      vaultAddress,
      abi,
      provider
    );

    const [owner, agent, paused, maxBps, dailyVolume, dailyCount, dailyVolumeCap, dailyCountCap] =
      await Promise.all([
        vault.owner(),
        vault.agent(),
        vault.paused(),
        vault.maxPositionBps(),
        vault.dailyVolume(),
        vault.dailyCount(),
        vault.dailyVolumeCap(),
        vault.dailyCountCap(),
      ]);

    return NextResponse.json({
      owner,
      agent,
      paused,
      maxPositionBps: Number(maxBps),
      dailyVolume: dailyVolume.toString(),
      dailyCount: Number(dailyCount),
      dailyVolumeCap: dailyVolumeCap.toString(),
      dailyCountCap: Number(dailyCountCap),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Vault read failed", detail: String(e) },
      { status: 500 }
    );
  }
}
