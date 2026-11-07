#!/usr/bin/env node
// Manage the Telegram webhook for this bot.
//
//   npm run webhook -- set <base-url>   # registers <base-url>/webhook with WEBHOOK_SECRET
//   npm run webhook -- info
//   npm run webhook -- delete
//
// BOT_TOKEN and WEBHOOK_SECRET come from the environment, falling back to .dev.vars.
// The token is never printed.
import { existsSync, readFileSync } from "node:fs";

function loadDevVars() {
	if (!existsSync(".dev.vars")) return {};
	const vars = {};
	for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
		const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!match) continue;
		vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
	}
	return vars;
}

const devVars = loadDevVars();
const BOT_TOKEN = process.env.BOT_TOKEN ?? devVars.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? devVars.WEBHOOK_SECRET;

if (!BOT_TOKEN) {
	console.error("BOT_TOKEN is missing (set it in the environment or .dev.vars).");
	process.exit(1);
}

async function call(method, params = {}) {
	const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(params),
	});
	const body = await response.json();
	if (!body.ok) {
		console.error(`${method} failed: ${body.error_code} ${body.description}`);
		process.exit(1);
	}
	return body.result;
}

const [command, baseUrl] = process.argv.slice(2);

switch (command) {
	case "set": {
		if (!baseUrl) {
			console.error("Usage: npm run webhook -- set <base-url>");
			process.exit(1);
		}
		if (!WEBHOOK_SECRET) {
			console.error("WEBHOOK_SECRET is missing (set it in the environment or .dev.vars).");
			process.exit(1);
		}
		const url = `${baseUrl.replace(/\/+$/, "")}/webhook`;
		await call("setWebhook", {
			url,
			secret_token: WEBHOOK_SECRET,
			allowed_updates: ["message", "callback_query", "my_chat_member"],
			drop_pending_updates: true,
		});
		console.log(`Webhook set to ${url}`);
		break;
	}
	case "info": {
		const info = await call("getWebhookInfo");
		console.log(JSON.stringify(info, null, 2));
		break;
	}
	case "delete": {
		await call("deleteWebhook", { drop_pending_updates: true });
		console.log("Webhook deleted");
		break;
	}
	default:
		console.error("Usage: npm run webhook -- <set <base-url> | info | delete>");
		process.exit(1);
}
