import type { Context, InlineKeyboard } from 'grammy';
import type { View } from './views';

/** Replies with HTML formatting and an optional inline keyboard. */
export function replyHtml(ctx: Context, text: string, keyboard?: InlineKeyboard) {
	return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

export function replyView(ctx: Context, view: View, prefix = '') {
	return replyHtml(ctx, prefix + view.text, view.keyboard);
}
