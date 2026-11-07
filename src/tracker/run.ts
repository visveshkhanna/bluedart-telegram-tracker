import { GrammyError, type Api } from "grammy";
import type { Shipment } from "../db/shipments";
import { clearPendingMessage, getPendingMessages, getShipmentsToCheck, markChecked, markUserBlocked } from "../db/tracking";
import { applyTrackingResult } from "./apply";
import type { TrackingProvider } from "./provider";

// Each shipment costs ~1 BlueDart fetch + up to 1 Telegram call. The Workers Free plan
// allows 50 subrequests per invocation, so stay well below it; oldest-checked-first
// ordering means everyone is still covered across runs.
export const MAX_SHIPMENTS_PER_RUN = 20;
const MAX_RETRIES_PER_RUN = 5;
const CONCURRENCY = 5;
const MAX_RATE_LIMIT_WAIT_SECONDS = 5;

export interface TrackerDeps {
	db: D1Database;
	api: Api;
	provider: TrackingProvider;
	maxShipments?: number;
}

export interface TrackerSummary {
	checked: number;
	notFound: number;
	changed: number;
	notified: number;
	retried: number;
	failed: number;
}

type SendResult = "sent" | "blocked" | "failed";

/** Sends one message. Blocks the user on 403; on 429 waits briefly and retries once. */
async function sendNotification(deps: TrackerDeps, chatId: number, text: string): Promise<SendResult> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await deps.api.sendMessage(chatId, text, { parse_mode: "HTML" });
			return "sent";
		} catch (err) {
			if (err instanceof GrammyError && err.error_code === 403) {
				await markUserBlocked(deps.db, chatId);
				return "blocked";
			}
			const retryAfter = err instanceof GrammyError ? err.parameters.retry_after : undefined;
			if (attempt === 0 && retryAfter !== undefined && retryAfter <= MAX_RATE_LIMIT_WAIT_SECONDS) {
				await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
				continue;
			}
			console.error(`[tracker] failed to notify chat ${chatId}:`, err);
			return "failed";
		}
	}
	return "failed";
}

async function processShipment(deps: TrackerDeps, shipment: Shipment, summary: TrackerSummary): Promise<void> {
	summary.checked++;
	const result = await deps.provider.fetchStatus(shipment.awb);
	const applied = await applyTrackingResult(deps.db, shipment, result, { notify: true });

	if (!applied.found) summary.notFound++;
	if (!applied.changed || !applied.message) return;

	summary.changed++;
	console.log(`[tracker] ${shipment.awb}: ${applied.newScans.length} new scan(s)${applied.isTerminal ? ", complete" : ""}`);
	// The message is already stored as pending_message, so a failed send is retried next run.
	if ((await sendNotification(deps, shipment.chatId, applied.message)) === "sent") {
		await clearPendingMessage(deps.db, shipment.id);
		summary.notified++;
	}
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			await fn(items[next++]);
		}
	});
	await Promise.all(workers);
}

/** One cron run: retry failed notifications, then check shipments and notify on changes. */
export async function runTracker(deps: TrackerDeps): Promise<TrackerSummary> {
	const summary: TrackerSummary = { checked: 0, notFound: 0, changed: 0, notified: 0, retried: 0, failed: 0 };

	for (const pending of await getPendingMessages(deps.db, MAX_RETRIES_PER_RUN)) {
		if ((await sendNotification(deps, pending.chatId, pending.message)) === "sent") {
			await clearPendingMessage(deps.db, pending.shipmentId);
			summary.retried++;
		}
	}

	const shipments = await getShipmentsToCheck(deps.db, deps.maxShipments ?? MAX_SHIPMENTS_PER_RUN);
	console.log(`[tracker] checking ${shipments.length} shipment(s)`);

	await forEachLimited(shipments, CONCURRENCY, async (shipment) => {
		try {
			await processShipment(deps, shipment, summary);
		} catch (err) {
			// One bad AWB (or a BlueDart hiccup) must never stop the run.
			summary.failed++;
			console.error(`[tracker] error checking ${shipment.awb}:`, err);
			// Still rotate it to the back of the queue so failures can't starve other shipments.
			await markChecked(deps.db, shipment.id).catch(() => {});
		}
	});

	console.log("[tracker] done", summary);
	return summary;
}
