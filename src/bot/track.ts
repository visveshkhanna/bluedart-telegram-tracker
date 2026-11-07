// /track, /status, /list and /untrack.
import type { Bot } from 'grammy';
import { addShipment, deactivateShipment, getShipment, listActiveShipments } from '../db/shipments';
import { isValidAwb } from '../lib/awb';
import { escapeHtml } from '../lib/html';
import { refreshShipment, type RefreshOutcome } from '../tracker/apply';
import type { TrackingProvider } from '../tracker/types';
import { parseAwbArgs, parseLabel } from './args';
import { replyHtml, replyView } from './reply';
import { renderCard, renderList } from './views';

const STARTED = "🚀 Tracking started. I'll message you on every new scan or delivery date change.";
const TRACK_HEADERS: Record<RefreshOutcome, string> = {
	updated: STARTED,
	unchanged: STARTED,
	not_found: '🚀 Tracking started. BlueDart has no record of it yet, which is normal for a newly booked shipment.',
	unreachable: "🚀 Tracking started. I couldn't reach BlueDart just now, so I'll try again on the next check.",
};

const code = (awb: string) => `<code>${escapeHtml(awb)}</code>`;

export function registerTracking(bot: Bot, db: D1Database, provider: TrackingProvider): void {
	bot.command('track', async (ctx) => {
		const { awb, rest } = parseAwbArgs(ctx.match);
		if (!awb) return replyHtml(ctx, 'Usage: /track &lt;AWB&gt; [name]\nExample: /track 12345678901 Black backpack');
		if (!isValidAwb(awb)) return replyHtml(ctx, `${code(awb)} doesn't look like a BlueDart AWB (8–14 digits).`);

		const added = await addShipment(db, ctx.chat.id, awb, parseLabel(rest));
		let header = 'Already tracking this one.';
		if (added !== 'exists') {
			await ctx.replyWithChatAction('typing');
			header = TRACK_HEADERS[await refreshShipment(db, provider, (await getShipment(db, ctx.chat.id, awb))!)];
		}

		const shipment = (await getShipment(db, ctx.chat.id, awb))!;
		if (!shipment.isActive) header = "✅ This shipment is already complete, so I'm not tracking it further.";
		return replyView(ctx, await renderCard(db, shipment), `${header}\n\n`);
	});

	bot.command('status', async (ctx) => {
		const { awb } = parseAwbArgs(ctx.match);
		if (!awb) return replyHtml(ctx, 'Usage: /status &lt;AWB&gt;');

		const shipment = await getShipment(db, ctx.chat.id, awb);
		if (!shipment) return replyHtml(ctx, `You're not tracking ${code(awb)}. Use /track first.`);

		let note = '';
		if (shipment.isActive) {
			await ctx.replyWithChatAction('typing');
			const outcome = await refreshShipment(db, provider, shipment);
			if (outcome === 'unreachable') note = "<i>Couldn't reach BlueDart, so this is the last known status.</i>\n\n";
			if (outcome === 'not_found') note = '<i>BlueDart has no record of this AWB yet.</i>\n\n';
		}
		return replyView(ctx, await renderCard(db, (await getShipment(db, ctx.chat.id, awb))!), note);
	});

	bot.command('list', async (ctx) => replyView(ctx, renderList(await listActiveShipments(db, ctx.chat.id))));

	bot.command('untrack', async (ctx) => {
		const { awb } = parseAwbArgs(ctx.match);
		if (!awb) return replyHtml(ctx, 'Usage: /untrack &lt;AWB&gt;');

		const shipment = await getShipment(db, ctx.chat.id, awb);
		const stopped = shipment ? await deactivateShipment(db, ctx.chat.id, shipment.id) : false;
		return replyHtml(ctx, stopped ? `Stopped tracking ${code(awb)}.` : `You weren't tracking ${code(awb)}.`);
	});
}
