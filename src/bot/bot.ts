import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { bluedartProvider } from '../bluedart/client';
import { upsertUser } from '../db/users';
import type { TrackingProvider } from '../tracker/types';
import { registerButtons } from './buttons';
import { registerHelp } from './commands';
import { registerRename } from './rename';
import { registerTracking } from './track';

// getMe result cached per isolate when BOT_INFO isn't configured.
let cachedBotInfo: UserFromGetMe | undefined;

function configuredBotInfo(env: Env): UserFromGetMe | undefined {
	const raw = (env as { BOT_INFO?: string }).BOT_INFO?.trim();
	return raw ? (JSON.parse(raw) as UserFromGetMe) : cachedBotInfo;
}

/**
 * Builds the bot for one request (bindings only exist inside handlers). Call
 * `ensureBotInfo` before handling updates in case BOT_INFO isn't configured.
 */
export function createBot(env: Env, provider: TrackingProvider = bluedartProvider): Bot {
	const bot = new Bot(env.BOT_TOKEN, { botInfo: configuredBotInfo(env) });

	bot.use(async (ctx, next) => {
		if (ctx.message && ctx.chat) {
			await upsertUser(env.DB, { chatId: ctx.chat.id, username: ctx.from?.username, firstName: ctx.from?.first_name });
		}
		await next();
	});

	registerHelp(bot);
	registerTracking(bot, env.DB, provider);
	registerRename(bot, env.DB);
	registerButtons(bot, env.DB, provider);

	bot.on('message', (ctx) => ctx.reply("I don't know that one. Try /help."));
	bot.catch((err) => console.error(`[bot] error handling update ${err.ctx.update.update_id}:`, err.error));

	return bot;
}

/** Fetches and caches getMe once per isolate when the bot was built without BOT_INFO. */
export async function ensureBotInfo(bot: Bot): Promise<void> {
	if (bot.isInited()) return;
	await bot.init();
	cachedBotInfo = bot.botInfo;
}
