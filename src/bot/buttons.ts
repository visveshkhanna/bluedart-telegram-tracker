// Inline-button handlers: open a shipment card, refresh, change interval, rename, stop.
import { GrammyError, type Bot, type CallbackQueryContext, type Context } from 'grammy';
import { isAllowedInterval } from '../config';
import { deactivateShipment, getShipmentById, listActiveShipments, setCheckInterval, type Shipment } from '../db/shipments';
import { formatInterval } from '../lib/time';
import { refreshShipment, type RefreshOutcome } from '../tracker/apply';
import type { TrackingProvider } from '../tracker/types';
import { cb, cbPattern } from './callback-data';
import { sendRenamePrompt } from './rename';
import { renderCard, renderIntervalPicker, renderList, renderStopConfirm, shipmentName, type View } from './views';

const REFRESH_TOASTS: Record<RefreshOutcome, string> = {
	updated: 'Updated with the latest from BlueDart',
	unchanged: 'No new updates',
	not_found: 'BlueDart has no record of this AWB yet',
	unreachable: "Couldn't reach BlueDart, try again later",
};

/** Replaces the message the button belongs to; "message is not modified" is fine. */
async function edit(ctx: Context, view: View): Promise<void> {
	try {
		await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
	} catch (err) {
		if (!(err instanceof GrammyError && err.description.includes('message is not modified'))) throw err;
	}
}

type ShipmentHandler = (ctx: CallbackQueryContext<Context>, shipment: Shipment, match: RegExpMatchArray) => Promise<string | void>;

export function registerButtons(bot: Bot, db: D1Database, provider: TrackingProvider): void {
	const reload = async (s: Shipment) => (await getShipmentById(db, s.chatId, s.id))!;

	/**
	 * Registers a handler for a shipment button. The shipment is loaded within the pressing
	 * chat only, and the handler's return value (if any) is shown as a toast.
	 */
	function onShipment(pattern: RegExp, handler: ShipmentHandler) {
		bot.callbackQuery(pattern, async (ctx) => {
			const match = ctx.match as RegExpMatchArray;
			const shipment = ctx.chat ? await getShipmentById(db, ctx.chat.id, Number(match[1])) : null;
			if (!shipment) return ctx.answerCallbackQuery({ text: "That shipment isn't available any more." });
			const toast = await handler(ctx, shipment, match);
			await ctx.answerCallbackQuery(toast ? { text: toast } : undefined);
		});
	}

	bot.callbackQuery(cb.list, async (ctx) => {
		await edit(ctx, renderList(await listActiveShipments(db, ctx.chat!.id)));
		await ctx.answerCallbackQuery();
	});

	onShipment(cbPattern.show, async (ctx, shipment) => edit(ctx, await renderCard(db, shipment)));

	onShipment(cbPattern.refresh, async (ctx, shipment) => {
		if (!shipment.isActive) return 'Not being tracked any more.';
		const outcome = await refreshShipment(db, provider, shipment);
		await edit(ctx, await renderCard(db, await reload(shipment)));
		return REFRESH_TOASTS[outcome];
	});

	onShipment(cbPattern.intervals, async (ctx, shipment) => edit(ctx, renderIntervalPicker(shipment)));

	onShipment(cbPattern.setInterval, async (ctx, shipment, match) => {
		const minutes = Number(match[2]);
		if (!isAllowedInterval(minutes)) return "That interval isn't available.";
		await setCheckInterval(db, shipment.chatId, shipment.id, minutes);
		await edit(ctx, await renderCard(db, await reload(shipment)));
		return `Checking every ${formatInterval(minutes)}`;
	});

	onShipment(cbPattern.rename, async (ctx, shipment) => {
		await sendRenamePrompt(ctx, shipment);
	});

	onShipment(cbPattern.stop, async (ctx, shipment) => edit(ctx, renderStopConfirm(shipment)));

	onShipment(cbPattern.stopConfirm, async (ctx, shipment) => {
		await deactivateShipment(db, shipment.chatId, shipment.id);
		await edit(ctx, renderList(await listActiveShipments(db, shipment.chatId)));
		return `Stopped tracking ${shipmentName(shipment)}`;
	});
}
