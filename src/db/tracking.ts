// D1 queries used when applying carrier updates (cron run, /track, /status).
import type { Scan } from "../tracker/provider";
import { SHIPMENT_COLUMNS, toShipment, type Shipment, type ShipmentRow } from "./shipments";

/** Normalized identity of a scan, used to tell new scans from ones already stored. */
export function scanKey(scan: Scan): string {
	return [scan.date, scan.time, scan.location, scan.details]
		.map((part) => part.replace(/\s+/g, " ").trim().toLowerCase())
		.join("|");
}

// The cron ticks every 5 minutes but not exactly on the minute, so a shipment due within
// the next 2 minutes counts as due now; otherwise an hourly check could slip to 65 minutes.
const DUE_TOLERANCE = "+2 minutes";

/** SQL that schedules the next check one interval from now. */
const NEXT_CHECK = "datetime('now', '+' || check_interval_minutes || ' minutes')";

/** Due active shipments of non-blocked users, most overdue (or never checked) first. */
export async function getShipmentsToCheck(db: D1Database, limit: number): Promise<Shipment[]> {
	const columns = SHIPMENT_COLUMNS.split(", ").map((c) => `s.${c}`).join(", ");
	const { results } = await db
		.prepare(
			`SELECT ${columns} FROM shipments s
			 JOIN users u ON u.chat_id = s.chat_id
			 WHERE s.is_active = 1 AND u.is_blocked = 0
			   AND (s.next_check_at IS NULL OR s.next_check_at <= datetime('now', '${DUE_TOLERANCE}'))
			 ORDER BY s.next_check_at ASC NULLS FIRST, s.id ASC
			 LIMIT ?1`,
		)
		.bind(limit)
		.all<ShipmentRow>();
	return results.map(toShipment);
}

export async function markChecked(db: D1Database, shipmentId: number): Promise<void> {
	await db
		.prepare(`UPDATE shipments SET last_checked_at = datetime('now'), next_check_at = ${NEXT_CHECK} WHERE id = ?1`)
		.bind(shipmentId)
		.run();
}

export async function getScanKeys(db: D1Database, shipmentId: number): Promise<Set<string>> {
	const { results } = await db
		.prepare("SELECT scan_key FROM scans WHERE shipment_id = ?1")
		.bind(shipmentId)
		.all<{ scan_key: string }>();
	return new Set(results.map((r) => r.scan_key));
}

/** Most recent scans first. Scans are inserted oldest-first, so a higher id means a newer scan. */
export async function getRecentScans(db: D1Database, shipmentId: number, limit: number): Promise<Scan[]> {
	const { results } = await db
		.prepare(
			`SELECT location, details, scan_date, scan_time FROM scans
			 WHERE shipment_id = ?1 ORDER BY id DESC LIMIT ?2`,
		)
		.bind(shipmentId, limit)
		.all<{ location: string; details: string; scan_date: string; scan_time: string }>();
	return results.map((r) => ({ location: r.location, details: r.details, date: r.scan_date, time: r.scan_time }));
}

export interface TrackingUpdate {
	newScans: Scan[];
	/** Newest scan overall (may be an old one if only the delivery date changed). */
	latest: Scan | null;
	expectedDeliveryDate: string | null;
	isTerminal: boolean;
	/** Notification to send; null when the caller shows the update itself (e.g. /track). */
	pendingMessage: string | null;
}

/** Atomically stores new scans and the shipment's latest state (plus any pending notification). */
export async function saveTrackingUpdate(db: D1Database, shipmentId: number, update: TrackingUpdate): Promise<void> {
	const { latest } = update;
	// newScans is newest-first (BlueDart order); insert oldest-first so ids increase with time.
	const statements = [
		...[...update.newScans].reverse().map((scan) =>
			db
				.prepare(
					`INSERT OR IGNORE INTO scans (shipment_id, location, details, scan_date, scan_time, scan_key)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
				)
				.bind(shipmentId, scan.location, scan.details, scan.date, scan.time, scanKey(scan)),
		),
		db
			.prepare(
				`UPDATE shipments SET
				   last_status = COALESCE(?2, last_status),
				   last_status_text = COALESCE(?3, last_status_text),
				   last_location = COALESCE(?4, last_location),
				   last_event_at = COALESCE(?5, last_event_at),
				   expected_delivery_date = COALESCE(?6, expected_delivery_date),
				   is_active = ?7,
				   pending_message = COALESCE(?8, pending_message),
				   last_checked_at = datetime('now'),
				   next_check_at = ${NEXT_CHECK},
				   updated_at = datetime('now')
				 WHERE id = ?1`,
			)
			.bind(
				shipmentId,
				latest ? scanKey(latest) : null,
				latest?.details ?? null,
				latest?.location ?? null,
				latest ? `${latest.date} ${latest.time}` : null,
				update.expectedDeliveryDate,
				update.isTerminal ? 0 : 1,
				update.pendingMessage,
			),
	];
	await db.batch(statements);
}

export async function clearPendingMessage(db: D1Database, shipmentId: number): Promise<void> {
	await db.prepare("UPDATE shipments SET pending_message = NULL WHERE id = ?1").bind(shipmentId).run();
}

export interface PendingMessage {
	shipmentId: number;
	chatId: number;
	message: string;
}

/** Notifications that failed to send earlier, for users who haven't blocked the bot. */
export async function getPendingMessages(db: D1Database, limit: number): Promise<PendingMessage[]> {
	const { results } = await db
		.prepare(
			`SELECT s.id, s.chat_id, s.pending_message FROM shipments s
			 JOIN users u ON u.chat_id = s.chat_id
			 WHERE s.pending_message IS NOT NULL AND u.is_blocked = 0
			 ORDER BY s.updated_at ASC
			 LIMIT ?1`,
		)
		.bind(limit)
		.all<{ id: number; chat_id: number; pending_message: string }>();
	return results.map((r) => ({ shipmentId: r.id, chatId: r.chat_id, message: r.pending_message }));
}

export async function markUserBlocked(db: D1Database, chatId: number): Promise<void> {
	await db.prepare("UPDATE users SET is_blocked = 1 WHERE chat_id = ?1").bind(chatId).run();
}
