# Contributing

Thanks for taking the time to contribute. Bug reports, fixes and improvements are all welcome.

## Getting started

1. Fork and clone the repository, then install dependencies (Node.js 24+):

   ```sh
   npm install
   ```

2. Follow [Local development](README.md#local-development) in the README to run the bot against your own dev bot.
3. Make sure everything passes before opening a pull request:

   ```sh
   npm run check
   ```

## Where things live

| Area                                         | Path                                  |
| -------------------------------------------- | ------------------------------------- |
| Routes and the cron entry point              | `src/index.ts`, `src/http/`           |
| Commands, buttons and the messages users see | `src/bot/`, `src/tracker/messages.ts` |
| Change detection and the cron run            | `src/tracker/`                        |
| BlueDart fetching and parsing                | `src/bluedart/`                       |
| Database queries                             | `src/db/`                             |
| Tunable values                               | `src/config.ts`                       |

Carriers implement the small `TrackingProvider` interface in `src/tracker/types.ts`, so supporting another carrier means adding a new client and parser next to `src/bluedart/`.

## Guidelines

- **Keep changes focused.** One logical change per pull request, and per commit where practical.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:`. For example `fix(bluedart): handle missing scan time`.
- **Tests.** Add or update tests for behaviour changes. They run inside workerd with a real local D1, and must never call BlueDart or Telegram: use the fakes in `test/helpers.ts` and the fixtures in `test/fixtures/`.
- **Database changes.** Add a new migration with `npx wrangler d1 migrations create bluedart-tracker <name>`. Never edit a migration that has already been released.
- **Style.** Prettier formats everything (`npm run format`). Comment the why, not the what. Key functions get a short doc comment; obvious code doesn't need one.
- **Configuration.** Values someone might want to tweak (limits, timeouts, intervals) belong in `src/config.ts`.
- **Secrets.** Never commit tokens. `.dev.vars` and `.prod.vars` are gitignored.

## Reporting bugs and requesting features

Open an issue using the templates. For parsing problems, include the AWB's status as shown on bluedart.com (with personal details removed), since that's usually enough to reproduce a layout change.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
