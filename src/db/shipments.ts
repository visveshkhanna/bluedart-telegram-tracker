// All D1 access for users and shipments lives here.
// SQL uses snake_case; the rest of the app uses the camelCase types below.

export interface User {
	chatId: number;
	username?: string | null;
	firstName?: string | null;
}

export interface Shipment {
	id: number;
	chatId: number;
	awb: string;
	label: string | null;
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

export const SHIPMENT_COLUMNS =
	"id, chat_id, awb, label, last_status, last_status_text, last_location, last_event_at, last_checked_at, expected_delivery_date, check_interval_minutes, next_check_at, is_active";

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

/** Insert or refresh a user. Talking to the bot again also clears `is_blocked`. */
export async function upsertUser(db: D1Database, user: User): Promise<void> {
	await db
		.prepare(
			`INSERT INTO users (chat_id, username, first_name)
			 VALUES (?1, ?2, ?3)
			 ON CONFLICT (chat_id) DO UPDATE SET
			   username = excluded.username,
			   first_name = excluded.first_name,
			   is_blocked = 0`,
		)
		.bind(user.chatId, user.username ?? null, user.firstName ?? null)
		.run();
}

export type AddShipmentResult = "added" | "reactivated" | "exists";

/**
 * Start tracking an AWB for a chat.
 * - new AWB → inserted ("added")
 * - previously untracked → reactivated ("reactivated")
 * - already active → label updated if one was given ("exists")
 */
export async function addShipment(
	db: D1Database,
	chatId: number,
	awb: string,
	label: string | null,
): Promise<AddShipmentResult> {
	const existing = await db
		.prepare("SELECT is_active FROM shipments WHERE chat_id = ?1 AND awb = ?2")
		.bind(chatId, awb)
		.first<{ is_active: number }>();

	if (!existing) {
		await db
			.prepare("INSERT INTO shipments (chat_id, awb, label) VALUES (?1, ?2, ?3)")
			.bind(chatId, awb, label)
			.run();
		return "added";
	}

	await db
		.prepare(
			`UPDATE shipments
			 SET is_active = 1, label = COALESCE(?3, label), updated_at = datetime('now')
			 WHERE chat_id = ?1 AND awb = ?2`,
		)
		.bind(chatId, awb, label)
		.run();
	return existing.is_active === 1 ? "exists" : "reactivated";
}

export async function getShipment(db: D1Database, chatId: number, awb: string): Promise<Shipment | null> {
	const row = await db
		.prepare(`SELECT ${SHIPMENT_COLUMNS} FROM shipments WHERE chat_id = ?1 AND awb = ?2`)
		.bind(chatId, awb)
		.first<ShipmentRow>();
	return row ? toShipment(row) : null;
}

/** Looks a shipment up by id, but only within the given chat (callback data comes from the client). */
export async function getShipmentById(db: D1Database, chatId: number, id: number): Promise<Shipment | null> {
	const row = await db
		.prepare(`SELECT ${SHIPMENT_COLUMNS} FROM shipments WHERE id = ?1 AND chat_id = ?2`)
		.bind(id, chatId)
		.first<ShipmentRow>();
	return row ? toShipment(row) : null;
}

/** Active shipments for one chat, newest first. */
export async function listActiveShipments(db: D1Database, chatId: number): Promise<Shipment[]> {
	const { results } = await db
		.prepare(
			`SELECT ${SHIPMENT_COLUMNS} FROM shipments
			 WHERE chat_id = ?1 AND is_active = 1
			 ORDER BY created_at DESC, id DESC`,
		)
		.bind(chatId)
		.all<ShipmentRow>();
	return results.map(toShipment);
}

/** Stop tracking. Returns false if the AWB wasn't actively tracked by this chat. */
export async function deactivateShipment(db: D1Database, chatId: number, awb: string): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE shipments SET is_active = 0, updated_at = datetime('now')
			 WHERE chat_id = ?1 AND awb = ?2 AND is_active = 1`,
		)
		.bind(chatId, awb)
		.run();
	return result.meta.changes > 0;
}

/** Stop tracking by id. Returns false if it wasn't an active shipment of this chat. */
export async function deactivateShipmentById(db: D1Database, chatId: number, id: number): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE shipments SET is_active = 0, updated_at = datetime('now')
			 WHERE id = ?1 AND chat_id = ?2 AND is_active = 1`,
		)
		.bind(id, chatId)
		.run();
	return result.meta.changes > 0;
}

/** Sets a shipment's label; null clears it. Returns false if the shipment isn't this chat's. */
export async function renameShipment(db: D1Database, chatId: number, id: number, label: string | null): Promise<boolean> {
	const result = await db
		.prepare("UPDATE shipments SET label = ?3, updated_at = datetime('now') WHERE id = ?1 AND chat_id = ?2")
		.bind(id, chatId, label)
		.run();
	return result.meta.changes > 0;
}

/**
 * Changes how often a shipment is checked. The next check is rescheduled from the last
 * check (or now), so switching from "daily" to "15 min" takes effect right away.
 */
export async function setCheckInterval(db: D1Database, chatId: number, id: number, minutes: number): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE shipments SET
			   check_interval_minutes = ?3,
			   next_check_at = datetime(COALESCE(last_checked_at, datetime('now')), '+' || ?3 || ' minutes'),
			   updated_at = datetime('now')
			 WHERE id = ?1 AND chat_id = ?2`,
		)
		.bind(id, chatId, minutes)
		.run();
	return result.meta.changes > 0;
}
