/** One row of the carrier's scan history. Dates and times are kept exactly as the carrier prints them. */
export interface Scan {
	location: string;
	details: string;
	date: string;
	time: string;
}

export type TrackingResult =
	| { found: false }
	| {
			found: true;
			/** Newest first. */
			scans: Scan[];
			expectedDeliveryDate: string | null;
			/** Delivered or returned: tracking stops after this. */
			isTerminal: boolean;
	  };

/** A carrier integration. Throws on network errors or unrecognised responses. */
export interface TrackingProvider {
	fetchStatus(awb: string): Promise<TrackingResult>;
}
