import type { Bot } from "grammy";
import { addShipment, deactivateShipment, listActiveShipments, type Shipment } from "../db/shipments";
import { isValidAwb, normalizeAwb } from "../utils/awb";
import { escapeHtml } from "../utils/format";

const MAX_LABEL_LENGTH = 64;

function parseArgs(match: string): { awb: string | null; label: string | null } {
	const [rawAwb, ...rest] = match.trim().split(/\s+/).filter(Boolean);
	const label = rest.join(" ").slice(0, MAX_LABEL_LENGTH);
	return { awb: rawAwb ? normalizeAwb(rawAwb) : null, label: label || null };
}

function formatShipment(s: Shipment): string {
	const title = s.label ? `<b>${escapeHtml(s.label)}</b> · <code>${s.awb}</code>` : `<code>${s.awb}</code>`;
	const status = s.lastStatusText ? escapeHtml(s.lastStatusText) : "<i>waiting for first check</i>";
	const location = s.lastLocation ? ` (${escapeHtml(s.lastLocation)})` : "";
	return `${title}\n   ${status}${location}`;
}

export function registerTracking(bot: Bot, db: D1Database): void {
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

		const result = await addShipment(db, ctx.chat.id, awb, label);
		const messages = {
			added: `Tracking <code>${awb}</code>. I'll message you when its status changes.`,
			reactivated: `Tracking <code>${awb}</code> again.`,
			exists: `Already tracking <code>${awb}</code>.`,
		};
		await ctx.reply(messages[result], { parse_mode: "HTML" });
	});

	bot.command("list", async (ctx) => {
		const shipments = await listActiveShipments(db, ctx.chat.id);
		if (shipments.length === 0) {
			await ctx.reply("You're not tracking anything yet. Try /track &lt;AWB&gt;.", { parse_mode: "HTML" });
			return;
		}
		await ctx.reply(`<b>Tracking ${shipments.length}</b>\n\n${shipments.map(formatShipment).join("\n\n")}`, {
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
