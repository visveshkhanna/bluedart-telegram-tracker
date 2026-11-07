// Hand-written approximations of BlueDart's tracking page, shaped like the real markup
// (a details table with "Expected Date of Delivery" and a "Status and Scans" table).

export interface FixtureScan {
	location: string;
	details: string;
	date: string;
	time: string;
}

export function trackingPage({
	awb = '12345678901',
	expectedDeliveryDate = '12 Mar 2026',
	scans = [{ location: 'Bengaluru', details: 'Shipment Picked Up', date: '07 Mar 2026', time: '10:15' }],
}: { awb?: string; expectedDeliveryDate?: string | null; scans?: FixtureScan[] } = {}): string {
	const eddRow =
		expectedDeliveryDate === null
			? ''
			: `<tr><th>Expected Date of Delivery</th><td>
					${expectedDeliveryDate}
				</td></tr>`;
	const scanRows = scans
		.map((s) => `<tr><td>${s.location}</td><td> ${s.details} </td><td>${s.date}</td><td>${s.time}</td></tr>`)
		.join('\n');
	return `<html><body>
		<table class="table"><tbody>
			<tr><th>Waybill No</th><td>${awb}</td></tr>
			${eddRow}
		</tbody></table>
		<table class="table">
			<thead><tr><th colspan="4">Status and Scans</th></tr>
			<tr><th>Location</th><th>Details</th><th>Date</th><th>Time</th></tr></thead>
			<tbody>${scanRows}</tbody>
		</table>
	</body></html>`;
}

export function notFoundPage(awb = '12345678901'): string {
	return `<html><body><div class="alert alert-danger wrap-track">Records Not Found - <strong>${awb}</strong></div></body></html>`;
}
