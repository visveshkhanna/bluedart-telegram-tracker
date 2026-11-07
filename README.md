# BlueDart Telegram Tracker

[![CI](https://github.com/visveshkhanna/bluedart-telegram-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/visveshkhanna/bluedart-telegram-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Telegram bot that tracks BlueDart shipments and messages you when something changes: a new scan, a new expected delivery date, or delivery. It runs entirely on Cloudflare's free tier: **Workers** for the bot, **D1** for storage and **Cron Triggers** for the checks.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/visveshkhanna/bluedart-telegram-tracker)

## Features

- **Track by AWB:** `/track 12345678901 Black backpack` starts tracking and immediately replies with the latest scan, expected delivery date and scan history.
- **Alerts on change:** a message on every new scan or a changed expected delivery date. Tracking stops automatically once a shipment is delivered or returned.
- **Manage from the chat:** `/list` shows your shipments as buttons. Each one opens a card where you can refresh, rename, change how often it's checked (5 minutes to 1 day, default 1 hour) or stop tracking.
- **Reliable delivery:** failed notifications are retried on the next run, users who block the bot are skipped, and one failing shipment never stops the others.
- **Cheap to run:** a single Worker, one D1 database and one cron trigger, all within the Workers Free plan for personal use.

## Quick start (one-click deploy)

1. **Create a bot.** Message [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token.
2. **Deploy.** Click **Deploy to Cloudflare** above. Cloudflare will:
   - copy this repository to your GitHub or GitLab account,
   - create the D1 database,
   - run the migrations and deploy the Worker,
   - ask you for two secrets:

   | Secret           | Value                                                           |
   | ---------------- | --------------------------------------------------------------- |
   | `BOT_TOKEN`      | The token from @BotFather                                       |
   | `WEBHOOK_SECRET` | Any long random string, for example from `openssl rand -hex 32` |

3. **Connect Telegram.** Open this URL once in your browser. It points the bot at your Worker and registers the command menu:

   ```
   https://<your-worker>.<your-subdomain>.workers.dev/setup?secret=<WEBHOOK_SECRET>
   ```

   You should see `{"ok":true,"bot":"@your_bot","webhook":"…/webhook"}`.

4. **Use it.** Send `/start` to your bot.

## Commands

| Command                | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `/track <AWB> [name]`  | Start tracking a shipment                                        |
| `/list`                | Your shipments, as buttons (refresh, interval, rename, stop)     |
| `/status <AWB>`        | Refresh now and show the latest scans and expected delivery date |
| `/rename <AWB> <name>` | Rename a shipment (`-` removes the name)                         |
| `/untrack <AWB>`       | Stop tracking                                                    |
| `/help`                | Show the commands                                                |

## How it works

```
Telegram ── POST /webhook ──▶ Worker (grammY) ── commands and buttons ──▶ D1
Cron */5 * * * * ──────────▶ Worker scheduled() ── for each shipment that is due:
                                BlueDart tracking page → new scans? new delivery date?
                                → save to D1 → message the user
```

- **Scheduling.** One cron trigger runs every 5 minutes. Each shipment has its own check interval and `next_check_at`, so a run only checks the shipments that are due, most overdue first, up to 20 per run.
- **Data source.** BlueDart's public tracking page is parsed for the "Status and Scans" table and the "Expected Date of Delivery" field (`src/bluedart/parser.ts`). The approach is inspired by [gitcommitankit/bluedart-alerts](https://github.com/gitcommitankit/bluedart-alerts).
- **Change detection.** A scan is new if its normalized `date|time|location|details` isn't stored yet. The delivery date has changed if it's present and differs from the stored one; a missing date is treated as a scraping glitch and never overwrites a known one.
- **Delivery guarantees.** A notification is saved together with the update it describes and cleared once Telegram accepts it, so a failed send is retried on the next run.

## Manual deployment

If you'd rather deploy from your own machine with Wrangler:

```sh
git clone https://github.com/visveshkhanna/bluedart-telegram-tracker.git
cd bluedart-telegram-tracker
npm install
npx wrangler login
```

1. Create the database, then put the printed `database_id` into `wrangler.jsonc`:

   ```sh
   npx wrangler d1 create bluedart-tracker
   ```

2. Create `.prod.vars` from the example and fill it in. It's gitignored.

   ```sh
   cp .dev.vars.example .prod.vars
   ```

3. Deploy (this applies migrations first) and upload the secrets:

   ```sh
   npm run deploy
   npm run secrets:prod
   ```

4. Connect Telegram by opening `https://<your-worker>.<your-subdomain>.workers.dev/setup?secret=<WEBHOOK_SECRET>`, or run `npm run webhook:prod -- set https://<your-worker>.<your-subdomain>.workers.dev`.

For later updates, run `npm run check && npm run deploy`. Secrets and the webhook persist across deploys.

## Configuration

| Name             | Kind       | Required | Description                                                                                            |
| ---------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `BOT_TOKEN`      | Secret     | Yes      | Bot token from @BotFather                                                                              |
| `WEBHOOK_SECRET` | Secret     | Yes      | Verifies that webhook calls come from Telegram; also guards `/setup`                                   |
| `BOT_INFO`       | Secret     | No       | The JSON `result` of `getMe`. Saves one Telegram call per cold start; it's fetched and cached if unset |
| `DB`             | D1 binding | Yes      | Configured in `wrangler.jsonc`                                                                         |

Behaviour such as the offered check intervals, per-run limits, timeouts and the display time zone lives in [`src/config.ts`](src/config.ts).

## Local development

Requires Node.js 24+, a separate dev bot from @BotFather, and [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) to expose the local Worker.

```sh
npm install
cp .dev.vars.example .dev.vars       # use your dev bot's token
npm run db:migrate:local
npm run dev                          # http://localhost:8787
```

In a second terminal:

```sh
cloudflared tunnel --url http://localhost:8787     # prints https://<random>.trycloudflare.com
npm run webhook -- set https://<random>.trycloudflare.com
```

To trigger a cron run by hand: `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"`.

| Script                                 | Purpose                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| `npm test`                             | Vitest inside workerd, with a fresh migrated D1 and fake secrets |
| `npm run typecheck`                    | Type-check app and tests                                         |
| `npm run format`                       | Format with Prettier                                             |
| `npm run check`                        | Formatting, types, tests and a deploy dry run (what CI runs)     |
| `npm run webhook -- set\|info\|delete` | Manage the Telegram webhook (reads `.dev.vars`)                  |

## Project structure

```
src/
  index.ts       Worker entry: routes and the cron handler
  config.ts      Tunables: intervals, limits, timeouts, UI sizes
  http/          /webhook and /setup handlers
  bot/           grammY bot: commands, inline buttons, views, rename flow
  tracker/       Diffing, the cron run, notifications and message formatting
  bluedart/      BlueDart client and HTML parser
  db/            D1 queries: users, shipments, scans, tracker
  lib/           Small helpers: AWB validation, HTML escaping, time, concurrency
migrations/      D1 schema migrations
scripts/         Webhook management script
test/            Vitest suites (run in workerd)
```

## Troubleshooting

- **The bot doesn't reply.** Check `npm run webhook:prod -- info` for `last_error_message`, and watch `npx wrangler tail`. A `401` means `WEBHOOK_SECRET` doesn't match what was registered; open `/setup` again. A `no such table` error means migrations didn't run; run `npm run db:migrate:remote`.
- **`npm run webhook` fails with `ECONNRESET`.** Some antivirus web filters reset Node's connections to `api.telegram.org`. The script retries and then falls back to `curl` automatically.
- **"Layout not recognised" in the logs.** BlueDart changed its page. The shipment is rescheduled and nothing is lost, but `src/bluedart/parser.ts` needs updating. Please open an issue.

## Limits

- On the Workers Free plan each run can make 50 subrequests. A check costs one BlueDart request and at most one Telegram request, so a run handles up to 20 shipments and the rest are picked up on later runs.
- Very short intervals (5 or 15 minutes) across many shipments increase the load on BlueDart and the chance of being rate-limited. BlueDart usually updates a few times a day.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)

## Disclaimer

This project isn't affiliated with or endorsed by Blue Dart Express. It reads BlueDart's publicly accessible tracking page; please use it responsibly.
