import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
	const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					// Fake values so tests never use the real bot from .dev.vars.
					bindings: {
						TEST_MIGRATIONS: migrations,
						BOT_TOKEN: '123456:TEST-TOKEN',
						WEBHOOK_SECRET: 'test-secret',
						BOT_INFO: JSON.stringify({
							id: 123456,
							is_bot: true,
							first_name: 'Test Bot',
							username: 'test_bot',
							can_join_groups: true,
							can_read_all_group_messages: false,
							supports_inline_queries: false,
							can_connect_to_business: false,
							has_main_web_app: false,
						}),
					},
				},
			}),
		],
		test: {
			setupFiles: ['./test/apply-migrations.ts'],
		},
	};
});
