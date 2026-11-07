import { env } from "cloudflare:test";
import type { Update } from "grammy/types";
import { beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot";

const CHAT = 4242;
let updateId = 1;

function textUpdate(text: string): Update {
	const command = text.startsWith("/") ? text.split(/\s/)[0] : null;
	return {
		update_id: updateId++,
		message: {
			message_id: updateId,
			date: Math.floor(Date.now() / 1000),
			chat: { id: CHAT, type: "private", first_name: "Alice" },
			from: { id: CHAT, is_bot: false, first_name: "Alice", username: "alice" },
			text,
			...(command ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] } : {}),
		},
	};
}

/** Sends one message through the bot and returns the text it replied with. */
async function send(text: string): Promise<string[]> {
	const bot = createBot(env);
	const replies: string[] = [];
	bot.api.config.use(async (_prev, method, payload) => {
		if (method === "sendMessage") replies.push((payload as { text: string }).text);
		return { ok: true, result: true } as never;
	});
	await bot.handleUpdate(textUpdate(text));
	return replies;
}

beforeEach(async () => {
	await env.DB.batch([env.DB.prepare("DELETE FROM shipments"), env.DB.prepare("DELETE FROM users")]);
});

describe("bot commands", () => {
	it("/start greets the user and stores them", async () => {
		const [reply] = await send("/start");
		expect(reply).toContain("Hi Alice!");
		const user = await env.DB.prepare("SELECT username FROM users WHERE chat_id = ?").bind(CHAT).first();
		expect(user).toEqual({ username: "alice" });
	});

	it("/track validates input", async () => {
		expect((await send("/track"))[0]).toContain("Usage");
		expect((await send("/track abc"))[0]).toContain("doesn't look like");
	});

	it("/track → /list → /untrack round trip", async () => {
		expect((await send("/track 123-4567-8901 New <shoes>"))[0]).toContain("Tracking <code>12345678901</code>");
		expect((await send("/track 12345678901"))[0]).toContain("Already tracking");

		const [list] = await send("/list");
		expect(list).toContain("New &lt;shoes&gt;");
		expect(list).toContain("waiting for first check");

		expect((await send("/untrack 12345678901"))[0]).toContain("Stopped tracking");
		expect((await send("/untrack 12345678901"))[0]).toContain("weren't tracking");
		expect((await send("/list"))[0]).toContain("not tracking anything");
	});

	it("replies to unknown messages", async () => {
		expect((await send("hello"))[0]).toContain("/help");
	});
});
