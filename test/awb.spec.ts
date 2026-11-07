import { describe, expect, it } from 'vitest';
import { isValidAwb, normalizeAwb } from '../src/lib/awb';

describe('AWB helpers', () => {
	it('strips spaces and dashes', () => {
		expect(normalizeAwb('123-4567 8901')).toBe('12345678901');
	});

	it('accepts 8–14 digit numbers only', () => {
		expect(isValidAwb('12345678901')).toBe(true);
		expect(isValidAwb('1234567')).toBe(false);
		expect(isValidAwb('123456789012345')).toBe(false);
		expect(isValidAwb('12345abc901')).toBe(false);
	});
});
