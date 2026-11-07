/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Collapses runs of whitespace and trims. */
export function squish(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}
