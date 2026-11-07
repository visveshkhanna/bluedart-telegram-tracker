import type { Bot } from "grammy";
import { escapeHtml } from "../utils/format";

export const HELP_TEXT = [
	"<b>Commands</b>",
	"/track &lt;AWB&gt; [label] – start tracking a BlueDart shipment",
	"/status &lt;AWB&gt; – latest scans and expected delivery date",
	"/list – show your tracked shipments",
	"/untrack &lt;AWB&gt; – stop tracking a shipment",
	"/help – show this message",
].join("\n");

export function registerStart(bot: Bot): void {
	bot.command("start", async (ctx) => {
		const name = escapeHtml(ctx.from?.first_name ?? "there");
		await ctx.reply(
			`Hi ${name}! I track BlueDart shipments and message you when their status changes.\n\n${HELP_TEXT}`,
			{ parse_mode: "HTML" },
		);
	});

	bot.command("help", async (ctx) => {
		await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
	});
}
