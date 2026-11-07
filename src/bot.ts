import { Bot } from "grammy";
import { registerStart } from "./commands/start";
import { registerTracking } from "./commands/tracking";
import { upsertUser } from "./db/shipments";

/**
 * Builds a bot for one request. `env` only exists inside the Worker handlers,
 * so this is called per request; passing botInfo avoids a getMe call each time.
 */
export function createBot(env: Env): Bot {
	const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

	// Remember everyone who messages the bot (and un-block them if they come back).
	bot.use(async (ctx, next) => {
		if (ctx.message && ctx.chat) {
			await upsertUser(env.DB, {
				chatId: ctx.chat.id,
				username: ctx.from?.username,
				firstName: ctx.from?.first_name,
			});
		}
		await next();
	});

	registerStart(bot);
	registerTracking(bot, env.DB);

	bot.on("message", async (ctx) => {
		await ctx.reply("I don't know that one. Try /help.");
	});

	bot.catch((err) => {
		console.error(`[bot] error while handling update ${err.ctx.update.update_id}:`, err.error);
	});

	return bot;
}
