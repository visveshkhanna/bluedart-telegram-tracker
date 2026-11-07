// Tunables in one place. Anything a maintainer might reasonably want to tweak lives here.

export const BLUEDART = {
	/** BlueDart's public tracking page (HTML). */
	trackUrl: 'https://www.bluedart.com/web/guest/trackdartresultthirdparty',
	requestTimeoutMs: 15_000,
	userAgent: 'Mozilla/5.0 (compatible; bluedart-telegram-tracker)',
} as const;

export const TRACKER = {
	/**
	 * Shipments checked per cron tick. Each costs ~1 BlueDart + ≤1 Telegram subrequest,
	 * and the Workers Free plan allows 50 subrequests per invocation.
	 */
	maxShipmentsPerRun: 20,
	/** Failed notifications re-sent per tick. */
	maxRetriesPerRun: 5,
	/** Shipments checked in parallel. */
	concurrency: 5,
	/** Wait at most this long when Telegram rate-limits us (429), then give up until next tick. */
	maxRateLimitWaitSeconds: 5,
	/** Cron ticks aren't exactly on the minute; anything due this soon counts as due now. */
	dueToleranceMinutes: 2,
} as const;

/** Check intervals offered in the bot, in minutes. The cron ticks every 5 minutes, so that's the floor. */
export const CHECK_INTERVALS = [5, 15, 30, 60, 180, 360, 720, 1440] as const;
/** Must match the column default in migrations/0003. */
export const DEFAULT_CHECK_INTERVAL = 60;

/** BlueDart AWBs are numeric, usually 11 digits; kept loose on purpose. */
export const AWB_PATTERN = /^\d{8,14}$/;

export const UI = {
	displayTimeZone: 'Asia/Kolkata',
	maxLabelLength: 64,
	maxButtonTextLength: 40,
	/** Scans shown on a shipment card. */
	cardScans: 6,
	/** New scans listed in one notification. */
	notificationScans: 5,
} as const;

export const TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const;

export function isAllowedInterval(minutes: number): boolean {
	return (CHECK_INTERVALS as readonly number[]).includes(minutes);
}
