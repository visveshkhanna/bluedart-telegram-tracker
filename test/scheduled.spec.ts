import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addShipment, upsertUser } from "../src/db/shipments";
import worker from "../src/index";

describe("scheduled handler", () => {
	it("runs the tracker with the stub provider", async () => {
		await upsertUser(env.DB, { chatId: 9 });
		await addShipment(env.DB, 9, "55555555555", null);

		const ctx = createExecutionContext();
		await worker.scheduled(createScheduledController({ cron: "0 * * * *" }), env, ctx);
		await waitOnExecutionContext(ctx);

		const row = await env.DB.prepare("SELECT last_checked_at FROM shipments WHERE awb = ?").bind("55555555555").first();
		expect(row?.last_checked_at).not.toBeNull();
	});
});
