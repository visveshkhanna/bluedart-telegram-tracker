import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBot, ensureBotInfo } from '../src/bot/bot';

afterEach(() => {
	vi.restoreAllMocks();
});

/** Stubs fetch to the Telegram API, recording each method and its JSON payload. */
function stubTelegram() {
	const calls: { method: string; body: Record<string, unknown> }[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = String(input instanceof Request ? input.url : input);
		const method = url.split('/').pop()!;
		const raw = init?.body ? String(init.body) : '{}';
		calls.push({ method, body: raw.startsWith('{') ? JSON.parse(raw) : {} });
		const result = method === 'getMe' ? { id: 1, is_bot: true, first_name: 'Tracker', username: 'tracker_bot' } : true;
		return Response.json({ ok: true, result });
	});
	return calls;
}

describe('optional BOT_INFO', () => {
	it("calls getMe once per isolate when BOT_INFO isn't set", async () => {
		const calls = stubTelegram();
		const envWithoutInfo = { ...env, BOT_INFO: '' };

		for (let i = 0; i < 2; i++) {
			const bot = createBot(envWithoutInfo);
			await ensureBotInfo(bot);
			expect(bot.botInfo.username).toBe('tracker_bot');
		}
		expect(calls.filter((c) => c.method === 'getMe')).toHaveLength(1);
	});

	it('uses BOT_INFO without calling Telegram when it is set', async () => {
		const calls = stubTelegram();
		const bot = createBot(env);
		await ensureBotInfo(bot);
		expect(bot.botInfo.username).toBe('test_bot');
		expect(calls).toHaveLength(0);
	});
});
