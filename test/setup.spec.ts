import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSetup } from '../src/http/setup';

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

describe('handleSetup', () => {
	it('points the webhook at this Worker and registers the command menu', async () => {
		const calls = stubTelegram();
		const response = await handleSetup(new Request('https://tracker.example.workers.dev/setup?secret=test-secret'), env);

		expect(await response.json()).toEqual({
			ok: true,
			bot: '@tracker_bot',
			webhook: 'https://tracker.example.workers.dev/webhook',
		});
		const setWebhook = calls.find((c) => c.method === 'setWebhook')!;
		expect(setWebhook.body).toMatchObject({
			url: 'https://tracker.example.workers.dev/webhook',
			secret_token: 'test-secret',
		});
		const commands = calls.find((c) => c.method === 'setMyCommands')!.body.commands as { command: string }[];
		expect(commands.map((c) => c.command)).toEqual(['track', 'list', 'status', 'rename', 'untrack', 'help']);
	});
});
