import type { Bot } from "grammy";
import { addShipment, deactivateShipment, getShipment, listActiveShipments } from "../db/shipments";
import type { TrackingProvider } from "../tracker/provider";
import { isValidAwb, normalizeAwb } from "../utils/awb";
import { escapeHtml } from "../utils/format";
import { parseLabel } from "./manage";
import { refreshShipment, renderCard, renderList } from "./views";

function parseArgs(match: string): { awb: string | null; label: string | null } {
	const [rawAwb, ...rest] = match.trim().split(/\s+/).filter(Boolean);
	return { awb: rawAwb ? normalizeAwb(rawAwb) : null, label: parseLabel(rest.join(" ")) };
}

export function registerTracking(bot: Bot, db: D1Database, provider: TrackingProvider): void {
	bot.command("track", async (ctx) => {
		const { awb, label } = parseArgs(ctx.match);
		if (!awb) {
			await ctx.reply("Usage: /track &lt;AWB&gt; [name]\nExample: /track 12345678901 Black backpack", {
				parse_mode: "HTML",
			});
			return;
		}
		if (!isValidAwb(awb)) {
			await ctx.reply(`<code>${escapeHtml(awb)}</code> doesn't look like a BlueDart AWB (8–14 digits).`, {
				parse_mode: "HTML",
			});
			return;
		}

		const added = await addShipment(db, ctx.chat.id, awb, label);
		let header: string;
		if (added === "exists") {
			header = "Already tracking this one.";
		} else {
			await ctx.replyWithChatAction("typing");
			const outcome = await refreshShipment(db, provider, (await getShipment(db, ctx.chat.id, awb))!);
			header = {
				updated: "🚀 Tracking started. I'll message you on every new scan or delivery date change.",
				unchanged: "🚀 Tracking started. I'll message you on every new scan or delivery date change.",
				not_found:
					"🚀 Tracking started. BlueDart has no record of it yet, which is normal for a newly booked shipment.",
				unreachable: "🚀 Tracking started. I couldn't reach BlueDart just now, so I'll try again on the next check.",
			}[outcome];
		}

		const shipment = (await getShipment(db, ctx.chat.id, awb))!;
		if (!shipment.isActive) header = "✅ This shipment is already complete, so I'm not tracking it further.";
		const card = await renderCard(db, shipment);
		await ctx.reply(`${header}\n\n${card.text}`, { parse_mode: "HTML", reply_markup: card.keyboard });
	});

	bot.command("status", async (ctx) => {
		const { awb } = parseArgs(ctx.match);
		if (!awb) {
			await ctx.reply("Usage: /status &lt;AWB&gt;", { parse_mode: "HTML" });
			return;
		}
		const shipment = await getShipment(db, ctx.chat.id, awb);
		if (!shipment) {
			await ctx.reply(`You're not tracking <code>${escapeHtml(awb)}</code>. Use /track first.`, { parse_mode: "HTML" });
			return;
		}

		let note = "";
		if (shipment.isActive) {
			await ctx.replyWithChatAction("typing");
			const outcome = await refreshShipment(db, provider, shipment);
			if (outcome === "unreachable") note = "<i>Couldn't reach BlueDart, so this is the last known status.</i>\n\n";
			if (outcome === "not_found") note = "<i>BlueDart has no record of this AWB yet.</i>\n\n";
		}
		const card = await renderCard(db, (await getShipment(db, ctx.chat.id, awb))!);
		await ctx.reply(note + card.text, { parse_mode: "HTML", reply_markup: card.keyboard });
	});

	bot.command("list", async (ctx) => {
		const view = renderList(await listActiveShipments(db, ctx.chat.id));
		await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
	});

	bot.command("untrack", async (ctx) => {
		const { awb } = parseArgs(ctx.match);
		if (!awb) {
			await ctx.reply("Usage: /untrack &lt;AWB&gt;", { parse_mode: "HTML" });
			return;
		}
		const removed = await deactivateShipment(db, ctx.chat.id, awb);
		await ctx.reply(
			removed ? `Stopped tracking <code>${escapeHtml(awb)}</code>.` : `You weren't tracking <code>${escapeHtml(awb)}</code>.`,
			{ parse_mode: "HTML" },
		);
	});
}
