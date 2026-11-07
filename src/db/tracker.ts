// Queries used by the tracker (cron run and on-demand refreshes).
import { TRACKER } from '../config';
import type { Scan } from '../tracker/types';
import { insertScans, scanKey } from './scans';
import { toShipment, type Shipment, type ShipmentRow } from './shipments';

const NEXT_CHECK = "datetime('now', '+' || check_interval_minutes || ' minutes')";

/** Active shipments of non-blocked users that are due, most overdue (or never checked) first. */
export async function getDueShipments(db: D1Database, limit: number): Promise<Shipment[]> {
	const { results } = await db
		.prepare(
			`SELECT s.* FROM shipments s
			 JOIN users u ON u.chat_id = s.chat_id
			 WHERE s.is_active = 1 AND u.is_blocked = 0
			   AND (s.next_check_at IS NULL OR s.next_check_at <= datetime('now', '+' || ?2 || ' minutes'))
			 ORDER BY s.next_check_at ASC NULLS FIRST, s.id ASC
			 LIMIT ?1`,
		)
		.bind(limit, TRACKER.dueToleranceMinutes)
		.all<ShipmentRow>();
	return results.map(toShipment);
}

/** Records a check that found nothing new and schedules the next one. */
export async function markChecked(db: D1Database, shipmentId: number): Promise<void> {
	await db
		.prepare(`UPDATE shipments SET last_checked_at = datetime('now'), next_check_at = ${NEXT_CHECK} WHERE id = ?1`)
		.bind(shipmentId)
		.run();
}

export interface TrackingUpdate {
	/** Newest first. */
	newScans: Scan[];
	/** Newest scan overall (may be an old one if only the delivery date changed). */
	latest: Scan | null;
	expectedDeliveryDate: string | null;
	isTerminal: boolean;
	/** Notification to deliver; null when the caller shows the update itself. */
	pendingMessage: string | null;
}

/** Atomically stores new scans, the shipment's latest state and any pending notification. */
export async function saveTrackingUpdate(db: D1Database, shipmentId: number, update: TrackingUpdate): Promise<void> {
	const { latest } = update;
	await db.batch([
		...insertScans(db, shipmentId, update.newScans),
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
	]);
}

export async function clearPendingMessage(db: D1Database, shipmentId: number): Promise<void> {
	await db.prepare('UPDATE shipments SET pending_message = NULL WHERE id = ?1').bind(shipmentId).run();
}

export interface PendingMessage {
	shipmentId: number;
	chatId: number;
	message: string;
}

/** Notifications that failed earlier, for users who haven't blocked the bot. */
export async function getPendingMessages(db: D1Database, limit: number): Promise<PendingMessage[]> {
	const { results } = await db
		.prepare(
			`SELECT s.id AS shipmentId, s.chat_id AS chatId, s.pending_message AS message FROM shipments s
			 JOIN users u ON u.chat_id = s.chat_id
			 WHERE s.pending_message IS NOT NULL AND u.is_blocked = 0
			 ORDER BY s.updated_at ASC
			 LIMIT ?1`,
		)
		.bind(limit)
		.all<PendingMessage>();
	return results;
}
