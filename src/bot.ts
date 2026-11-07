import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { registerManage } from "./commands/manage";
import { registerStart } from "./commands/start";
import { registerTracking } from "./commands/tracking";
import { upsertUser } from "./db/shipments";
import { bluedartProvider } from "./tracker/bluedart";
import type { TrackingProvider } from "./tracker/provider";

// getMe result, cached for the lifetime of the isolate when BOT_INFO isn't configured.
let cachedBotInfo: UserFromGetMe | undefined;

/** BOT_INFO is optional: when set (JSON from getMe) it saves one Telegram call per cold start. */
function configuredBotInfo(env: Env): UserFromGetMe | undefined {
	const raw = (env as { BOT_INFO?: string }).BOT_INFO?.trim();
	return raw ? (JSON.parse(raw) as UserFromGetMe) : cachedBotInfo;
}

/**
 * Builds a bot for one request (`env` only exists inside the Worker handlers).
 * Call `ensureBotInfo` before handling updates if BOT_INFO isn't configured.
 */
export function createBot(env: Env, provider: TrackingProvider = bluedartProvider): Bot {
	const bot = new Bot(env.BOT_TOKEN, { botInfo: configuredBotInfo(env) });

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
	registerTracking(bot, env.DB, provider);
	registerManage(bot, env.DB, provider);

	bot.on("message", async (ctx) => {
		await ctx.reply("I don't know that one. Try /help.");
	});

	bot.catch((err) => {
		console.error(`[bot] error while handling update ${err.ctx.update.update_id}:`, err.error);
	});

	return bot;
}

/** Fetches and caches getMe once per isolate if the bot was created without botInfo. */
export async function ensureBotInfo(bot: Bot): Promise<void> {
	if (!bot.isInited()) {
		await bot.init();
		cachedBotInfo = bot.botInfo;
	}
}
