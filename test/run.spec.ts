import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { addShipment, getShipment, listActiveShipments, setCheckInterval } from '../src/db/shipments';
import { upsertUser } from '../src/db/users';
import { getRecentScans } from '../src/db/scans';
import { applyTrackingResult } from '../src/tracker/apply';
import { runTracker } from '../src/tracker/run';
import { delivered, fakeApi, fakeProvider, found, inTransit, outForDelivery, pickedUp, resetDb, type Sent } from './helpers';

const CHAT = 7;
const AWB = '12345678901';

async function shipment() {
	return (await getShipment(env.DB, CHAT, AWB))!;
}

/** Pretends every shipment's next check time has arrived. */
async function makeDue() {
	await env.DB.prepare("UPDATE shipments SET next_check_at = datetime('now', '-1 minute')").run();
}

/** Stores a baseline like /track does (no notification), then makes the shipment due again. */
async function baseline(result = found([pickedUp], '12 Mar 2026')) {
	await applyTrackingResult(env.DB, await shipment(), result, { notify: false });
	await makeDue();
}

beforeEach(async () => {
	await resetDb(env.DB);
	await upsertUser(env.DB, { chatId: CHAT });
	await addShipment(env.DB, CHAT, AWB, 'Shoes');
});

describe('runTracker', () => {
	it('does nothing visible when BlueDart has no record yet', async () => {
		const sent: Sent[] = [];
		const summary = await runTracker({ db: env.DB, api: fakeApi(sent), provider: fakeProvider({}) });

		expect(summary).toMatchObject({ checked: 1, notFound: 1, changed: 0 });
		expect(sent).toHaveLength(0);
		expect((await shipment()).lastCheckedAt).not.toBeNull();
	});

	it('notifies about new scans only, newest first, and stores them', async () => {
		await baseline();
		const sent: Sent[] = [];
		const summary = await runTracker({
			db: env.DB,
			api: fakeApi(sent),
			provider: fakeProvider({ [AWB]: found([outForDelivery, inTransit, pickedUp], '12 Mar 2026') }),
		});

		expect(summary).toMatchObject({ changed: 1, notified: 1 });
		expect(sent).toHaveLength(1);
		const text = sent[0].text;
		expect(text).toContain('<b>Shoes</b>');
		expect(text.indexOf('Out For Delivery')).toBeLessThan(text.indexOf('In Transit'));
		expect(text).not.toContain('Shipment Picked Up');
		expect(text).toContain('Expected delivery: <b>12 Mar 2026</b>');

		expect(await shipment()).toMatchObject({ lastStatusText: 'Out For Delivery', lastLocation: 'Pune', isActive: true });
		expect((await getRecentScans(env.DB, (await shipment()).id, 10)).map((s) => s.details)).toEqual([
			'Out For Delivery',
			'In Transit',
			'Shipment Picked Up',
		]);
	});

	it('stays quiet when nothing changed', async () => {
		await baseline();
		const sent: Sent[] = [];
		const summary = await runTracker({
			db: env.DB,
			api: fakeApi(sent),
			provider: fakeProvider({ [AWB]: found([pickedUp], '12 Mar 2026') }),
		});
		expect(summary).toMatchObject({ checked: 1, changed: 0 });
		expect(sent).toHaveLength(0);
	});

	it('notifies when only the expected delivery date changes', async () => {
		await baseline();
		const sent: Sent[] = [];
		await runTracker({ db: env.DB, api: fakeApi(sent), provider: fakeProvider({ [AWB]: found([pickedUp], '14 Mar 2026') }) });

		expect(sent[0].text).toContain('Expected delivery changed: 12 Mar 2026 → <b>14 Mar 2026</b>');
		expect((await shipment()).expectedDeliveryDate).toBe('14 Mar 2026');
	});

	it('ignores a missing delivery date instead of wiping the stored one', async () => {
		await baseline();
		const sent: Sent[] = [];
		await runTracker({ db: env.DB, api: fakeApi(sent), provider: fakeProvider({ [AWB]: found([pickedUp], null) }) });

		expect(sent).toHaveLength(0);
		expect((await shipment()).expectedDeliveryDate).toBe('12 Mar 2026');
	});

	it('stops tracking once delivered', async () => {
		await baseline();
		const sent: Sent[] = [];
		await runTracker({
			db: env.DB,
			api: fakeApi(sent),
			provider: fakeProvider({ [AWB]: found([delivered, pickedUp], '12 Mar 2026', true) }),
		});

		expect(sent[0].text).toContain('stopped tracking');
		expect(sent[0].text).not.toContain('Expected delivery');
		expect(await listActiveShipments(env.DB, CHAT)).toHaveLength(0);
	});

	it('marks the user blocked on 403 and skips them afterwards', async () => {
		await baseline();
		const provider = fakeProvider({ [AWB]: found([inTransit, pickedUp]) });
		await runTracker({
			db: env.DB,
			api: fakeApi([], () => ({ error_code: 403, description: 'Forbidden: bot was blocked by the user' })),
			provider,
		});

		const user = await env.DB.prepare('SELECT is_blocked FROM users WHERE chat_id = ?').bind(CHAT).first();
		expect(user).toEqual({ is_blocked: 1 });
		await makeDue();
		const next = await runTracker({ db: env.DB, api: fakeApi([]), provider });
		expect(next.checked).toBe(0);
	});

	it('retries a failed notification on the next run, exactly once', async () => {
		await baseline();
		const provider = fakeProvider({ [AWB]: found([inTransit, pickedUp]) });
		const failed = await runTracker({
			db: env.DB,
			api: fakeApi([], () => ({ error_code: 500, description: 'Internal Server Error' })),
			provider,
		});
		expect(failed).toMatchObject({ changed: 1, notified: 0 });

		const sent: Sent[] = [];
		await makeDue();
		const retry = await runTracker({ db: env.DB, api: fakeApi(sent), provider });
		expect(retry).toMatchObject({ retried: 1, changed: 0 });
		expect(sent).toHaveLength(1);
		expect(sent[0].text).toContain('In Transit');

		await makeDue();
		await runTracker({ db: env.DB, api: fakeApi(sent), provider });
		expect(sent).toHaveLength(1);
	});

	it('keeps going when one lookup throws', async () => {
		await addShipment(env.DB, CHAT, '98765432109', null);
		const sent: Sent[] = [];
		const summary = await runTracker({
			db: env.DB,
			api: fakeApi(sent),
			provider: fakeProvider({ [AWB]: new Error('BlueDart down'), '98765432109': found([pickedUp]) }),
		});

		expect(summary).toMatchObject({ checked: 2, failed: 1, notified: 1 });
		expect((await shipment()).lastCheckedAt).not.toBeNull();
	});

	it('checks never-checked and most overdue shipments first', async () => {
		await addShipment(env.DB, CHAT, '98765432109', null);
		await env.DB.prepare("UPDATE shipments SET next_check_at = datetime('now', '-1 minute') WHERE awb = ?").bind(AWB).run();

		const provider = fakeProvider({});
		await runTracker({ db: env.DB, api: fakeApi([]), provider, maxShipments: 1 });
		expect(provider.calls).toEqual(['98765432109']);
	});
});

describe('per-shipment check interval', () => {
	it("defaults to hourly and isn't checked again until due", async () => {
		const provider = fakeProvider({});
		await runTracker({ db: env.DB, api: fakeApi([]), provider });
		await runTracker({ db: env.DB, api: fakeApi([]), provider });
		expect(provider.calls).toEqual([AWB]);

		const row = await env.DB.prepare(
			'SELECT check_interval_minutes, (julianday(next_check_at) - julianday(last_checked_at)) * 1440 AS gap FROM shipments',
		).first<{ check_interval_minutes: number; gap: number }>();
		expect(row?.check_interval_minutes).toBe(60);
		expect(Math.round(row!.gap)).toBe(60);
	});

	it('treats a check due within the next 2 minutes as due now (cron jitter)', async () => {
		await env.DB.prepare("UPDATE shipments SET next_check_at = datetime('now', '+90 seconds')").run();
		const provider = fakeProvider({});
		await runTracker({ db: env.DB, api: fakeApi([]), provider });
		expect(provider.calls).toEqual([AWB]);
	});

	it('reschedules from the last check when the interval changes', async () => {
		const { id } = await shipment();
		await env.DB.prepare(
			"UPDATE shipments SET last_checked_at = datetime('now', '-20 minutes'), next_check_at = datetime('now', '+1 day')",
		).run();

		await setCheckInterval(env.DB, CHAT, id, 15);
		const provider = fakeProvider({});
		await runTracker({ db: env.DB, api: fakeApi([]), provider });
		expect(provider.calls).toEqual([AWB]);
		expect((await shipment()).checkIntervalMinutes).toBe(15);
	});
});
