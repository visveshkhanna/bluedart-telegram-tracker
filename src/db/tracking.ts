// D1 queries used by the cron tracker run.
import type { TrackingResult } from "../tracker/provider";
import type { Shipment } from "./shipments";
import { SHIPMENT_COLUMNS, toShipment, type ShipmentRow } from "./shipments";

/** Active shipments of non-blocked users, least recently checked first (never-checked first of all). */
export async function getShipmentsToCheck(db: D1Database, limit: number): Promise<Shipment[]> {
	const columns = SHIPMENT_COLUMNS.split(", ").map((c) => `s.${c}`).join(", ");
	const { results } = await db
		.prepare(
			`SELECT ${columns} FROM shipments s
			 JOIN users u ON u.chat_id = s.chat_id
			 WHERE s.is_active = 1 AND u.is_blocked = 0
			 ORDER BY s.last_checked_at ASC NULLS FIRST, s.id ASC
			 LIMIT ?1`,
		)
		.bind(limit)
		.all<ShipmentRow>();
	return results.map(toShipment);
}

export async function markChecked(db: D1Database, shipmentId: number): Promise<void> {
	await db
		.prepare("UPDATE shipments SET last_checked_at = datetime('now') WHERE id = ?1")
		.bind(shipmentId)
		.run();
}

/**
 * Atomically records a status change: inserts a status_event (not yet notified)
 * and updates the shipment's last_* fields. Terminal statuses deactivate the shipment.
 * Returns the new event id.
 */
export async function recordStatusChange(
	db: D1Database,
	shipmentId: number,
	result: TrackingResult,
): Promise<number> {
	const [insert] = await db.batch([
		db
			.prepare(
				`INSERT INTO status_events (shipment_id, status, status_text, location, event_at, is_terminal)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			)
			.bind(
				shipmentId,
				result.status,
				result.statusText,
				result.location ?? null,
				result.eventAt ?? null,
				result.isTerminal ? 1 : 0,
			),
		db
			.prepare(
				`UPDATE shipments SET
				   last_status = ?2, last_status_text = ?3, last_location = ?4, last_event_at = ?5,
				   last_checked_at = datetime('now'), updated_at = datetime('now'),
				   is_active = ?6
				 WHERE id = ?1`,
			)
			.bind(
				shipmentId,
				result.status,
				result.statusText,
				result.location ?? null,
				result.eventAt ?? null,
				result.isTerminal ? 0 : 1,
			),
	]);
	return insert.meta.last_row_id;
}

export async function markEventNotified(db: D1Database, eventId: number): Promise<void> {
	await db.prepare("UPDATE status_events SET notified = 1 WHERE id = ?1").bind(eventId).run();
}

export async function markUserBlocked(db: D1Database, chatId: number): Promise<void> {
	await db.prepare("UPDATE users SET is_blocked = 1 WHERE chat_id = ?1").bind(chatId).run();
}

export interface PendingNotification {
	eventId: number;
	chatId: number;
	awb: string;
	label: string | null;
	status: string;
	statusText: string | null;
	location: string | null;
	eventAt: string | null;
	isTerminal: boolean;
}

/** Events whose notification failed earlier (last 24h only), so the next run can retry them. */
export async function getPendingNotifications(db: D1Database, limit: number): Promise<PendingNotification[]> {
	const { results } = await db
		.prepare(
			`SELECT e.id AS event_id, s.chat_id, s.awb, s.label, e.status, e.status_text, e.location, e.event_at, e.is_terminal
			 FROM status_events e
			 JOIN shipments s ON s.id = e.shipment_id
			 JOIN users u ON u.chat_id = s.chat_id
			 WHERE e.notified = 0 AND u.is_blocked = 0 AND e.created_at > datetime('now', '-1 day')
			 ORDER BY e.id ASC
			 LIMIT ?1`,
		)
		.bind(limit)
		.all<{
			event_id: number;
			chat_id: number;
			awb: string;
			label: string | null;
			status: string;
			status_text: string | null;
			location: string | null;
			event_at: string | null;
			is_terminal: number;
		}>();
	return results.map((r) => ({
		eventId: r.event_id,
		chatId: r.chat_id,
		awb: r.awb,
		label: r.label,
		status: r.status,
		statusText: r.status_text,
		location: r.location,
		eventAt: r.event_at,
		isTerminal: r.is_terminal === 1,
	}));
}
