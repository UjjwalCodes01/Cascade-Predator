import { TradingLoop } from "./loop/index.js";
import * as http from "http";

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex !== -1 && args[modeIndex + 1] === "live" ? "live" : "paper";

  console.log(`========================================================`);
  console.log(`               CASCADE PREDATOR DAEMON                  `);
  console.log(`========================================================`);
  console.log(`Mode selected: ${mode.toUpperCase()}`);
  console.log(`========================================================`);

  // --- DUMMY HTTP SERVER FOR RENDER FREE TIER ---
  // Render requires web services to bind to a port within 60 seconds.
  const port = process.env.PORT || 10000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Cascade Predator Agent is running. Status: OK");
  });
  server.listen(port, () => {
    console.log(`[main] Dummy HTTP server listening on port ${port} to satisfy Render health checks.`);
  });
  // ----------------------------------------------

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
