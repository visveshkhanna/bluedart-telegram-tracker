import { UI } from '../config';
import { normalizeAwb } from '../lib/awb';
import { squish } from '../lib/html';

/** Splits "<AWB> rest of text" from a command's arguments. */
export function parseAwbArgs(match: string): { awb: string | null; rest: string } {
	const [rawAwb, ...rest] = match.trim().split(/\s+/).filter(Boolean);
	return { awb: rawAwb ? normalizeAwb(rawAwb) : null, rest: rest.join(' ') };
}

/** A user-supplied shipment name: squished, length-capped, and "-" or empty means none. */
export function parseLabel(text: string): string | null {
	const label = squish(text).slice(0, UI.maxLabelLength);
	return label === '' || label === '-' ? null : label;
}
