import type { Bot } from 'grammy';
import { escapeHtml } from '../lib/html';
import { replyHtml } from './reply';

/** Source for /help and for the command menu registered by /setup. */
export const BOT_COMMANDS = [
	{ command: 'track', args: '<AWB> [name]', description: 'Start tracking a BlueDart shipment' },
	{ command: 'list', args: '', description: 'Your shipments: refresh, rename, change check interval or stop' },
	{ command: 'status', args: '<AWB>', description: 'Latest scans and expected delivery date' },
	{ command: 'rename', args: '<AWB> <name>', description: 'Rename a shipment' },
	{ command: 'untrack', args: '<AWB>', description: 'Stop tracking a shipment' },
	{ command: 'help', args: '', description: 'Show the commands' },
] as const;

export const HELP_TEXT = [
	'<b>Commands</b>',
	...BOT_COMMANDS.map(({ command, args, description }) => `/${command}${args ? ` ${escapeHtml(args)}` : ''} – ${description}`),
].join('\n');

export function registerHelp(bot: Bot): void {
	bot.command('start', async (ctx) => {
		const name = escapeHtml(ctx.from?.first_name ?? 'there');
		await replyHtml(ctx, `Hi ${name}! I track BlueDart shipments and message you when their status changes.\n\n${HELP_TEXT}`);
	});

	bot.command('help', (ctx) => replyHtml(ctx, HELP_TEXT));
}
