// Shared message + inline keyboard rendering for shipment cards and the /list view.
import { InlineKeyboard } from "grammy";
import type { Shipment } from "../db/shipments";
import { getRecentScans } from "../db/tracking";
import { applyTrackingResult } from "../tracker/apply";
import { CHECK_INTERVALS, formatInterval } from "../tracker/intervals";
import { formatShipmentDetails } from "../tracker/messages";
import type { TrackingProvider } from "../tracker/provider";
import { escapeHtml } from "../utils/format";

const DETAIL_SCANS = 6;
const DISPLAY_TIME_ZONE = "Asia/Kolkata";
const MAX_BUTTON_TEXT = 40;

/** Callback data. Kept short: Telegram allows at most 64 bytes. */
export const cb = {
	list: "l",
	show: (id: number) => `s:${id}`,
	refresh: (id: number) => `r:${id}`,
	intervals: (id: number) => `i:${id}`,
	setInterval: (id: number, minutes: number) => `i:${id}:${minutes}`,
	rename: (id: number) => `n:${id}`,
	stop: (id: number) => `x:${id}`,
	stopConfirm: (id: number) => `xy:${id}`,
};

/** D1 stores UTC as "YYYY-MM-DD HH:MM:SS"; show it in IST. */
export function formatTimestamp(utc: string): string {
	return new Date(`${utc.replace(" ", "T")}Z`).toLocaleString("en-IN", {
		timeZone: DISPLAY_TIME_ZONE,
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
	});
}

export function shipmentName(s: Shipment): string {
	return s.label ?? s.awb;
}

export type RefreshOutcome = "updated" | "unchanged" | "not_found" | "unreachable";

/** Fetches the latest status and stores it without notifying (the caller shows it instead). */
export async function refreshShipment(db: D1Database, provider: TrackingProvider, shipment: Shipment): Promise<RefreshOutcome> {
	try {
		const result = await provider.fetchStatus(shipment.awb);
		const applied = await applyTrackingResult(db, shipment, result, { notify: false });
		if (!applied.found) return "not_found";
		return applied.changed ? "updated" : "unchanged";
	} catch (err) {
		console.error(`[bot] couldn't refresh ${shipment.awb}:`, err);
		return "unreachable";
	}
}

export async function renderCard(db: D1Database, shipment: Shipment): Promise<{ text: string; keyboard: InlineKeyboard }> {
	const scans = await getRecentScans(db, shipment.id, DETAIL_SCANS);
	const lines = [formatShipmentDetails(shipment, scans), ""];

	const keyboard = new InlineKeyboard();
	if (shipment.isActive) {
		const checked = shipment.lastCheckedAt ? ` · last checked ${formatTimestamp(shipment.lastCheckedAt)}` : "";
		lines.push(`⏱ Checking every ${formatInterval(shipment.checkIntervalMinutes)}${checked}`);
		keyboard
			.text("🔄 Refresh", cb.refresh(shipment.id))
			.text(`⏱ Every ${formatInterval(shipment.checkIntervalMinutes)}`, cb.intervals(shipment.id))
			.row()
			.text("✏️ Rename", cb.rename(shipment.id))
			.text("🛑 Stop tracking", cb.stop(shipment.id))
			.row();
	} else {
		lines.push("<i>Not being tracked any more.</i>");
	}
	keyboard.text("« All shipments", cb.list);

	return { text: lines.join("\n"), keyboard };
}

export function renderList(shipments: Shipment[]): { text: string; keyboard?: InlineKeyboard } {
	if (shipments.length === 0) {
		return { text: "You're not tracking anything yet. Try /track &lt;AWB&gt; [name]." };
	}
	const keyboard = new InlineKeyboard();
	for (const s of shipments) {
		const status = s.lastStatusText ? ` · ${s.lastStatusText}` : "";
		const text = `📦 ${shipmentName(s)}${status}`;
		keyboard.text(text.length > MAX_BUTTON_TEXT ? `${text.slice(0, MAX_BUTTON_TEXT - 1)}…` : text, cb.show(s.id)).row();
	}
	const lines = shipments.map((s) => {
		const name = s.label ? `<b>${escapeHtml(s.label)}</b> · <code>${s.awb}</code>` : `<code>${s.awb}</code>`;
		const status = s.lastStatusText ? escapeHtml(s.lastStatusText) : "<i>waiting for first scan</i>";
		const location = s.lastLocation ? ` (${escapeHtml(s.lastLocation)})` : "";
		const edd = s.expectedDeliveryDate ? `\n   📅 ${escapeHtml(s.expectedDeliveryDate)}` : "";
		return `${name}\n   ${status}${location}${edd}`;
	});
	return {
		text: `<b>Tracking ${shipments.length}</b> · tap one to manage it\n\n${lines.join("\n\n")}`,
		keyboard,
	};
}

export function renderIntervalPicker(shipment: Shipment): { text: string; keyboard: InlineKeyboard } {
	const keyboard = new InlineKeyboard();
	CHECK_INTERVALS.forEach((minutes, i) => {
		const current = minutes === shipment.checkIntervalMinutes ? "✓ " : "";
		keyboard.text(`${current}${formatInterval(minutes)}`, cb.setInterval(shipment.id, minutes));
		if (i % 4 === 3) keyboard.row();
	});
	keyboard.row().text("« Back", cb.show(shipment.id));
	return {
		text: `⏱ How often should I check <b>${escapeHtml(shipmentName(shipment))}</b>?\n\nShorter intervals mean faster alerts, but BlueDart usually only updates a few times a day.`,
		keyboard,
	};
}

export function renderStopConfirm(shipment: Shipment): { text: string; keyboard: InlineKeyboard } {
	return {
		text: `Stop tracking <b>${escapeHtml(shipmentName(shipment))}</b> (<code>${shipment.awb}</code>)?`,
		keyboard: new InlineKeyboard().text("Yes, stop", cb.stopConfirm(shipment.id)).text("Cancel", cb.show(shipment.id)),
	};
}
