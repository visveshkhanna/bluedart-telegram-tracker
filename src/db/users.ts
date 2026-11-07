export interface User {
	chatId: number;
	username?: string | null;
	firstName?: string | null;
}

/** Inserts or refreshes a user. Talking to the bot again also clears `is_blocked`. */
export async function upsertUser(db: D1Database, user: User): Promise<void> {
	await db
		.prepare(
			`INSERT INTO users (chat_id, username, first_name) VALUES (?1, ?2, ?3)
			 ON CONFLICT (chat_id) DO UPDATE SET
			   username = excluded.username, first_name = excluded.first_name, is_blocked = 0`,
		)
		.bind(user.chatId, user.username ?? null, user.firstName ?? null)
		.run();
}

export async function markUserBlocked(db: D1Database, chatId: number): Promise<void> {
	await db.prepare('UPDATE users SET is_blocked = 1 WHERE chat_id = ?1').bind(chatId).run();
}
