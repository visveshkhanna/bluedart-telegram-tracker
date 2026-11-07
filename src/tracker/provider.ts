/** One row of the carrier's "Status and Scans" history. */
export interface Scan {
	location: string;
	details: string;
	/** As shown by the carrier, e.g. "07 Mar 2026". */
	date: string;
	/** As shown by the carrier, e.g. "10:15". */
	time: string;
}

export type TrackingResult =
	/** The carrier has no record of this AWB (yet). */
	| { found: false }
	| {
			found: true;
			/** Newest first. */
			scans: Scan[];
			expectedDeliveryDate: string | null;
			/** Delivered / returned to shipper: stop tracking after this. */
			isTerminal: boolean;
	  };

export interface TrackingProvider {
	/** Throws on network errors or an unrecognised page; callers treat that as "try again later". */
	fetchStatus(awb: string): Promise<TrackingResult>;
}
