import { Api } from 'grammy';
import { bluedartProvider } from './bluedart/client';
import { handleSetup } from './http/setup';
import { handleWebhook } from './http/webhook';
import { runTracker } from './tracker/run';

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);
		if (pathname === '/webhook') return handleWebhook(request, env);
		if (pathname === '/setup' && request.method === 'GET') return handleSetup(request, env);
		return new Response('ok');
	},

	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(runTracker({ db: env.DB, api: new Api(env.BOT_TOKEN), provider: bluedartProvider }));
	},
} satisfies ExportedHandler<Env>;
