import type { Shipment } from "../db/shipments";
import { escapeHtml } from "../utils/format";
import type { Scan } from "./provider";

const MAX_LISTED_SCANS = 5;

function title(awb: string, label: string | null): string {
	return label ? `<b>${escapeHtml(label)}</b> · <code>${awb}</code>` : `<code>${awb}</code>`;
}

function scanBlock(scan: Scan): string {
	return `<b>${escapeHtml(scan.details)}</b>\n📍 ${escapeHtml(scan.location)} · 🕒 ${escapeHtml(`${scan.date} ${scan.time}`)}`;
}

function scanBullet(scan: Scan): string {
	return `• ${escapeHtml(scan.details)}: ${escapeHtml(scan.location)}, ${escapeHtml(`${scan.date} ${scan.time}`)}`;
}

export interface UpdateMessageInput {
	awb: string;
	label: string | null;
	/** Newest first. */
	newScans: Scan[];
	expectedDeliveryDate: string | null;
	previousExpectedDeliveryDate: string | null;
	isTerminal: boolean;
}

/** Cron notification for new scans and/or a changed expected delivery date. */
export function formatUpdateMessage(input: UpdateMessageInput): string {
	const lines = [`📦 Shipment update · ${title(input.awb, input.label)}`, ""];

	const [latest, ...earlier] = input.newScans;
	if (latest) {
		lines.push(scanBlock(latest));
		if (earlier.length > 0) {
			lines.push("", "Also since the last check:");
			lines.push(...earlier.slice(0, MAX_LISTED_SCANS - 1).map(scanBullet));
			const hidden = earlier.length - (MAX_LISTED_SCANS - 1);
			if (hidden > 0) lines.push(`…and ${hidden} more`);
		}
	}

	const edd = input.expectedDeliveryDate;
	const previous = input.previousExpectedDeliveryDate;
	if (!input.isTerminal && edd) {
		if (latest) lines.push("");
		lines.push(
			previous && previous !== edd
				? `📅 Expected delivery changed: ${escapeHtml(previous)} → <b>${escapeHtml(edd)}</b>`
				: `📅 Expected delivery: <b>${escapeHtml(edd)}</b>`,
		);
	}

	if (input.isTerminal) {
		lines.push("", "✅ This shipment is complete, so I've stopped tracking it.");
	}
	return lines.join("\n");
}

/** Full picture of one shipment, for /track and /status replies. */
export function formatShipmentDetails(shipment: Shipment, recentScans: Scan[]): string {
	const lines = [`📦 ${title(shipment.awb, shipment.label)}`, ""];

	const [latest, ...earlier] = recentScans;
	if (latest) {
		lines.push(scanBlock(latest));
	} else {
		lines.push("<i>No scans from BlueDart yet.</i>");
	}

	if (shipment.expectedDeliveryDate && shipment.isActive) {
		lines.push("", `📅 Expected delivery: <b>${escapeHtml(shipment.expectedDeliveryDate)}</b>`);
	}

	if (earlier.length > 0) {
		lines.push("", "<b>Earlier scans</b>", ...earlier.map(scanBullet));
	}
	return lines.join("\n");
}
