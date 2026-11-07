import type { Shipment } from '../db/shipments';
import { getScanKeys, scanKey } from '../db/scans';
import { markChecked, saveTrackingUpdate } from '../db/tracker';
import { formatUpdateMessage } from './messages';
import type { Scan, TrackingProvider, TrackingResult } from './types';

export interface AppliedUpdate {
	found: boolean;
	changed: boolean;
	newScans: Scan[];
	isTerminal: boolean;
	/** The notification stored as pending_message, when `notify` was requested and something changed. */
	message: string | null;
}

/**
 * Compares a carrier result with what's stored and saves the difference. A change is
 * either new scans or an expected delivery date that differs from the stored one; a
 * missing date is treated as a scraping glitch and never overwrites a known one.
 */
export async function applyTrackingResult(
	db: D1Database,
	shipment: Shipment,
	result: TrackingResult,
	{ notify }: { notify: boolean },
): Promise<AppliedUpdate> {
	if (!result.found) {
		await markChecked(db, shipment.id);
		return { found: false, changed: false, newScans: [], isTerminal: false, message: null };
	}

	const stored = await getScanKeys(db, shipment.id);
	const newScans = result.scans.filter((scan) => !stored.has(scanKey(scan)));
	const edd = result.expectedDeliveryDate;
	const eddChanged = edd !== null && edd !== shipment.expectedDeliveryDate;

	if (newScans.length === 0 && !eddChanged) {
		await markChecked(db, shipment.id);
		return { found: true, changed: false, newScans, isTerminal: result.isTerminal, message: null };
	}

	const message = notify
		? formatUpdateMessage({
				awb: shipment.awb,
				label: shipment.label,
				newScans,
				expectedDeliveryDate: edd ?? shipment.expectedDeliveryDate,
				previousExpectedDeliveryDate: eddChanged ? shipment.expectedDeliveryDate : null,
				isTerminal: result.isTerminal,
			})
		: null;

	await saveTrackingUpdate(db, shipment.id, {
		newScans,
		latest: result.scans[0] ?? null,
		expectedDeliveryDate: edd,
		isTerminal: result.isTerminal,
		pendingMessage: message,
	});
	return { found: true, changed: true, newScans, isTerminal: result.isTerminal, message };
}

export type RefreshOutcome = 'updated' | 'unchanged' | 'not_found' | 'unreachable';

/** On-demand check (from /track, /status or Refresh): saves the result without notifying. */
export async function refreshShipment(db: D1Database, provider: TrackingProvider, shipment: Shipment): Promise<RefreshOutcome> {
	try {
		const applied = await applyTrackingResult(db, shipment, await provider.fetchStatus(shipment.awb), { notify: false });
		if (!applied.found) return 'not_found';
		return applied.changed ? 'updated' : 'unchanged';
	} catch (err) {
		console.error(`[refresh] couldn't refresh ${shipment.awb}:`, err);
		return 'unreachable';
	}
}
