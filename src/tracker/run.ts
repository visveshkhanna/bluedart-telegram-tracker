import { GrammyError, type Api } from "grammy";
import type { Shipment } from "../db/shipments";
import {
	getPendingNotifications,
	getShipmentsToCheck,
	markChecked,
	markEventNotified,
	markUserBlocked,
	recordStatusChange,
} from "../db/tracking";
import { escapeHtml } from "../utils/format";
import type { TrackingProvider } from "./provider";

// Each shipment costs ~1 carrier fetch + up to 1 Telegram call. The Workers Free plan
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
	noStatus: number;
	changed: number;
	notified: number;
	retried: number;
	failed: number;
}

export interface Notification {
	awb: string;
	label: string | null;
	statusText: string | null;
	location: string | null;
	eventAt: string | null;
	isTerminal: boolean;
}

export function formatNotification(n: Notification): string {
	const title = n.label ? `<b>${escapeHtml(n.label)}</b> · <code>${n.awb}</code>` : `<code>${n.awb}</code>`;
	const lines = [`📦 ${title}`, `Status: <b>${escapeHtml(n.statusText ?? "Unknown")}</b>`];
	if (n.location) lines.push(`Location: ${escapeHtml(n.location)}`);
	if (n.eventAt) lines.push(`Updated: ${escapeHtml(n.eventAt)}`);
	if (n.isTerminal) lines.push("", "This shipment is complete, so I've stopped tracking it.");
	return lines.join("\n");
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

	if (!result) {
		summary.noStatus++;
		await markChecked(deps.db, shipment.id);
		return;
	}

	if (result.status === shipment.lastStatus) {
		await markChecked(deps.db, shipment.id);
		return;
	}

	// Record first, then notify: if sending fails, the event stays notified = 0 and is retried next run.
	summary.changed++;
	console.log(`[tracker] ${shipment.awb}: ${shipment.lastStatus ?? "∅"} → ${result.status}`);
	const eventId = await recordStatusChange(deps.db, shipment.id, result);

	const text = formatNotification({
		awb: shipment.awb,
		label: shipment.label,
		statusText: result.statusText,
		location: result.location ?? null,
		eventAt: result.eventAt ?? null,
		isTerminal: result.isTerminal,
	});
	const sent = await sendNotification(deps, shipment.chatId, text);
	if (sent === "sent") {
		await markEventNotified(deps.db, eventId);
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

/** One cron run: retry failed notifications, then check shipments and notify on status changes. */
export async function runTracker(deps: TrackerDeps): Promise<TrackerSummary> {
	const summary: TrackerSummary = { checked: 0, noStatus: 0, changed: 0, notified: 0, retried: 0, failed: 0 };

	for (const pending of await getPendingNotifications(deps.db, MAX_RETRIES_PER_RUN)) {
		if ((await sendNotification(deps, pending.chatId, formatNotification(pending))) === "sent") {
			await markEventNotified(deps.db, pending.eventId);
			summary.retried++;
		}
	}

	const shipments = await getShipmentsToCheck(deps.db, deps.maxShipments ?? MAX_SHIPMENTS_PER_RUN);
	console.log(`[tracker] checking ${shipments.length} shipment(s)`);

	await forEachLimited(shipments, CONCURRENCY, async (shipment) => {
		try {
			await processShipment(deps, shipment, summary);
		} catch (err) {
			// One bad AWB must never stop the run.
			summary.failed++;
			console.error(`[tracker] error checking ${shipment.awb}:`, err);
			// Still rotate it to the back of the queue so failures can't starve other shipments.
			await markChecked(deps.db, shipment.id).catch(() => {});
		}
	});

	console.log("[tracker] done", summary);
	return summary;
}
