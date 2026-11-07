// Inline-button flows: open a shipment from /list, refresh, change interval, rename, stop.
import { GrammyError, type Bot, type CallbackQueryContext, type Context, type InlineKeyboard } from "grammy";
import {
	deactivateShipmentById,
	getShipment,
	getShipmentById,
	listActiveShipments,
	renameShipment,
	setCheckInterval,
	type Shipment,
} from "../db/shipments";
import { formatInterval, isAllowedInterval } from "../tracker/intervals";
import type { TrackingProvider } from "../tracker/provider";
import { escapeHtml } from "../utils/format";
import { isValidAwb, normalizeAwb } from "../utils/awb";
import {
	cb,
	refreshShipment,
	renderCard,
	renderIntervalPicker,
	renderList,
	renderStopConfirm,
	shipmentName,
} from "./views";

export const MAX_LABEL_LENGTH = 64;
// The rename prompt's text; replies to it are recognised by this phrase plus the AWB.
const RENAME_PROMPT = "Send the new name for";
const RENAME_PATTERN = new RegExp(`${RENAME_PROMPT} (\\d{8,14})`);

/** Parses a user-supplied name: trimmed, length-capped, and "-" means "clear it". */
export function parseLabel(text: string): string | null {
	const label = text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
	return label === "" || label === "-" ? null : label;
}

/** Edits the message the button belongs to; ignores "message is not modified". */
async function edit(ctx: Context, view: { text: string; keyboard?: InlineKeyboard }) {
	try {
		await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
	} catch (err) {
		if (err instanceof GrammyError && err.description.includes("message is not modified")) return;
		throw err;
	}
}

export function registerManage(bot: Bot, db: D1Database, provider: TrackingProvider): void {
	/** Registers a button handler for a shipment-scoped callback, loading (and authorising) the shipment. */
	function onShipment(
		pattern: RegExp,
		handler: (ctx: CallbackQueryContext<Context>, shipment: Shipment, match: RegExpMatchArray) => Promise<string | void>,
	) {
		bot.callbackQuery(pattern, async (ctx) => {
			const match = ctx.match as RegExpMatchArray;
			const shipment = ctx.chat ? await getShipmentById(db, ctx.chat.id, Number(match[1])) : null;
			if (!shipment) {
				await ctx.answerCallbackQuery({ text: "That shipment isn't available any more." });
				return;
			}
			const note = await handler(ctx, shipment, match);
			await ctx.answerCallbackQuery(note ? { text: note } : undefined);
		});
	}

	bot.callbackQuery(cb.list, async (ctx) => {
		await edit(ctx, renderList(await listActiveShipments(db, ctx.chat!.id)));
		await ctx.answerCallbackQuery();
	});

	onShipment(/^s:(\d+)$/, async (ctx, shipment) => {
		await edit(ctx, await renderCard(db, shipment));
	});

	onShipment(/^r:(\d+)$/, async (ctx, shipment) => {
		if (!shipment.isActive) return "Not being tracked any more.";
		const outcome = await refreshShipment(db, provider, shipment);
		await edit(ctx, await renderCard(db, (await getShipmentById(db, shipment.chatId, shipment.id))!));
		return {
			updated: "Updated with the latest from BlueDart",
			unchanged: "No new updates",
			not_found: "BlueDart has no record of this AWB yet",
			unreachable: "Couldn't reach BlueDart, try again later",
		}[outcome];
	});

	onShipment(/^i:(\d+)$/, async (ctx, shipment) => {
		await edit(ctx, renderIntervalPicker(shipment));
	});

	onShipment(/^i:(\d+):(\d+)$/, async (ctx, shipment, match) => {
		const minutes = Number(match[2]);
		if (!isAllowedInterval(minutes)) return "That interval isn't available.";
		await setCheckInterval(db, shipment.chatId, shipment.id, minutes);
		await edit(ctx, await renderCard(db, (await getShipmentById(db, shipment.chatId, shipment.id))!));
		return `Checking every ${formatInterval(minutes)}`;
	});

	onShipment(/^n:(\d+)$/, async (ctx, shipment) => {
		await ctx.reply(
			`✏️ ${RENAME_PROMPT} <code>${shipment.awb}</code> (currently: ${escapeHtml(shipmentName(shipment))}).\nSend "-" to remove the name.`,
			{
				parse_mode: "HTML",
				reply_markup: { force_reply: true, input_field_placeholder: "e.g. Black backpack" },
			},
		);
	});

	onShipment(/^x:(\d+)$/, async (ctx, shipment) => {
		await edit(ctx, renderStopConfirm(shipment));
	});

	onShipment(/^xy:(\d+)$/, async (ctx, shipment) => {
		await deactivateShipmentById(db, shipment.chatId, shipment.id);
		await edit(ctx, renderList(await listActiveShipments(db, shipment.chatId)));
		return `Stopped tracking ${shipmentName(shipment)}`;
	});

	async function rename(ctx: Context, awb: string, text: string) {
		const shipment = await getShipment(db, ctx.chat!.id, awb);
		if (!shipment) {
			await ctx.reply(`You're not tracking <code>${escapeHtml(awb)}</code>.`, { parse_mode: "HTML" });
			return;
		}
		const label = parseLabel(text);
		await renameShipment(db, shipment.chatId, shipment.id, label);
		const card = await renderCard(db, (await getShipmentById(db, shipment.chatId, shipment.id))!);
		await ctx.reply(`${label ? "Renamed." : "Name removed."}\n\n${card.text}`, {
			parse_mode: "HTML",
			reply_markup: card.keyboard,
		});
	}

	// /rename <AWB> <new name>
	bot.command("rename", async (ctx) => {
		const [rawAwb, ...rest] = ctx.match.trim().split(/\s+/).filter(Boolean);
		const awb = rawAwb ? normalizeAwb(rawAwb) : "";
		if (!isValidAwb(awb) || rest.length === 0) {
			await ctx.reply("Usage: /rename &lt;AWB&gt; &lt;new name&gt; (use - to remove the name)", { parse_mode: "HTML" });
			return;
		}
		await rename(ctx, awb, rest.join(" "));
	});

	// Replies to the "Send the new name for …" prompt from the Rename button.
	bot.on("message:text", async (ctx, next) => {
		const prompt = ctx.message.reply_to_message;
		const match = prompt?.from?.id === ctx.me.id ? prompt.text?.match(RENAME_PATTERN) : null;
		if (!match || ctx.message.text.startsWith("/")) return next();
		await rename(ctx, match[1], ctx.message.text);
	});
}
