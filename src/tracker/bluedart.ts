import { parse } from "node-html-parser";
import type { Scan, TrackingProvider, TrackingResult } from "./provider";

// BlueDart's public tracking page (the same one its site shows guests).
// It returns HTML, so we parse the "Status and Scans" table and the
// "Expected Date of Delivery" field out of it.
const TRACK_URL = "https://www.bluedart.com/web/guest/trackdartresultthirdparty";
const REQUEST_TIMEOUT_MS = 15_000;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Delivered or returned to the shipper, but not "undelivered" / "out for delivery". */
export function isTerminalScan(details: string): boolean {
	const d = details.toLowerCase();
	if (/\b(un|not |non[- ]?)deliver/.test(d)) return false;
	return /\bdelivered\b/.test(d) || /\breturned to (shipper|origin)\b/.test(d);
}

export function parseTrackingPage(html: string): TrackingResult {
	const root = parse(html);

	if (/Records Not Found/i.test(root.text)) {
		return { found: false };
	}

	const scansTable = root
		.querySelectorAll("table")
		.find((table) => table.querySelectorAll("th").some((th) => /status and scans/i.test(th.text)));
	if (!scansTable) {
		throw new Error("BlueDart page layout not recognised: 'Status and Scans' table missing");
	}

	const scans: Scan[] = [];
	for (const row of scansTable.querySelectorAll("tr")) {
		const cells = row.querySelectorAll("td");
		if (cells.length !== 4) continue; // header / spacer rows
		const [location, details, date, time] = cells.map((cell) => clean(cell.text));
		scans.push({ location, details, date, time });
	}

	const eddHeader = root.querySelectorAll("th").find((th) => /^expected date of delivery$/i.test(clean(th.text)));
	const expectedDeliveryDate = clean(eddHeader?.nextElementSibling?.text ?? "") || null;

	return {
		found: true,
		scans,
		expectedDeliveryDate,
		isTerminal: scans.length > 0 && isTerminalScan(scans[0].details),
	};
}

export const bluedartProvider: TrackingProvider = {
	async fetchStatus(awb) {
		const url = `${TRACK_URL}?trackFor=0&trackNo=${encodeURIComponent(awb)}`;
		const response = await fetch(url, {
			headers: { "User-Agent": "Mozilla/5.0 (compatible; bluedart-telegram-tracker)" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`BlueDart responded with HTTP ${response.status}`);
		}
		return parseTrackingPage(await response.text());
	},
};
