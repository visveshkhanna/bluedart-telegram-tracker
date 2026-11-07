// Shipment reads and user-initiated changes. SQL is snake_case; the app uses camelCase.

export interface Shipment {
	id: number;
	chatId: number;
	awb: string;
	label: string | null;
	/** Key of the newest scan (see scanKey). */
	lastStatus: string | null;
	lastStatusText: string | null;
	lastLocation: string | null;
	lastEventAt: string | null;
	lastCheckedAt: string | null;
	expectedDeliveryDate: string | null;
	checkIntervalMinutes: number;
	nextCheckAt: string | null;
	isActive: boolean;
}

export interface ShipmentRow {
	id: number;
	chat_id: number;
	awb: string;
	label: string | null;
	last_status: string | null;
	last_status_text: string | null;
	last_location: string | null;
	last_event_at: string | null;
	last_checked_at: string | null;
	expected_delivery_date: string | null;
	check_interval_minutes: number;
	next_check_at: string | null;
	is_active: number;
}

export function toShipment(row: ShipmentRow): Shipment {
	return {
		id: row.id,
		chatId: row.chat_id,
		awb: row.awb,
		label: row.label,
		lastStatus: row.last_status,
		lastStatusText: row.last_status_text,
		lastLocation: row.last_location,
		lastEventAt: row.last_event_at,
		lastCheckedAt: row.last_checked_at,
		expectedDeliveryDate: row.expected_delivery_date,
		checkIntervalMinutes: row.check_interval_minutes,
		nextCheckAt: row.next_check_at,
		isActive: row.is_active === 1,
	};
}

export type AddShipmentResult = 'added' | 'reactivated' | 'exists';

/**
 * Starts tracking an AWB for a chat. Re-adding an untracked AWB reactivates it, and
 * re-adding an active one only updates the label (when one is given).
 */
export async function addShipment(db: D1Database, chatId: number, awb: string, label: string | null): Promise<AddShipmentResult> {
	const existing = await db
		.prepare('SELECT is_active FROM shipments WHERE chat_id = ?1 AND awb = ?2')
		.bind(chatId, awb)
		.first<{ is_active: number }>();

	if (!existing) {
		await db.prepare('INSERT INTO shipments (chat_id, awb, label) VALUES (?1, ?2, ?3)').bind(chatId, awb, label).run();
		return 'added';
	}

	await db
		.prepare(
			`UPDATE shipments SET is_active = 1, label = COALESCE(?3, label), updated_at = datetime('now')
			 WHERE chat_id = ?1 AND awb = ?2`,
		)
		.bind(chatId, awb, label)
		.run();
	return existing.is_active === 1 ? 'exists' : 'reactivated';
}

export async function getShipment(db: D1Database, chatId: number, awb: string): Promise<Shipment | null> {
	const row = await db.prepare('SELECT * FROM shipments WHERE chat_id = ?1 AND awb = ?2').bind(chatId, awb).first<ShipmentRow>();
	return row ? toShipment(row) : null;
}

/** Looks a shipment up by id within one chat, since ids in callback data come from the client. */
export async function getShipmentById(db: D1Database, chatId: number, id: number): Promise<Shipment | null> {
	const row = await db.prepare('SELECT * FROM shipments WHERE id = ?1 AND chat_id = ?2').bind(id, chatId).first<ShipmentRow>();
	return row ? toShipment(row) : null;
}

/** Active shipments for one chat, newest first. */
export async function listActiveShipments(db: D1Database, chatId: number): Promise<Shipment[]> {
	const { results } = await db
		.prepare('SELECT * FROM shipments WHERE chat_id = ?1 AND is_active = 1 ORDER BY created_at DESC, id DESC')
		.bind(chatId)
		.all<ShipmentRow>();
	return results.map(toShipment);
}

/** Stops tracking. Returns false if it wasn't an active shipment of this chat. */
export async function deactivateShipment(db: D1Database, chatId: number, id: number): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE shipments SET is_active = 0, updated_at = datetime('now')
			 WHERE id = ?1 AND chat_id = ?2 AND is_active = 1`,
		)
		.bind(id, chatId)
		.run();
	return result.meta.changes > 0;
}

/** Sets the label; null clears it. */
export async function renameShipment(db: D1Database, chatId: number, id: number, label: string | null): Promise<void> {
	await db
		.prepare("UPDATE shipments SET label = ?3, updated_at = datetime('now') WHERE id = ?1 AND chat_id = ?2")
		.bind(id, chatId, label)
		.run();
}

/**
 * Changes the check interval and reschedules from the last check (or now), so going
 * from "1 day" to "15 min" takes effect right away.
 */
export async function setCheckInterval(db: D1Database, chatId: number, id: number, minutes: number): Promise<void> {
	await db
		.prepare(
			`UPDATE shipments SET
			   check_interval_minutes = ?3,
			   next_check_at = datetime(COALESCE(last_checked_at, datetime('now')), '+' || ?3 || ' minutes'),
			   updated_at = datetime('now')
			 WHERE id = ?1 AND chat_id = ?2`,
		)
		.bind(id, chatId, minutes)
		.run();
}
