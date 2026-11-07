import type { Shipment } from "../db/shipments";
import { getScanKeys, markChecked, saveTrackingUpdate, scanKey } from "../db/tracking";
import { formatUpdateMessage } from "./messages";
import type { Scan, TrackingResult } from "./provider";

export interface AppliedUpdate {
	found: boolean;
	changed: boolean;
	newScans: Scan[];
	isTerminal: boolean;
	/** Notification stored as pending_message (only when `notify` was requested and something changed). */
	message: string | null;
}

/**
 * Compares a carrier result with what's stored for the shipment and saves the difference.
 * A change means new scans, or an expected delivery date that differs from the stored one.
 * A missing date (null) is treated as a scraping glitch and never overwrites a known one.
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
