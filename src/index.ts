import { Api, webhookCallback } from "grammy";
import { createBot } from "./bot";
import { bluedartProvider } from "./tracker/bluedart";
import { runTracker } from "./tracker/run";

export default {
	async fetch(request, env): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === "/webhook") {
			if (request.method !== "POST") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			// grammY rejects requests whose X-Telegram-Bot-Api-Secret-Token doesn't match.
			return webhookCallback(createBot(env), "cloudflare-mod", { secretToken: env.WEBHOOK_SECRET })(request);
		}

		return new Response("ok");
	},

	async scheduled(_controller, env, ctx): Promise<void> {
		ctx.waitUntil(runTracker({ db: env.DB, api: new Api(env.BOT_TOKEN), provider: bluedartProvider }));
	},
} satisfies ExportedHandler<Env>;
