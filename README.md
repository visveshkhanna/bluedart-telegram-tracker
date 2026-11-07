# BlueDart Telegram Tracker 📦

A Telegram bot that tracks **BlueDart** shipments and messages you when something changes: a new scan, a new expected delivery date, or delivery. It runs entirely on **Cloudflare Workers**, with **D1** for storage and a **Cron Trigger** for the checks.

## Features

- **`/track <AWB> [name]`:** start tracking. The bot fetches BlueDart straight away and replies with the latest scan, the expected delivery date and the scan history.
- **Alerts on change:** a message on every new scan, or when the expected delivery date changes. Tracking stops automatically once a shipment is delivered or returned.
- **Inline buttons:** `/list` shows your shipments as buttons. Tap one to:
  - 🔄 **Refresh** it now
  - ⏱ change **how often it's checked** (5 min … 1 day, default **1 hour**)
  - ✏️ **Rename** it ("Black backpack" instead of `12345678901`)
  - 🛑 **Stop tracking** it (with confirmation)
- **Reliable delivery:** failed notifications are retried on the next tick. Users who block the bot are skipped. One bad AWB never stops a run.

### Commands

| Command | What it does |
|---|---|
| `/track <AWB> [name]` | Start tracking a shipment |
| `/list` | Your shipments, as buttons |
| `/status <AWB>` | Refresh now and show the latest scans and expected delivery date |
| `/rename <AWB> <name>` | Rename a shipment (`-` removes the name) |
| `/untrack <AWB>` | Stop tracking |
| `/help` | List commands |

## How it works

```
Telegram ──webhook──▶ Worker fetch()  ── POST /webhook → grammY → commands & buttons ──▶ D1
Cron */5 * * * * ──▶ Worker scheduled() → for each shipment that is due:
                         BlueDart tracking page → new scans? new delivery date? → D1 → Telegram message
```

- **One cron** ticks every 5 minutes. Each shipment has its own `check_interval_minutes` and `next_check_at`, so it's only checked when it's due. A tick handles at most 20 shipments (most overdue first) to stay within the Workers subrequest limit.
- **BlueDart data** comes from BlueDart's public tracking page (`trackdartresultthirdparty`). We parse it with `node-html-parser`, reading the "Status and Scans" table and the "Expected Date of Delivery" field. The approach is inspired by [gitcommitankit/bluedart-alerts](https://github.com/gitcommitankit/bluedart-alerts).
- **Change detection:** a scan counts as new if its normalized `date|time|location|details` isn't stored yet. A delivery date counts as changed if it's present and different from the stored one. A missing date is treated as a scraping glitch and never overwrites a known one.

**Stack:** TypeScript · [grammY](https://grammy.dev) · Cloudflare Workers, D1 and Cron Triggers · Vitest (`@cloudflare/vitest-plugin`, running on workerd).

## Project structure

```
src/
  index.ts              Worker entry: fetch (/webhook, health check) + scheduled (tracker)
  bot.ts                createBot(): user upsert, command and button registration
  commands/             /start, /track, /list, /status, /untrack, /rename, inline buttons, views
  db/                   all D1 queries (shipments, scans, scheduling, pending messages)
  tracker/              BlueDart provider + parser, diffing, messages, intervals, cron run
  utils/                AWB validation, HTML escaping
migrations/             D1 schema migrations (applied with wrangler)
scripts/webhook.mjs     set / inspect / delete the Telegram webhook
test/                   Vitest suites (run inside workerd with a migrated local D1)
dump/                   planning notes
```

## Prerequisites

- Node.js 24+ and npm
- A Cloudflare account (the Workers Free plan is enough), logged in with `npx wrangler login`
- A Telegram bot token from [@BotFather](https://t.me/BotFather). Use **separate bots for dev and production**, because a bot can only have one webhook.
- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) for local webhook testing (`brew install cloudflared`)

## Configuration

| Name | Kind | Description |
|---|---|---|
| `BOT_TOKEN` | secret | Bot token from @BotFather |
| `WEBHOOK_SECRET` | secret | Random string; Telegram sends it with each update and grammY rejects requests without it. Generate one with `openssl rand -hex 32` |
| `BOT_INFO` | secret | The `result` object from `https://api.telegram.org/bot<TOKEN>/getMe`, on one line. It saves a `getMe` call per request |
| `DB` | D1 binding | `bluedart-tracker`, configured in `wrangler.jsonc` |

Locally these live in `.dev.vars`; for production, put them in `.prod.vars` and upload them as Worker secrets. Both files are gitignored. Start from `.dev.vars.example`.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars      # fill in your DEV bot's values
npm run db:migrate:local            # create the local D1 schema
npm run dev                         # Worker on http://localhost:8787
```

Telegram needs a public URL, so expose the local Worker in a second terminal and point the dev bot at it:

```sh
cloudflared tunnel --url http://localhost:8787     # prints https://<random>.trycloudflare.com
npm run webhook -- set https://<random>.trycloudflare.com
npm run webhook -- info                           # check pending updates and the last error
```

To trigger a cron tick by hand while `npm run dev` is running:

```sh
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

Quick tunnel URLs change every time `cloudflared` restarts, so re-run `webhook set` after a restart.

### Tests and checks

```sh
npm test            # Vitest inside workerd, using a fresh migrated D1 and fake secrets
npm run typecheck   # app and test types
npm run check       # typecheck + tests + `wrangler deploy --dry-run`
```

The tests never call BlueDart or Telegram. They use a fake provider, an intercepted grammY API and a stubbed `fetch`.

## Deployment (Cloudflare Workers)

### First deployment

1. **Create the production bot.** In @BotFather, send `/newbot` and copy the token.

2. **Create `.prod.vars`** from the example and fill it in with the production bot's values:
   ```sh
   cp .dev.vars.example .prod.vars
   # BOT_TOKEN  = the production bot's token
   # WEBHOOK_SECRET = output of: openssl rand -hex 32
   # BOT_INFO   = the "result" object from https://api.telegram.org/bot<TOKEN>/getMe (one line)
   ```

3. **Check everything builds:**
   ```sh
   npm run check
   ```

4. **Create the schema in the production D1 database.** The database itself already exists; see `database_id` in `wrangler.jsonc`.
   ```sh
   npm run db:migrate:remote
   ```

5. **Deploy the Worker.** The first time, Wrangler may ask you to register a `workers.dev` subdomain.
   ```sh
   npm run deploy
   # → https://bluedart-telegram-tracker.<your-subdomain>.workers.dev
   ```
   The cron trigger (`*/5 * * * *`) is registered automatically by this deploy.

6. **Upload the secrets:**
   ```sh
   npm run secrets:prod          # wrangler secret bulk .prod.vars
   ```

7. **Point the production bot at the Worker:**
   ```sh
   npm run webhook:prod -- set https://bluedart-telegram-tracker.<your-subdomain>.workers.dev
   npm run webhook:prod -- info
   ```

8. **Smoke test.** Send `/start` and then `/track <AWB>` to the production bot, and watch the logs:
   ```sh
   npx wrangler tail
   ```
   Logs (including each cron run's `[tracker] done {...}` summary) also show up in the Cloudflare dashboard under **Workers → bluedart-telegram-tracker → Logs**, because observability is enabled.

### Deploying updates

```sh
npm run check
npm run db:migrate:remote     # only if migrations/ has new files; already-applied ones are skipped
npm run deploy
```

The webhook and secrets persist across deploys. Re-run `npm run secrets:prod` only when a value changes.

### Useful commands

```sh
npx wrangler tail                                          # live logs
npx wrangler d1 execute bluedart-tracker --remote \
  --command "SELECT awb, label, last_status_text, next_check_at FROM shipments WHERE is_active = 1"
npx wrangler d1 migrations list bluedart-tracker --remote  # applied / pending migrations
npm run webhook:prod -- delete                             # detach the production bot
```

## Limits and caveats

- **Subrequests:** each check costs about one BlueDart request plus up to one Telegram request. The Free plan allows 50 subrequests per invocation, so a tick checks at most 20 shipments; the rest are picked up on later ticks.
- **Short intervals:** 5 and 15 minute checks on many shipments increase load on BlueDart and the risk of being rate-limited. BlueDart usually updates only a few times a day.
- **Scraping:** if BlueDart changes its page layout, the parser fails with "layout not recognised". The error is logged, the shipment is rescheduled and no data is lost, but `src/tracker/bluedart.ts` will need updating.
- **Times:** "last checked" is shown in IST. Scan dates and times appear exactly as BlueDart prints them.

## Disclaimer

This is a personal project. It isn't affiliated with or endorsed by Blue Dart Express. It reads BlueDart's publicly accessible tracking page; please use it responsibly.
