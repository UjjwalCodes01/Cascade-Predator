# Cascade Predator - Smart Contracts

Holds trading capital for the Cascade Predator trading agent and enforces strict on-chain risk guardrails on PancakeSwap V2.

---

## 1. Quickstart

### Prerequisites
Ensure you have Foundry installed. If not:
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Install Dependencies
Initialize and install the OpenZeppelin Contracts library:
```bash
forge install openzeppelin/openzeppelin-contracts --no-git
```

### Build & Compilation
```bash
forge build
```

---

## 2. Test Execution

### Run Unit and Fuzz Tests
```bash
forge test
```

### Run BSC Mainnet Fork Tests
To run tests against a live BSC Mainnet fork (verifies live integrations with PancakeSwap router and pools):
```bash
# Optional: Set custom RPC URL, otherwise defaults to public node.
export BSC_RPC_URL="https://bsc-dataseed.binance.org/"
forge test --match-contract RiskVaultForkTest
```

---

## 3. Environment Configuration

To deploy the contracts or verify them on BscScan, you must copy the template environment file:
```bash
cp .env.example .env
```
Open `.env` and fill out the configuration values:
- `DEPLOYER_PRIVATE_KEY`: Private key of the EOA wallet deploying the contract.
- `VAULT_OWNER`: Address of the admin wallet (Ledger, Safe Multi-Sig, etc.).
- `VAULT_AGENT`: EOA address of the trading agent daemon.
- `BSCSCAN_API_KEY`: API key from BscScan to enable automatic source code verification.

---

## 4. Testnet Deployment & Verification

We use Foundry's script system (`Deploy.s.sol`) to deploy and verify the contracts in a single command. 

Ensure you have run `source .env` to export the variables before executing:

### Step 1: Export Environment Variables
```bash
source .env
```

### Step 2: Deploy and Verify on BSC Testnet (Chain ID 97)
Run the deploy script using the configured `bsc-testnet` RPC endpoint:
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url bsc-testnet \
  --broadcast \
  --verify \
  --legacy
```
*Note: `--legacy` is recommended on BSC Testnet to avoid EIP-1559 gas fee estimation issues.*

---

## 5. Post-Deployment Checklist

Once deployed:
1. **Fund the Vault**: Send native BNB or allowlisted BEP-20 tokens (e.g. WBNB) to the deployed `RiskVault` address.
2. **Verify on BscScan**: Navigate to the testnet/mainnet explorer using the address logged in the terminal output to ensure that the code is verified and shows the Green Checkmark.
3. **Configure Allowlist**: If you want to trade other tokens, call `setAllowlist` from the owner wallet to allowlist target token addresses.
