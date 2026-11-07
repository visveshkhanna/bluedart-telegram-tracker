// Inline-button payloads. Telegram caps callback data at 64 bytes, so they're terse.

export const cb = {
	list: 'l',
	show: (id: number) => `s:${id}`,
	refresh: (id: number) => `r:${id}`,
	intervals: (id: number) => `i:${id}`,
	setInterval: (id: number, minutes: number) => `i:${id}:${minutes}`,
	rename: (id: number) => `n:${id}`,
	stop: (id: number) => `x:${id}`,
	stopConfirm: (id: number) => `xy:${id}`,
};

/** Matching patterns; group 1 is always the shipment id. */
export const cbPattern = {
	show: /^s:(\d+)$/,
	refresh: /^r:(\d+)$/,
	intervals: /^i:(\d+)$/,
	setInterval: /^i:(\d+):(\d+)$/,
	rename: /^n:(\d+)$/,
	stop: /^x:(\d+)$/,
	stopConfirm: /^xy:(\d+)$/,
};
