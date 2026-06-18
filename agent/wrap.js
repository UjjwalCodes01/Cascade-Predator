import { ethers } from "ethers";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, ".env") });

const RPC_URL = process.env.BSC_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const VAULT_ADDRESS = process.env.RISK_VAULT_ADDRESS;
const WBNB_ADDRESS = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";

async function main() {
  if (!PRIVATE_KEY) {
    console.error("AGENT_PRIVATE_KEY is missing in .env!");
    process.exit(1);
  }
  if (!VAULT_ADDRESS) {
    console.error("RISK_VAULT_ADDRESS is missing in .env!");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
    staticNetwork: true
  });
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Using RPC URL: ${RPC_URL}`);
  console.log(`Agent wallet: ${wallet.address}`);
  console.log(`Vault address: ${VAULT_ADDRESS}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`BNB Balance: ${ethers.formatEther(balance)} BNB`);

  if (balance < ethers.parseEther("0.0015")) {
    console.error("Insufficient BNB balance to wrap (need at least 0.0015 BNB for swap + gas).");
    process.exit(1);
  }

  const wrapAmount = ethers.parseEther("0.001");
  console.log(`Wrapping ${ethers.formatEther(wrapAmount)} BNB to WBNB...`);

  // WBNB ABI with deposit and transfer functions
  const wbnbAbi = [
    "function deposit() public payable",
    "function transfer(address to, uint value) public returns (bool)",
    "function balanceOf(address owner) public view returns (uint)"
  ];

  const wbnbContract = new ethers.Contract(WBNB_ADDRESS, wbnbAbi, wallet);

  // 1. Wrap BNB
  const txDeposit = await wbnbContract.deposit({ value: wrapAmount });
  console.log(`Wrapping transaction sent: ${txDeposit.hash}`);
  await txDeposit.wait();
  console.log("Successfully wrapped BNB to WBNB!");

  // 2. Get WBNB Balance
  const wbnbBal = await wbnbContract.balanceOf(wallet.address);
  console.log(`Current Wallet WBNB Balance: ${ethers.formatEther(wbnbBal)} WBNB`);

  // 3. Transfer WBNB to RiskVault
  console.log(`Transferring ${ethers.formatEther(wbnbBal)} WBNB to RiskVault...`);
  const txTransfer = await wbnbContract.transfer(VAULT_ADDRESS, wbnbBal);
  console.log(`Transfer transaction sent: ${txTransfer.hash}`);
  await txTransfer.wait();
  console.log("Successfully funded the RiskVault contract with WBNB!");

  // 4. Check RiskVault WBNB Balance
  const vaultWbnbBal = await wbnbContract.balanceOf(VAULT_ADDRESS);
  console.log(`\n========================================================`);
  console.log(`RiskVault WBNB Balance: ${ethers.formatEther(vaultWbnbBal)} WBNB`);
  console.log(`========================================================`);
}

main().catch(console.error);
