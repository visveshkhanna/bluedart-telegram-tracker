import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addShipment, getShipment, upsertUser } from "../src/db/shipments";
import worker from "../src/index";
import { trackingPage } from "./fixtures/bluedart";
import { resetDb } from "./helpers";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("scheduled handler", () => {
	it("runs the tracker against BlueDart and stores what it finds", async () => {
		await resetDb(env.DB);
		await upsertUser(env.DB, { chatId: 9 });
		await addShipment(env.DB, 9, "55555555555", null);

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url.includes("bluedart.com")) return new Response(trackingPage({ awb: "55555555555" }));
			// Telegram sendMessage
			return Response.json({ ok: true, result: { message_id: 1 } });
		});

		const ctx = createExecutionContext();
		await worker.scheduled(createScheduledController({ cron: "0 * * * *" }), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("trackNo=55555555555"))).toBe(true);
		expect(await getShipment(env.DB, 9, "55555555555")).toMatchObject({
			lastStatusText: "Shipment Picked Up",
			expectedDeliveryDate: "12 Mar 2026",
		});
	});
});
