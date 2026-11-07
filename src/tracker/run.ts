import type { Api } from 'grammy';
import { TRACKER } from '../config';
import type { Shipment } from '../db/shipments';
import { clearPendingMessage, getDueShipments, getPendingMessages, markChecked } from '../db/tracker';
import { forEachLimited } from '../lib/concurrency';
import { applyTrackingResult } from './apply';
import { sendNotification } from './notify';
import type { TrackingProvider } from './types';

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

/**
 * One cron tick: re-send notifications that failed earlier, then check every due
 * shipment and notify on changes. Errors are isolated per shipment.
 */
export async function runTracker(deps: TrackerDeps): Promise<TrackerSummary> {
	const { db, api } = deps;
	const summary: TrackerSummary = { checked: 0, notFound: 0, changed: 0, notified: 0, retried: 0, failed: 0 };

	for (const pending of await getPendingMessages(db, TRACKER.maxRetriesPerRun)) {
		if ((await sendNotification(api, db, pending.chatId, pending.message)) === 'sent') {
			await clearPendingMessage(db, pending.shipmentId);
			summary.retried++;
		}
	}

	const shipments = await getDueShipments(db, deps.maxShipments ?? TRACKER.maxShipmentsPerRun);
	console.log(`[tracker] checking ${shipments.length} shipment(s)`);

	await forEachLimited(shipments, TRACKER.concurrency, async (shipment) => {
		try {
			await checkShipment(deps, shipment, summary);
		} catch (err) {
			summary.failed++;
			console.error(`[tracker] error checking ${shipment.awb}:`, err);
			// Reschedule anyway so a failing shipment can't starve the others.
			await markChecked(db, shipment.id).catch(() => {});
		}
	});

	console.log('[tracker] done', summary);
	return summary;
}

async function checkShipment({ db, api, provider }: TrackerDeps, shipment: Shipment, summary: TrackerSummary) {
	summary.checked++;
	const applied = await applyTrackingResult(db, shipment, await provider.fetchStatus(shipment.awb), { notify: true });

	if (!applied.found) summary.notFound++;
	if (!applied.message) return;

	summary.changed++;
	console.log(`[tracker] ${shipment.awb}: ${applied.newScans.length} new scan(s)${applied.isTerminal ? ', complete' : ''}`);
	// The message is already saved as pending_message, so a failed send is retried next tick.
	if ((await sendNotification(api, db, shipment.chatId, applied.message)) === 'sent') {
		await clearPendingMessage(db, shipment.id);
		summary.notified++;
	}
}
