import { env } from "cloudflare:test";
import { Api, GrammyError } from "grammy";
import { beforeEach, describe, expect, it } from "vitest";
import { addShipment, listActiveShipments, upsertUser } from "../src/db/shipments";
import type { TrackingProvider, TrackingResult } from "../src/tracker/provider";
import { runTracker } from "../src/tracker/run";

const CHAT = 7;
const AWB = "12345678901";

type Sent = { chatId: number; text: string };

/** An Api whose sendMessage is intercepted; `fail` decides per call whether to throw. */
function fakeApi(sent: Sent[], fail?: () => GrammyError | undefined): Api {
	const api = new Api("123456:TEST-TOKEN");
	api.config.use(async (_prev, method, payload) => {
		if (method !== "sendMessage") return { ok: true, result: true } as never;
		const error = fail?.();
		if (error) return { ok: false, error_code: error.error_code, description: error.description, parameters: error.parameters } as never;
		const p = payload as { chat_id: number; text: string };
		sent.push({ chatId: p.chat_id, text: p.text });
		return { ok: true, result: { message_id: 1 } } as never;
	});
	return api;
}

function provider(results: Record<string, TrackingResult | null | Error>): TrackingProvider {
	return {
		async fetchStatus(awb) {
			const r = results[awb];
			if (r instanceof Error) throw r;
			return r ?? null;
		},
	};
}

const inTransit: TrackingResult = { status: "IN_TRANSIT", statusText: "In Transit", location: "Mumbai Hub", isTerminal: false };
const delivered: TrackingResult = { status: "DELIVERED", statusText: "Delivered", location: "Bengaluru", isTerminal: true };

async function shipment() {
	return env.DB.prepare("SELECT * FROM shipments WHERE awb = ?").bind(AWB).first<Record<string, unknown>>();
}

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM status_events"),
		env.DB.prepare("DELETE FROM shipments"),
		env.DB.prepare("DELETE FROM users"),
	]);
	await upsertUser(env.DB, { chatId: CHAT });
	await addShipment(env.DB, CHAT, AWB, "Shoes");
});

describe("runTracker", () => {
	it("with no status (stub provider): only updates last_checked_at", async () => {
		const sent: Sent[] = [];
		const summary = await runTracker({ db: env.DB, api: fakeApi(sent), provider: provider({}) });

		expect(summary).toMatchObject({ checked: 1, noStatus: 1, changed: 0 });
		expect(sent).toHaveLength(0);
		expect((await shipment())?.last_checked_at).not.toBeNull();
	});

	it("notifies on change, stays quiet when unchanged", async () => {
		const sent: Sent[] = [];
		const api = fakeApi(sent);

		const first = await runTracker({ db: env.DB, api, provider: provider({ [AWB]: inTransit }) });
		expect(first).toMatchObject({ changed: 1, notified: 1 });
		expect(sent[0].chatId).toBe(CHAT);
		expect(sent[0].text).toContain("<b>Shoes</b>");
		expect(sent[0].text).toContain("In Transit");
		expect(await shipment()).toMatchObject({ last_status: "IN_TRANSIT", last_location: "Mumbai Hub", is_active: 1 });

		const second = await runTracker({ db: env.DB, api, provider: provider({ [AWB]: inTransit }) });
		expect(second).toMatchObject({ checked: 1, changed: 0 });
		expect(sent).toHaveLength(1);
	});

	it("stops tracking on a terminal status", async () => {
		const sent: Sent[] = [];
		await runTracker({ db: env.DB, api: fakeApi(sent), provider: provider({ [AWB]: delivered }) });

		expect(sent[0].text).toContain("stopped tracking");
		expect(await listActiveShipments(env.DB, CHAT)).toHaveLength(0);
	});

	it("marks the user blocked on 403 and skips them afterwards", async () => {
		const blocked = new GrammyError("blocked", { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, "sendMessage", {});
		await runTracker({ db: env.DB, api: fakeApi([], () => blocked), provider: provider({ [AWB]: inTransit }) });

		const user = await env.DB.prepare("SELECT is_blocked FROM users WHERE chat_id = ?").bind(CHAT).first();
		expect(user).toEqual({ is_blocked: 1 });
		const next = await runTracker({ db: env.DB, api: fakeApi([]), provider: provider({ [AWB]: delivered }) });
		expect(next.checked).toBe(0);
	});

	it("retries a failed notification on the next run", async () => {
		const serverError = new GrammyError("oops", { ok: false, error_code: 500, description: "Internal Server Error" }, "sendMessage", {});
		const failed = await runTracker({ db: env.DB, api: fakeApi([], () => serverError), provider: provider({ [AWB]: inTransit }) });
		expect(failed).toMatchObject({ changed: 1, notified: 0 });

		const sent: Sent[] = [];
		const retry = await runTracker({ db: env.DB, api: fakeApi(sent), provider: provider({ [AWB]: inTransit }) });
		expect(retry).toMatchObject({ retried: 1, changed: 0 });
		expect(sent).toHaveLength(1);
		const event = await env.DB.prepare("SELECT notified FROM status_events").first();
		expect(event).toEqual({ notified: 1 });
	});

	it("keeps going when one shipment's lookup throws", async () => {
		await addShipment(env.DB, CHAT, "98765432109", null);
		const sent: Sent[] = [];
		const summary = await runTracker({
			db: env.DB,
			api: fakeApi(sent),
			provider: provider({ [AWB]: new Error("boom"), "98765432109": inTransit }),
		});

		expect(summary).toMatchObject({ checked: 2, failed: 1, notified: 1 });
		expect((await shipment())?.last_checked_at).not.toBeNull();
	});

	it("checks never-checked and least-recently-checked shipments first", async () => {
		await addShipment(env.DB, CHAT, "98765432109", null);
		await env.DB.prepare("UPDATE shipments SET last_checked_at = datetime('now') WHERE awb = ?").bind(AWB).run();

		const seen: string[] = [];
		await runTracker({
			db: env.DB,
			api: fakeApi([]),
			maxShipments: 1,
			provider: { fetchStatus: async (awb) => (seen.push(awb), null) },
		});
		expect(seen).toEqual(["98765432109"]);
	});
});
