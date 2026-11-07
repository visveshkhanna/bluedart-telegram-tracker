import { env } from "cloudflare:test";
import type { InlineKeyboardMarkup, Update } from "grammy/types";
import { beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot";
import { addShipment, getShipment, upsertUser } from "../src/db/shipments";
import { fakeProvider, found, inTransit, pickedUp, resetDb } from "./helpers";

const CHAT = 5150;
const BOT_ID = 123456; // matches BOT_INFO in vitest.config.mts
const AWB = "12345678901";
let updateId = 1000;

type Call = { method: string; payload: Record<string, unknown> };

const from = { id: CHAT, is_bot: false, first_name: "Alice" };
const chat = { id: CHAT, type: "private" as const, first_name: "Alice" };

async function dispatch(update: Update, provider = fakeProvider({ [AWB]: found([inTransit, pickedUp], "12 Mar 2026") })) {
	const bot = createBot(env, provider);
	const calls: Call[] = [];
	bot.api.config.use(async (_prev, method, payload) => {
		calls.push({ method, payload: payload as Record<string, unknown> });
		return { ok: true, result: method === "sendMessage" ? { message_id: 1, date: 0, chat } : true } as never;
	});
	await bot.handleUpdate(update);
	return calls;
}

function click(data: string, chatId = CHAT): Update {
	return {
		update_id: updateId++,
		callback_query: {
			id: String(updateId),
			from: { ...from, id: chatId },
			chat_instance: "x",
			data,
			message: { message_id: 99, date: 0, chat: { ...chat, id: chatId }, text: "old" },
		},
	};
}

function message(text: string, replyTo?: string): Update {
	const command = text.startsWith("/") ? text.split(/\s/)[0] : null;
	return {
		update_id: updateId++,
		message: {
			message_id: updateId,
			date: 0,
			chat,
			from,
			text,
			...(command ? { entities: [{ type: "bot_command" as const, offset: 0, length: command.length }] } : {}),
			...(replyTo
				? {
						reply_to_message: {
							message_id: 1,
							date: 0,
							chat,
							from: { id: BOT_ID, is_bot: true, first_name: "Test Bot" },
							text: replyTo,
						},
					}
				: {}),
		},
	} as Update;
}

const buttons = (call: Call) =>
	((call.payload.reply_markup as InlineKeyboardMarkup | undefined)?.inline_keyboard ?? []).flat();
const byMethod = (calls: Call[], method: string) => calls.filter((c) => c.method === method);

let id: number;

beforeEach(async () => {
	await resetDb(env.DB);
	await upsertUser(env.DB, { chatId: CHAT });
	await addShipment(env.DB, CHAT, AWB, "Black backpack");
	id = (await getShipment(env.DB, CHAT, AWB))!.id;
});

describe("/list and shipment cards", () => {
	it("/list shows one button per shipment that opens its card", async () => {
		const [reply] = byMethod(await dispatch(message("/list")), "sendMessage");
		expect(buttons(reply)).toEqual([expect.objectContaining({ text: "📦 Black backpack", callback_data: `s:${id}` })]);

		const calls = await dispatch(click(`s:${id}`));
		const [edited] = byMethod(calls, "editMessageText");
		expect(edited.payload.text).toContain("Checking every 1 hour");
		expect(buttons(edited).map((b) => b.text)).toEqual([
			"🔄 Refresh",
			"⏱ Every 1 hour",
			"✏️ Rename",
			"🛑 Stop tracking",
			"« All shipments",
		]);
		expect(byMethod(calls, "answerCallbackQuery")).toHaveLength(1);
	});

	it("Refresh pulls the latest status into the card", async () => {
		const calls = await dispatch(click(`r:${id}`));
		expect(byMethod(calls, "editMessageText")[0].payload.text).toContain("<b>In Transit</b>");
		expect(byMethod(calls, "answerCallbackQuery")[0].payload.text).toContain("Updated");
	});

	it("doesn't let another chat open someone else's shipment", async () => {
		await upsertUser(env.DB, { chatId: 666 });
		const calls = await dispatch(click(`s:${id}`, 666));
		expect(byMethod(calls, "editMessageText")).toHaveLength(0);
		expect(byMethod(calls, "answerCallbackQuery")[0].payload.text).toContain("isn't available");
	});
});

describe("check interval", () => {
	it("picker marks the current interval and changing it updates the shipment", async () => {
		const [picker] = byMethod(await dispatch(click(`i:${id}`)), "editMessageText");
		expect(buttons(picker).find((b) => b.text.startsWith("✓"))?.text).toBe("✓ 1 hour");

		const calls = await dispatch(click(`i:${id}:15`));
		expect((await getShipment(env.DB, CHAT, AWB))?.checkIntervalMinutes).toBe(15);
		expect(byMethod(calls, "editMessageText")[0].payload.text).toContain("Checking every 15 min");
		expect(byMethod(calls, "answerCallbackQuery")[0].payload.text).toBe("Checking every 15 min");
	});

	it("rejects intervals that aren't offered", async () => {
		const calls = await dispatch(click(`i:${id}:1`));
		expect((await getShipment(env.DB, CHAT, AWB))?.checkIntervalMinutes).toBe(60);
		expect(byMethod(calls, "answerCallbackQuery")[0].payload.text).toContain("isn't available");
	});
});

describe("rename", () => {
	it("Rename button asks for a reply, and the reply renames the shipment", async () => {
		const [prompt] = byMethod(await dispatch(click(`n:${id}`)), "sendMessage");
		expect(prompt.payload.reply_markup).toMatchObject({ force_reply: true });

		// Telegram delivers the prompt back to us as plain text (no HTML tags).
		const promptText = `✏️ Send the new name for ${AWB} (currently: Black backpack).`;
		const [reply] = byMethod(await dispatch(message("  Blue   duffel bag ", promptText)), "sendMessage");
		expect(reply.payload.text).toContain("Renamed.");
		expect((await getShipment(env.DB, CHAT, AWB))?.label).toBe("Blue duffel bag");
	});

	it("/rename works too, and '-' removes the name", async () => {
		await dispatch(message(`/rename ${AWB} Gym shoes`));
		expect((await getShipment(env.DB, CHAT, AWB))?.label).toBe("Gym shoes");

		const [reply] = byMethod(await dispatch(message(`/rename ${AWB} -`)), "sendMessage");
		expect(reply.payload.text).toContain("Name removed.");
		expect((await getShipment(env.DB, CHAT, AWB))?.label).toBeNull();
	});

	it("ordinary replies to other bot messages still hit the fallback", async () => {
		const [reply] = byMethod(await dispatch(message("hello", "Some other bot message")), "sendMessage");
		expect(reply.payload.text).toContain("/help");
	});
});

describe("stop tracking", () => {
	it("asks for confirmation, then stops and shows the list", async () => {
		const [confirm] = byMethod(await dispatch(click(`x:${id}`)), "editMessageText");
		expect(buttons(confirm).map((b) => b.text)).toEqual(["Yes, stop", "Cancel"]);
		expect((await getShipment(env.DB, CHAT, AWB))?.isActive).toBe(true);

		const calls = await dispatch(click(`xy:${id}`));
		expect((await getShipment(env.DB, CHAT, AWB))?.isActive).toBe(false);
		expect(byMethod(calls, "editMessageText")[0].payload.text).toContain("not tracking anything");
		expect(byMethod(calls, "answerCallbackQuery")[0].payload.text).toContain("Stopped tracking Black backpack");
	});
});
