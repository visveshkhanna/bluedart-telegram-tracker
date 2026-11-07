import { describe, expect, it } from 'vitest';
import { isTerminalScan, parseTrackingPage } from '../src/bluedart/parser';
import { notFoundPage, trackingPage } from './fixtures/bluedart';

describe('parseTrackingPage', () => {
	it('reports unknown AWBs as not found', () => {
		expect(parseTrackingPage(notFoundPage())).toEqual({ found: false });
	});

	it('extracts scans (newest first), trimmed, and the expected delivery date', () => {
		const result = parseTrackingPage(
			trackingPage({
				scans: [
					{ location: 'Bengaluru Hub', details: 'Out For Delivery', date: '09 Mar 2026', time: '08:02' },
					{ location: 'Mumbai Hub', details: 'In Transit', date: '08 Mar 2026', time: '22:40' },
				],
			}),
		);
		expect(result).toEqual({
			found: true,
			expectedDeliveryDate: '12 Mar 2026',
			isTerminal: false,
			scans: [
				{ location: 'Bengaluru Hub', details: 'Out For Delivery', date: '09 Mar 2026', time: '08:02' },
				{ location: 'Mumbai Hub', details: 'In Transit', date: '08 Mar 2026', time: '22:40' },
			],
		});
	});

	it('handles a missing expected delivery date', () => {
		const result = parseTrackingPage(trackingPage({ expectedDeliveryDate: null }));
		expect(result).toMatchObject({ found: true, expectedDeliveryDate: null });
	});

	it('flags a delivered shipment as terminal', () => {
		const result = parseTrackingPage(
			trackingPage({ scans: [{ location: 'Bengaluru', details: 'SHIPMENT DELIVERED', date: '10 Mar 2026', time: '13:00' }] }),
		);
		expect(result).toMatchObject({ isTerminal: true });
	});

	it('throws when the page layout is unrecognised', () => {
		expect(() => parseTrackingPage('<html><body>Maintenance</body></html>')).toThrow(/layout/);
	});
});

describe('isTerminalScan', () => {
	it.each([
		['SHIPMENT DELIVERED', true],
		['Shipment delivered to consignee', true],
		['RTO Delivered', true],
		['Returned to shipper', true],
		['Out For Delivery', false],
		['Undelivered - consignee not available', false],
		['Not delivered, address incomplete', false],
		['In Transit', false],
	])('%s → %s', (details, expected) => {
		expect(isTerminalScan(details)).toBe(expected);
	});
});
