import { parse } from 'node-html-parser';
import { squish } from '../lib/html';
import type { Scan, TrackingResult } from '../tracker/types';

/** Delivered or returned to the shipper, but not "undelivered" / "out for delivery". */
export function isTerminalScan(details: string): boolean {
	const d = details.toLowerCase();
	if (/\b(un|not |non[- ]?)deliver/.test(d)) return false;
	return /\bdelivered\b/.test(d) || /\breturned to (shipper|origin)\b/.test(d);
}

/**
 * Parses BlueDart's tracking page: the "Status and Scans" table (location, details,
 * date, time; newest first) and the "Expected Date of Delivery" field.
 * Throws if the page doesn't look like a tracking page, so layout changes surface loudly.
 */
export function parseTrackingPage(html: string): TrackingResult {
	const root = parse(html);
	if (/Records Not Found/i.test(root.text)) return { found: false };

	const scansTable = root
		.querySelectorAll('table')
		.find((table) => table.querySelectorAll('th').some((th) => /status and scans/i.test(th.text)));
	if (!scansTable) throw new Error("BlueDart page layout not recognised: 'Status and Scans' table missing");

	const scans: Scan[] = scansTable
		.querySelectorAll('tr')
		.map((row) => row.querySelectorAll('td').map((cell) => squish(cell.text)))
		.filter((cells) => cells.length === 4)
		.map(([location, details, date, time]) => ({ location, details, date, time }));

	const eddHeader = root.querySelectorAll('th').find((th) => /^expected date of delivery$/i.test(squish(th.text)));
	const expectedDeliveryDate = squish(eddHeader?.nextElementSibling?.text ?? '') || null;

	return {
		found: true,
		scans,
		expectedDeliveryDate,
		isTerminal: scans.length > 0 && isTerminalScan(scans[0].details),
	};
}
