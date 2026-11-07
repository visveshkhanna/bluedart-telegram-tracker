import type { Bot } from "grammy";
import {
	addShipment,
	deactivateShipment,
	getShipment,
	listActiveShipments,
	type Shipment,
} from "../db/shipments";
import { getRecentScans } from "../db/tracking";
import { applyTrackingResult } from "../tracker/apply";
import { formatShipmentDetails } from "../tracker/messages";
import type { TrackingProvider } from "../tracker/provider";
import { isValidAwb, normalizeAwb } from "../utils/awb";
import { escapeHtml } from "../utils/format";

const MAX_LABEL_LENGTH = 64;
const DETAIL_SCANS = 6;

function parseArgs(match: string): { awb: string | null; label: string | null } {
	const [rawAwb, ...rest] = match.trim().split(/\s+/).filter(Boolean);
	const label = rest.join(" ").slice(0, MAX_LABEL_LENGTH);
	return { awb: rawAwb ? normalizeAwb(rawAwb) : null, label: label || null };
}

function formatListItem(s: Shipment): string {
	const title = s.label ? `<b>${escapeHtml(s.label)}</b> · <code>${s.awb}</code>` : `<code>${s.awb}</code>`;
	const status = s.lastStatusText ? escapeHtml(s.lastStatusText) : "<i>waiting for first scan</i>";
	const location = s.lastLocation ? ` (${escapeHtml(s.lastLocation)})` : "";
	const edd = s.expectedDeliveryDate ? `\n   📅 ${escapeHtml(s.expectedDeliveryDate)}` : "";
	return `${title}\n   ${status}${location}${edd}`;
}

type Refresh = "updated" | "not_found" | "unreachable";

/** Fetches the latest status and stores it without sending a notification (the caller replies). */
async function refresh(db: D1Database, provider: TrackingProvider, shipment: Shipment): Promise<Refresh> {
	try {
		const result = await provider.fetchStatus(shipment.awb);
		const applied = await applyTrackingResult(db, shipment, result, { notify: false });
		return applied.found ? "updated" : "not_found";
	} catch (err) {
		console.error(`[bot] couldn't refresh ${shipment.awb}:`, err);
		return "unreachable";
	}
}

async function details(db: D1Database, chatId: number, awb: string): Promise<{ shipment: Shipment; text: string }> {
	const shipment = (await getShipment(db, chatId, awb))!;
	return { shipment, text: formatShipmentDetails(shipment, await getRecentScans(db, shipment.id, DETAIL_SCANS)) };
}

export function registerTracking(bot: Bot, db: D1Database, provider: TrackingProvider): void {
	bot.command("track", async (ctx) => {
		const { awb, label } = parseArgs(ctx.match);
		if (!awb) {
			await ctx.reply("Usage: /track &lt;AWB&gt; [label]\nExample: /track 12345678901 Headphones", {
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
		if (added === "exists") {
			const { text } = await details(db, ctx.chat.id, awb);
			await ctx.reply(`Already tracking this one.\n\n${text}`, { parse_mode: "HTML" });
			return;
		}

		await ctx.replyWithChatAction("typing");
		const outcome = await refresh(db, provider, (await getShipment(db, ctx.chat.id, awb))!);

		if (outcome === "not_found") {
			await ctx.reply(
				`Tracking <code>${awb}</code>. BlueDart has no record of it yet. That's normal for a newly booked shipment; I'll keep checking every hour.`,
				{ parse_mode: "HTML" },
			);
			return;
		}
		if (outcome === "unreachable") {
			await ctx.reply(`Tracking <code>${awb}</code>. I couldn't reach BlueDart just now; I'll keep checking every hour.`, {
				parse_mode: "HTML",
			});
			return;
		}

		const { shipment, text } = await details(db, ctx.chat.id, awb);
		const footer = shipment.isActive
			? "I'll message you whenever there's a new scan or the delivery date changes."
			: "✅ This shipment is already complete, so I'm not tracking it further.";
		await ctx.reply(`🚀 Tracking started\n\n${text}\n\n${footer}`, { parse_mode: "HTML" });
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
			const outcome = await refresh(db, provider, shipment);
			if (outcome === "unreachable") note = "\n\n<i>Couldn't reach BlueDart, so this is the last known status.</i>";
			if (outcome === "not_found") note = "\n\n<i>BlueDart has no record of this AWB yet.</i>";
		} else {
			note = "\n\n<i>Not being tracked any more.</i>";
		}
		const { text } = await details(db, ctx.chat.id, awb);
		await ctx.reply(text + note, { parse_mode: "HTML" });
	});

	bot.command("list", async (ctx) => {
		const shipments = await listActiveShipments(db, ctx.chat.id);
		if (shipments.length === 0) {
			await ctx.reply("You're not tracking anything yet. Try /track &lt;AWB&gt;.", { parse_mode: "HTML" });
			return;
		}
		await ctx.reply(`<b>Tracking ${shipments.length}</b>\n\n${shipments.map(formatListItem).join("\n\n")}`, {
			parse_mode: "HTML",
		});
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
