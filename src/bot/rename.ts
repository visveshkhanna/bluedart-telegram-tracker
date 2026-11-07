// Renaming: /rename <AWB> <name>, or replying to the prompt sent by the Rename button.
import type { Bot, Context } from 'grammy';
import { getShipment, getShipmentById, renameShipment, type Shipment } from '../db/shipments';
import { isValidAwb } from '../lib/awb';
import { escapeHtml } from '../lib/html';
import { parseAwbArgs, parseLabel } from './args';
import { replyHtml, replyView } from './reply';
import { renderCard, shipmentName } from './views';

// Replies to the prompt are recognised by this phrase followed by the AWB.
const PROMPT = 'Send the new name for';
const PROMPT_PATTERN = new RegExp(`${PROMPT} (\\d{8,14})`);

/** Asks for a new name using a force-reply, so the user's next message is a reply to it. */
export function sendRenamePrompt(ctx: Context, shipment: Shipment) {
	return ctx.reply(
		`✏️ ${PROMPT} <code>${shipment.awb}</code> (currently: ${escapeHtml(shipmentName(shipment))}).\nSend "-" to remove the name.`,
		{ parse_mode: 'HTML', reply_markup: { force_reply: true, input_field_placeholder: 'e.g. Black backpack' } },
	);
}

export function registerRename(bot: Bot, db: D1Database): void {
	async function rename(ctx: Context, awb: string, text: string) {
		const shipment = await getShipment(db, ctx.chat!.id, awb);
		if (!shipment) return replyHtml(ctx, `You're not tracking <code>${escapeHtml(awb)}</code>.`);

		const label = parseLabel(text);
		await renameShipment(db, shipment.chatId, shipment.id, label);
		const card = await renderCard(db, (await getShipmentById(db, shipment.chatId, shipment.id))!);
		return replyView(ctx, card, `${label ? 'Renamed.' : 'Name removed.'}\n\n`);
	}

	bot.command('rename', async (ctx) => {
		const { awb, rest } = parseAwbArgs(ctx.match);
		if (!awb || !isValidAwb(awb) || !rest) {
			return replyHtml(ctx, 'Usage: /rename &lt;AWB&gt; &lt;new name&gt; (use - to remove the name)');
		}
		return rename(ctx, awb, rest);
	});

	bot.on('message:text', async (ctx, next) => {
		const prompt = ctx.message.reply_to_message;
		const match = prompt?.from?.id === ctx.me.id ? prompt.text?.match(PROMPT_PATTERN) : null;
		if (!match || ctx.message.text.startsWith('/')) return next();
		await rename(ctx, match[1], ctx.message.text);
	});
}
