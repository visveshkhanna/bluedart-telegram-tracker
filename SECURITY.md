# Security Policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Instead, report them privately through [GitHub security advisories](https://github.com/visveshkhanna/bluedart-telegram-tracker/security/advisories/new), or email visveshkhanna@gmail.com.

Include a description of the issue, steps to reproduce it and its potential impact. You can expect an acknowledgement within a few days.

## Scope

Areas that matter most:

- Webhook authentication (`X-Telegram-Bot-Api-Secret-Token`) and the `/setup` endpoint
- Inline-button handlers acting on another chat's shipments
- Leaking secrets (`BOT_TOKEN`, `WEBHOOK_SECRET`) through logs, errors or responses

## Supported versions

Only the latest version on `main` receives fixes.
