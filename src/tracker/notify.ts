import { GrammyError, type Api } from 'grammy';
import { TRACKER } from '../config';
import { markUserBlocked } from '../db/users';
import { sleep } from '../lib/time';

export type SendResult = 'sent' | 'blocked' | 'failed';

/**
 * Sends one HTML message. A 403 (user blocked the bot) marks the user blocked; a short
 * 429 is waited out once. Anything else is reported as "failed" so the caller can retry later.
 */
export async function sendNotification(api: Api, db: D1Database, chatId: number, text: string): Promise<SendResult> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await api.sendMessage(chatId, text, { parse_mode: 'HTML' });
			return 'sent';
		} catch (err) {
			if (err instanceof GrammyError && err.error_code === 403) {
				await markUserBlocked(db, chatId);
				return 'blocked';
			}
			const retryAfter = err instanceof GrammyError ? err.parameters.retry_after : undefined;
			if (attempt === 0 && retryAfter !== undefined && retryAfter <= TRACKER.maxRateLimitWaitSeconds) {
				await sleep(retryAfter * 1000);
				continue;
			}
			console.error(`[notify] failed to message chat ${chatId}:`, err);
			return 'failed';
		}
	}
	return 'failed';
}
