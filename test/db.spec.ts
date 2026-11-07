import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addShipment,
	deactivateShipment,
	listActiveShipments,
	upsertUser,
} from "../src/db/shipments";

const CHAT = 1001;

beforeEach(async () => {
	await env.DB.batch([env.DB.prepare("DELETE FROM scans"), env.DB.prepare("DELETE FROM shipments"), env.DB.prepare("DELETE FROM users")]);
	await upsertUser(env.DB, { chatId: CHAT, username: "alice", firstName: "Alice" });
});

describe("upsertUser", () => {
	it("updates profile fields and clears is_blocked on conflict", async () => {
		await env.DB.prepare("UPDATE users SET is_blocked = 1 WHERE chat_id = ?").bind(CHAT).run();
		await upsertUser(env.DB, { chatId: CHAT, username: "alice2", firstName: "Al" });

		const row = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(CHAT).first();
		expect(row).toMatchObject({ username: "alice2", first_name: "Al", is_blocked: 0 });
	});
});

describe("shipments", () => {
	it("adds, detects duplicates, and keeps the old label when none is given", async () => {
		expect(await addShipment(env.DB, CHAT, "12345678901", "Headphones")).toBe("added");
		expect(await addShipment(env.DB, CHAT, "12345678901", null)).toBe("exists");

		const [shipment] = await listActiveShipments(env.DB, CHAT);
		expect(shipment).toMatchObject({ awb: "12345678901", label: "Headphones", isActive: true });
	});

	it("deactivates and then reactivates", async () => {
		await addShipment(env.DB, CHAT, "12345678901", null);

		expect(await deactivateShipment(env.DB, CHAT, "12345678901")).toBe(true);
		expect(await deactivateShipment(env.DB, CHAT, "12345678901")).toBe(false);
		expect(await listActiveShipments(env.DB, CHAT)).toHaveLength(0);

		expect(await addShipment(env.DB, CHAT, "12345678901", "Again")).toBe("reactivated");
		expect(await listActiveShipments(env.DB, CHAT)).toHaveLength(1);
	});

	it("only lists the chat's own active shipments", async () => {
		await upsertUser(env.DB, { chatId: 2002 });
		await addShipment(env.DB, CHAT, "11111111111", null);
		await addShipment(env.DB, 2002, "22222222222", null);

		const awbs = (await listActiveShipments(env.DB, CHAT)).map((s) => s.awb);
		expect(awbs).toEqual(["11111111111"]);
	});
});
