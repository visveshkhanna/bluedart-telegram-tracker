export interface TrackingResult {
	/** Normalized status key used for change detection, e.g. "IN_TRANSIT". */
	status: string;
	/** Carrier's human-readable status, shown to the user. */
	statusText: string;
	location?: string;
	/** ISO timestamp of the latest scan, if the carrier provides one. */
	eventAt?: string;
	/** Delivered / returned: stop tracking after this. */
	isTerminal: boolean;
}

export interface TrackingProvider {
	/** Returns null when no status is available (yet), so nothing gets compared. */
	fetchStatus(awb: string): Promise<TrackingResult | null>;
}
