/** Check intervals a user can pick. The cron ticks every 5 minutes, so that's the floor. */
export const CHECK_INTERVALS = [5, 15, 30, 60, 180, 360, 720, 1440] as const;
export const DEFAULT_CHECK_INTERVAL = 60;

export function isAllowedInterval(minutes: number): boolean {
	return (CHECK_INTERVALS as readonly number[]).includes(minutes);
}

export function formatInterval(minutes: number): string {
	if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
	if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
	return `${minutes} min`;
}
