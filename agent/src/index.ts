import { TradingLoop } from "./loop/index.js";

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex !== -1 && args[modeIndex + 1] === "live" ? "live" : "paper";

  console.log(`========================================================`);
  console.log(`               CASCADE PREDATOR DAEMON                  `);
  console.log(`========================================================`);
  console.log(`Mode selected: ${mode.toUpperCase()}`);
  console.log(`========================================================`);

  const loop = new TradingLoop(mode);

  // Handle termination signals for clean exit
  process.on("SIGINT", () => {
    console.log("\n[main] SIGINT received. Initiating graceful shutdown...");
    loop.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  process.on("SIGTERM", () => {
    console.log("\n[main] SIGTERM received. Initiating graceful shutdown...");
    loop.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  await loop.start();
}

main().catch((error) => {
  console.error("[main] Critical error inside daemon entrypoint:", error);
  process.exit(1);
});
