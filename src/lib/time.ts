import { UI } from '../config';

/** Formats a D1 UTC timestamp ("YYYY-MM-DD HH:MM:SS") in the display time zone. */
export function formatTimestamp(utc: string): string {
	return new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('en-IN', {
		timeZone: UI.displayTimeZone,
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit',
	});
}

export function formatInterval(minutes: number): string {
	if (minutes % 1440 === 0) return minutes === 1440 ? '1 day' : `${minutes / 1440} days`;
	if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
	return `${minutes} min`;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
