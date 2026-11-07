// Message text + inline keyboards for shipment cards, the list and pickers.
import { InlineKeyboard } from 'grammy';
import { CHECK_INTERVALS, UI } from '../config';
import type { Shipment } from '../db/shipments';
import { getRecentScans } from '../db/scans';
import { escapeHtml } from '../lib/html';
import { formatInterval, formatTimestamp } from '../lib/time';
import { formatShipmentDetails, shipmentTitle } from '../tracker/messages';
import { cb } from './callback-data';

export interface View {
	text: string;
	keyboard?: InlineKeyboard;
}

export const shipmentName = (s: Shipment) => s.label ?? s.awb;

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function renderCard(db: D1Database, shipment: Shipment): Promise<View> {
	const scans = await getRecentScans(db, shipment.id, UI.cardScans);
	const lines = [formatShipmentDetails(shipment, scans), ''];
	const keyboard = new InlineKeyboard();

	if (shipment.isActive) {
		const interval = formatInterval(shipment.checkIntervalMinutes);
		const checked = shipment.lastCheckedAt ? ` · last checked ${formatTimestamp(shipment.lastCheckedAt)}` : '';
		lines.push(`⏱ Checking every ${interval}${checked}`);
		keyboard
			.text('🔄 Refresh', cb.refresh(shipment.id))
			.text(`⏱ Every ${interval}`, cb.intervals(shipment.id))
			.row()
			.text('✏️ Rename', cb.rename(shipment.id))
			.text('🛑 Stop tracking', cb.stop(shipment.id))
			.row();
	} else {
		lines.push('<i>Not being tracked any more.</i>');
	}
	keyboard.text('« All shipments', cb.list);

	return { text: lines.join('\n'), keyboard };
}

export function renderList(shipments: Shipment[]): View {
	if (shipments.length === 0) {
		return { text: "You're not tracking anything yet. Try /track &lt;AWB&gt; [name]." };
	}

	const keyboard = new InlineKeyboard();
	for (const s of shipments) {
		const status = s.lastStatusText ? ` · ${s.lastStatusText}` : '';
		keyboard.text(truncate(`📦 ${shipmentName(s)}${status}`, UI.maxButtonTextLength), cb.show(s.id)).row();
	}

	const entries = shipments.map((s) => {
		const status = s.lastStatusText ? escapeHtml(s.lastStatusText) : '<i>waiting for first scan</i>';
		const location = s.lastLocation ? ` (${escapeHtml(s.lastLocation)})` : '';
		const edd = s.expectedDeliveryDate ? `\n   📅 ${escapeHtml(s.expectedDeliveryDate)}` : '';
		return `${shipmentTitle(s.awb, s.label)}\n   ${status}${location}${edd}`;
	});
	return { text: `<b>Tracking ${shipments.length}</b> · tap one to manage it\n\n${entries.join('\n\n')}`, keyboard };
}

export function renderIntervalPicker(shipment: Shipment): View {
	const keyboard = new InlineKeyboard();
	CHECK_INTERVALS.forEach((minutes, i) => {
		const current = minutes === shipment.checkIntervalMinutes ? '✓ ' : '';
		keyboard.text(`${current}${formatInterval(minutes)}`, cb.setInterval(shipment.id, minutes));
		if (i % 4 === 3) keyboard.row();
	});
	keyboard.row().text('« Back', cb.show(shipment.id));
	return {
		text: `⏱ How often should I check <b>${escapeHtml(shipmentName(shipment))}</b>?\n\nShorter intervals mean faster alerts, but BlueDart usually only updates a few times a day.`,
		keyboard,
	};
}

export function renderStopConfirm(shipment: Shipment): View {
	return {
		text: `Stop tracking <b>${escapeHtml(shipmentName(shipment))}</b> (<code>${shipment.awb}</code>)?`,
		keyboard: new InlineKeyboard().text('Yes, stop', cb.stopConfirm(shipment.id)).text('Cancel', cb.show(shipment.id)),
	};
}
