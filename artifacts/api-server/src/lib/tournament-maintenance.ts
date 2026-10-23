import { finalizeDueTournaments, notifyTournamentMilestones } from "./tournaments";
import { logger } from "./logger";

export function startTournamentMaintenance() {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try { await finalizeDueTournaments(); await notifyTournamentMilestones(); }
    catch { logger.error("Tournament completion refresh failed; will retry."); }
    finally { running = false; }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), 15000);
  timer.unref();
}
