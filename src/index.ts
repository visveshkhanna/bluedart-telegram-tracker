import { Api, webhookCallback } from "grammy";
import { createBot, ensureBotInfo } from "./bot";
import { handleSetup } from "./setup";
import { bluedartProvider } from "./tracker/bluedart";
import { runTracker } from "./tracker/run";

export default {
	async fetch(request, env): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === "/webhook") {
			if (request.method !== "POST") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			// Reject unauthenticated calls before doing any work (grammY checks this again).
			if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
				return new Response("Unauthorized", { status: 401 });
			}
			const bot = createBot(env);
			await ensureBotInfo(bot);
			return webhookCallback(bot, "cloudflare-mod", { secretToken: env.WEBHOOK_SECRET })(request);
		}

		if (pathname === "/setup" && request.method === "GET") {
			return handleSetup(request, env);
		}

		return new Response("ok");
	},

	async scheduled(_controller, env, ctx): Promise<void> {
		ctx.waitUntil(runTracker({ db: env.DB, api: new Api(env.BOT_TOKEN), provider: bluedartProvider }));
	},
} satisfies ExportedHandler<Env>;
