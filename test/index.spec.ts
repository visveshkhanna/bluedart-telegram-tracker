import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('worker routes', () => {
	it('serves a health check on /', async () => {
		const response = await SELF.fetch('https://example.com/');
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
	});

	it('only accepts POST on /webhook', async () => {
		const response = await SELF.fetch('https://example.com/webhook');
		expect(response.status).toBe(405);
	});

	it('rejects webhook calls without the secret token', async () => {
		const response = await SELF.fetch('https://example.com/webhook', {
			method: 'POST',
			headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
			body: JSON.stringify({ update_id: 1 }),
		});
		expect(response.status).toBe(401);
	});

	it('accepts webhook calls with the secret token', async () => {
		const response = await SELF.fetch('https://example.com/webhook', {
			method: 'POST',
			headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-secret', 'Content-Type': 'application/json' },
			body: JSON.stringify({ update_id: 1 }),
		});
		expect(response.status).toBe(200);
	});
});

describe('GET /setup', () => {
	it('requires the webhook secret', async () => {
		expect((await SELF.fetch('https://bot.example.com/setup')).status).toBe(401);
		expect((await SELF.fetch('https://bot.example.com/setup?secret=wrong')).status).toBe(401);
	});
});
