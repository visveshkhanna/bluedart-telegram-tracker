// BlueDart waybill (AWB) numbers are numeric, usually 11 digits.
// Keep the check loose so legitimate numbers of other lengths aren't rejected.
const AWB_PATTERN = /^\d{8,14}$/;

/** Strip spaces and dashes users commonly paste in, e.g. "123-4567 8901". */
export function normalizeAwb(input: string): string {
	return input.replace(/[\s-]/g, "");
}

export function isValidAwb(awb: string): boolean {
	return AWB_PATTERN.test(awb);
}
