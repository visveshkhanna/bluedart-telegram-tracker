import { Api } from "grammy";
import type { Scan, TrackingProvider, TrackingResult } from "../src/tracker/provider";

export type Sent = { chatId: number; text: string };

/** An Api whose sendMessage is intercepted; `fail` can return a Telegram error per call. */
export function fakeApi(
	sent: Sent[],
	fail?: () => { error_code: number; description: string; parameters?: { retry_after?: number } } | undefined,
): Api {
	const api = new Api("123456:TEST-TOKEN");
	api.config.use(async (_prev, method, payload) => {
		if (method !== "sendMessage") return { ok: true, result: true } as never;
		const error = fail?.();
		if (error) return { ok: false, ...error } as never;
		const p = payload as { chat_id: number; text: string };
		sent.push({ chatId: p.chat_id, text: p.text });
		return { ok: true, result: { message_id: 1 } } as never;
	});
	return api;
}

/** A provider answering from a mutable map; an Error value makes fetchStatus throw. */
export function fakeProvider(results: Record<string, TrackingResult | Error>): TrackingProvider & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async fetchStatus(awb) {
			calls.push(awb);
			const r = results[awb];
			if (r instanceof Error) throw r;
			return r ?? { found: false };
		},
	};
}

export function found(scans: Scan[], expectedDeliveryDate: string | null = null, isTerminal = false): TrackingResult {
	return { found: true, scans, expectedDeliveryDate, isTerminal };
}

export const pickedUp: Scan = { location: "Bengaluru", details: "Shipment Picked Up", date: "07 Mar 2026", time: "10:15" };
export const inTransit: Scan = { location: "Mumbai Hub", details: "In Transit", date: "08 Mar 2026", time: "22:40" };
export const outForDelivery: Scan = { location: "Pune", details: "Out For Delivery", date: "09 Mar 2026", time: "08:02" };
export const delivered: Scan = { location: "Pune", details: "SHIPMENT DELIVERED", date: "09 Mar 2026", time: "13:30" };

export async function resetDb(db: D1Database): Promise<void> {
	await db.batch([db.prepare("DELETE FROM scans"), db.prepare("DELETE FROM shipments"), db.prepare("DELETE FROM users")]);
}
