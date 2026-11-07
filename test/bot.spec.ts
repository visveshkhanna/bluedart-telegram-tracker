import { env } from "cloudflare:test";
import type { Update } from "grammy/types";
import { beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot";
import type { TrackingProvider } from "../src/tracker/provider";
import { delivered, fakeProvider, found, inTransit, pickedUp, resetDb } from "./helpers";

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
async function send(text: string, provider: TrackingProvider = fakeProvider({})): Promise<string[]> {
	const bot = createBot(env, provider);
	const replies: string[] = [];
	bot.api.config.use(async (_prev, method, payload) => {
		if (method === "sendMessage") replies.push((payload as { text: string }).text);
		if (method === "sendChatAction") return { ok: true, result: true } as never;
		return { ok: true, result: true } as never;
	});
	await bot.handleUpdate(textUpdate(text));
	return replies;
}

beforeEach(async () => {
	await resetDb(env.DB);
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

	it("/track → /list → /untrack round trip (AWB not in BlueDart yet)", async () => {
		expect((await send("/track 123-4567-8901 New <shoes>"))[0]).toContain("no record of it yet");
		expect((await send("/track 12345678901"))[0]).toContain("Already tracking");

		const [list] = await send("/list");
		expect(list).toContain("New &lt;shoes&gt;");
		expect(list).toContain("waiting for first scan");

		expect((await send("/untrack 12345678901"))[0]).toContain("Stopped tracking");
		expect((await send("/untrack 12345678901"))[0]).toContain("weren't tracking");
		expect((await send("/list"))[0]).toContain("not tracking anything");
	});

	it("/track shows the current status and expected delivery date right away", async () => {
		const provider = fakeProvider({ "12345678901": found([inTransit, pickedUp], "12 Mar 2026") });
		const [reply] = await send("/track 12345678901 Shoes", provider);

		expect(reply).toContain("Tracking started");
		expect(reply).toContain("<b>In Transit</b>");
		expect(reply).toContain("Expected delivery: <b>12 Mar 2026</b>");
		expect(reply).toContain("Shipment Picked Up");

		const [list] = await send("/list");
		expect(list).toContain("In Transit (Mumbai Hub)");
		expect(list).toContain("12 Mar 2026");
	});

	it("/track says so when BlueDart is unreachable", async () => {
		const provider = fakeProvider({ "12345678901": new Error("timeout") });
		expect((await send("/track 12345678901", provider))[0]).toContain("couldn't reach BlueDart");
	});

	it("/track on an already delivered shipment doesn't keep tracking it", async () => {
		const provider = fakeProvider({ "12345678901": found([delivered, pickedUp], null, true) });
		expect((await send("/track 12345678901", provider))[0]).toContain("already complete");
		expect((await send("/list"))[0]).toContain("not tracking anything");
	});

	it("/status refreshes live and shows recent scans", async () => {
		await send("/track 12345678901", fakeProvider({ "12345678901": found([pickedUp], "12 Mar 2026") }));
		const [reply] = await send("/status 12345678901", fakeProvider({ "12345678901": found([inTransit, pickedUp], "13 Mar 2026") }));

		expect(reply).toContain("<b>In Transit</b>");
		expect(reply).toContain("13 Mar 2026");
		expect(reply).toContain("Earlier scans");
		expect((await send("/status 99999999999"))[0]).toContain("not tracking");
	});

	it("replies to unknown messages", async () => {
		expect((await send("hello"))[0]).toContain("/help");
	});
});
