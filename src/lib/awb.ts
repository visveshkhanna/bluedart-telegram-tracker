import { AWB_PATTERN } from '../config';

/** Strips the spaces and dashes people paste in, e.g. "123-4567 8901". */
export function normalizeAwb(input: string): string {
	return input.replace(/[\s-]/g, '');
}

export function isValidAwb(awb: string): boolean {
	return AWB_PATTERN.test(awb);
}
