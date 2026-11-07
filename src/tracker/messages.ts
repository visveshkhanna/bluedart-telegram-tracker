import { UI } from '../config';
import type { Shipment } from '../db/shipments';
import { escapeHtml } from '../lib/html';
import type { Scan } from './types';

export function shipmentTitle(awb: string, label: string | null): string {
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

/** The notification sent for new scans and/or a changed expected delivery date. */
export function formatUpdateMessage(input: UpdateMessageInput): string {
	const lines = [`📦 Shipment update · ${shipmentTitle(input.awb, input.label)}`, ''];

	const [latest, ...earlier] = input.newScans;
	if (latest) {
		lines.push(scanBlock(latest));
		if (earlier.length > 0) {
			const shown = UI.notificationScans - 1;
			lines.push('', 'Also since the last check:', ...earlier.slice(0, shown).map(scanBullet));
			if (earlier.length > shown) lines.push(`…and ${earlier.length - shown} more`);
		}
	}

	const { expectedDeliveryDate: edd, previousExpectedDeliveryDate: previous } = input;
	if (!input.isTerminal && edd) {
		if (latest) lines.push('');
		lines.push(
			previous && previous !== edd
				? `📅 Expected delivery changed: ${escapeHtml(previous)} → <b>${escapeHtml(edd)}</b>`
				: `📅 Expected delivery: <b>${escapeHtml(edd)}</b>`,
		);
	}

	if (input.isTerminal) lines.push('', "✅ This shipment is complete, so I've stopped tracking it.");
	return lines.join('\n');
}

/** Latest scan, expected delivery date and earlier scans, for shipment cards. */
export function formatShipmentDetails(shipment: Shipment, recentScans: Scan[]): string {
	const lines = [`📦 ${shipmentTitle(shipment.awb, shipment.label)}`, ''];
	const [latest, ...earlier] = recentScans;
	lines.push(latest ? scanBlock(latest) : '<i>No scans from BlueDart yet.</i>');
	if (shipment.expectedDeliveryDate && shipment.isActive) {
		lines.push('', `📅 Expected delivery: <b>${escapeHtml(shipment.expectedDeliveryDate)}</b>`);
	}
	if (earlier.length > 0) lines.push('', '<b>Earlier scans</b>', ...earlier.map(scanBullet));
	return lines.join('\n');
}
