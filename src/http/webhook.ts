import { webhookCallback } from 'grammy';
import { createBot, ensureBotInfo } from '../bot/bot';

/** POST /webhook: Telegram updates, authenticated with the secret token set via setWebhook. */
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
	// Reject unauthenticated calls before doing any work (grammY checks this again).
	if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
		return new Response('Unauthorized', { status: 401 });
	}

	const bot = createBot(env);
	await ensureBotInfo(bot);
	return webhookCallback(bot, 'cloudflare-mod', { secretToken: env.WEBHOOK_SECRET })(request);
}
