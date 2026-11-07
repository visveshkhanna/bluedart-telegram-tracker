// GET /setup?secret=<WEBHOOK_SECRET>: one-time setup after deploying. Points the bot's
// webhook at this Worker and registers the command menu, so a fresh deploy needs
// nothing more than opening one URL in a browser.
import { Api } from "grammy";
import { BOT_COMMANDS } from "./commands/start";

const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"] as const;

/** Constant-time comparison, so the secret can't be guessed via response timing. */
function secretMatches(given: string, expected: string): boolean {
	const encoder = new TextEncoder();
	const a = encoder.encode(given);
	const b = encoder.encode(expected);
	return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

export async function handleSetup(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const secret = url.searchParams.get("secret") ?? "";
	if (!env.WEBHOOK_SECRET || !secretMatches(secret, env.WEBHOOK_SECRET)) {
		return Response.json({ ok: false, error: "Pass ?secret=<WEBHOOK_SECRET>" }, { status: 401 });
	}

	const api = new Api(env.BOT_TOKEN);
	const webhookUrl = `${url.origin}/webhook`;
	try {
		await api.setWebhook(webhookUrl, { secret_token: env.WEBHOOK_SECRET, allowed_updates: [...ALLOWED_UPDATES] });
		await api.setMyCommands(BOT_COMMANDS.map(({ command, description }) => ({ command, description })));
		const me = await api.getMe();
		return Response.json({ ok: true, bot: `@${me.username}`, webhook: webhookUrl });
	} catch (err) {
		console.error("[setup] failed:", err);
		return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
	}
}
