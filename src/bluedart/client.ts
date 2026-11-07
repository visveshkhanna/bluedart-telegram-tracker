import { BLUEDART } from '../config';
import type { TrackingProvider } from '../tracker/types';
import { parseTrackingPage } from './parser';

export const bluedartProvider: TrackingProvider = {
	async fetchStatus(awb) {
		const url = `${BLUEDART.trackUrl}?trackFor=0&trackNo=${encodeURIComponent(awb)}`;
		const response = await fetch(url, {
			headers: { 'User-Agent': BLUEDART.userAgent },
			signal: AbortSignal.timeout(BLUEDART.requestTimeoutMs),
		});
		if (!response.ok) throw new Error(`BlueDart responded with HTTP ${response.status}`);
		return parseTrackingPage(await response.text());
	},
};
