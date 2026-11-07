// Message text helpers. All bot replies use parse_mode "HTML",
// so anything user- or carrier-provided must go through escapeHtml.

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
