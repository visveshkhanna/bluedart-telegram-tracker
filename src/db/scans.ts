import { squish } from '../lib/html';
import type { Scan } from '../tracker/types';

/** Normalized identity of a scan, used to tell new scans from stored ones. */
export function scanKey(scan: Scan): string {
	return [scan.date, scan.time, scan.location, scan.details].map((part) => squish(part).toLowerCase()).join('|');
}

export async function getScanKeys(db: D1Database, shipmentId: number): Promise<Set<string>> {
	const { results } = await db.prepare('SELECT scan_key FROM scans WHERE shipment_id = ?1').bind(shipmentId).all<{ scan_key: string }>();
	return new Set(results.map((r) => r.scan_key));
}

/** Newest first. Scans are inserted oldest-first, so a higher id means a newer scan. */
export async function getRecentScans(db: D1Database, shipmentId: number, limit: number): Promise<Scan[]> {
	const { results } = await db
		.prepare(
			`SELECT location, details, scan_date AS date, scan_time AS time FROM scans
			 WHERE shipment_id = ?1 ORDER BY id DESC LIMIT ?2`,
		)
		.bind(shipmentId, limit)
		.all<Scan>();
	return results;
}

/** Insert statements for new scans (given newest-first), ordered oldest-first. */
export function insertScans(db: D1Database, shipmentId: number, newestFirst: Scan[]): D1PreparedStatement[] {
	return [...newestFirst].reverse().map((scan) =>
		db
			.prepare(
				`INSERT OR IGNORE INTO scans (shipment_id, location, details, scan_date, scan_time, scan_key)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			)
			.bind(shipmentId, scan.location, scan.details, scan.date, scan.time, scanKey(scan)),
	);
}
