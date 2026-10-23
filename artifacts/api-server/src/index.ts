import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { startCreatorMembershipRefresh } from "./lib/creator-program";
import { startCreatorMediaCleanup } from "./lib/creator-media-cleanup";
import { startAnalyticsMaintenance } from "./lib/analytics-events";
import { startTournamentMaintenance } from "./lib/tournament-maintenance";
import { attachLiveGateway } from "./lib/live-gateway";
import { pool, verifyDatabaseStartup } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
async function startServer() {
  await verifyDatabaseStartup();
  attachLiveGateway(server);
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
    startCreatorMembershipRefresh();
    startCreatorMediaCleanup();
    startAnalyticsMaintenance();
    startTournamentMaintenance();
  });
}

startServer().catch(async () => {
  // Connection exceptions may contain provider details; never log the URL,
  // password, or raw driver error. The audit command reports safe diagnostics.
  logger.fatal("Database startup verification failed. Run the read-only supabase:check command before enabling Supabase.");
  await pool.end().catch(() => undefined);
  process.exit(1);
});
