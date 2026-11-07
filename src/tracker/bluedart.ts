import type { TrackingProvider } from "./provider";

/**
 * BlueDart provider: STUB for now. It only logs and reports "no status",
 * so the cron still runs end to end (DB reads, last_checked_at updates).
 * Phase 2 replaces fetchStatus with a real lookup and status mapping.
 */
export const bluedartProvider: TrackingProvider = {
	async fetchStatus(awb) {
		console.log(`[bluedart] would fetch status for AWB ${awb}`);
		return null;
	},
};
