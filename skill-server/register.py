"""
register.py — ERC-8004 Agent Identity Registration (one-shot)

Registers Cascade Predator as an on-chain agent identity on BSC Testnet.
Registration is GAS-FREE via MegaFuel paymaster sponsorship — you only
need WALLET_PASSWORD and PRIVATE_KEY in your .env.

Run once before starting the skill server:
    python register.py

The agentId and tx hash will be printed and can be pasted into README.md.
"""

import os
import json
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()

from bnbagent import ERC8004Agent, AgentEndpoint, EVMWalletProvider


def main():
    wallet_password = os.environ.get("WALLET_PASSWORD")
    private_key = os.environ.get("PRIVATE_KEY")
    network = os.environ.get("NETWORK", "bsc-testnet")
    agent_url = os.environ.get("ERC8183_AGENT_URL", "http://localhost:8003/erc8183")

    if not wallet_password:
        raise ValueError("WALLET_PASSWORD is required in .env")

    print(f"[register] Network: {network}")
    print(f"[register] Agent URL: {agent_url}")

    # Initialise wallet (first run: imports PRIVATE_KEY, saves encrypted keystore)
    wallet = EVMWalletProvider(
        password=wallet_password,
        private_key=private_key,  # Only needed on first run
    )

    print(f"[register] Wallet address: {wallet.address}")

    sdk = ERC8004Agent(network=network, wallet_provider=wallet)

    # Build the agent URI with full metadata
    agent_uri = sdk.generate_agent_uri(
        name="cascade-predator",
        description=(
            "Liquidation cascade detection skill for BNB Smart Chain. "
            "Reads CoinMarketCap derivatives data (funding rates, open interest, "
            "liquidations), computes a composite cascade probability score, and "
            "confirms entry signals with Google Gemini. Returns structured LONG "
            "signals with take-profit, stop-loss, and confidence score. "
            "Track 2 submission for BNB Hack: AI Trading Agent Edition."
        ),
        endpoints=[
            AgentEndpoint(
                name="ERC-8183",
                endpoint=f"{agent_url}/status",
                version="1.0.0",
            ),
            AgentEndpoint(
                name="skill-scan",
                endpoint=f"{agent_url.replace('/erc8183', '')}/skill/scan/{{token}}",
                version="1.0.0",
            ),
        ],
    )

    print("[register] Registering agent on-chain (gas-free via MegaFuel)...")
    result = sdk.register_agent(agent_uri=agent_uri)

    agent_id = result.get("agentId")
    tx_hash = result.get("transactionHash")

    print()
    print("=" * 60)
    print("✅  Agent registered successfully!")
    print(f"    Agent ID:  {agent_id}")
    print(f"    TX Hash:   {tx_hash}")
    print(f"    Explorer:  https://testnet.bscscan.com/tx/{tx_hash}")
    print("=" * 60)
    print()
    print("Add these to your README.md Smart Contract / Agent Addresses table:")
    print(f"  | Agent Identity (ERC-8004) | BSC Testnet | {agent_id} | TX: {tx_hash} |")
    print()

    # Save to a local file so it's not lost
    out = Path(".agent-registration.json")
    out.write_text(json.dumps({"agentId": agent_id, "txHash": tx_hash}, indent=2))
    print(f"[register] Registration details saved to {out}")


if __name__ == "__main__":
    main()
