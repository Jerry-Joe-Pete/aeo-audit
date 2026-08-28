#!/usr/bin/env node
// MCP server over stdio. Zero dependencies — the protocol is newline-delimited
// JSON-RPC 2.0 and implementing the three methods this needs is shorter than
// wiring up an SDK.
//
// Design rules, because the audience for this file is an agent, not a human:
//
//  1. Every tool description says what the tool RETURNS, not just what it does.
//     An agent chooses between tools on the strength of the return description.
//  2. Every required field's description carries a concrete example value.
//     "domain: bare host, no scheme — e.g. linear.app" is worth more than
//     "the domain of the brand".
//  3. Every error is a tool result with isError, never a transport-level fault,
//     and every message ends with the next action. An agent that gets
//     "DATAFORSEO_AUTH_B64 is not set → set it to base64(login:password)"
//     can recover. One that gets "500 Internal Error" cannot.
//  4. The cheap tool comes first in tools/list and says it is the cheap one, so
//     an agent probing the surface does not open with a 100-call audit.

import { loadConfig, type Engine } from "../src/config.ts";
import { runAudit } from "../src/variance.ts";
import { ask } from "../src/engines/dataforseo.ts";
import { buildMatcher, scoreAnswer } from "../src/measure.ts";
import { toMarkdown } from "../src/report.ts";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "aeo_check_query",
    description:
      "Run ONE query against ONE AI answer engine and report whether a brand is " +
      "mentioned in the prose, whether its domain appears in the citations, and " +
      "which other domains were cited instead. Returns a JSON object with " +
      "brandMentioned, brandRank, brandCited, competitorsMentioned and citedHosts. " +
      "This is the cheap tool: exactly one API call. Use it to probe before " +
      "committing to aeo_run_audit.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'The prompt to send, verbatim — e.g. "best issue tracker for software teams"',
        },
        brand: { type: "string", description: 'Brand name as it would be written — e.g. "Linear"' },
        domain: {
          type: "string",
          description: 'Bare host of the brand, no scheme and no path — e.g. "linear.app"',
        },
        engine: {
          type: "string",
          enum: ["chatgpt", "perplexity"],
          description: "Which engine to ask. Defaults to chatgpt.",
        },
        competitors: {
          type: "array",
          items: { type: "string" },
          description: 'Optional competitor names to also detect — e.g. ["Jira", "Asana"]',
        },
      },
      required: ["query", "brand", "domain"],
    },
  },
  {
    name: "aeo_run_audit",
    description:
      "Run a full audit: every query against every engine, repeated N times, split " +
      "by branded vs unbranded. Returns a Markdown report with per-class citation " +
      "rates and a stability count showing how many queries gave different answers " +
      "across identical runs. COST WARNING: this makes queries × engines × runs API " +
      "calls. A 14-query, 1-engine, 5-run audit is 70 calls. Call aeo_check_query " +
      "first if you are unsure the config is right.",
    inputSchema: {
      type: "object",
      properties: {
        config: {
          type: "object",
          description:
            "Full audit config. Shape: { brand: {name, domain}, competitors: " +
            "[{name, domain}], market: {location_name, language_code}, engines: " +
            '["chatgpt"], runs: 5, queries: [{q, class}] } where class is exactly ' +
            '"branded" or "unbranded".',
        },
      },
      required: ["config"],
    },
  },
];

// ── JSON-RPC plumbing ─────────────────────────────────────────────────────
type Req = { jsonrpc: "2.0"; id?: number | string; method: string; params?: any };

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");

const ok = (id: Req["id"], result: unknown) => send({ jsonrpc: "2.0", id, result });

/** Tool-level failure: the agent sees the text and can act on it. */
const toolError = (id: Req["id"], message: string) =>
  ok(id, { content: [{ type: "text", text: message }], isError: true });

const toolText = (id: Req["id"], text: string) => ok(id, { content: [{ type: "text", text }] });

async function callTool(id: Req["id"], name: string, args: any) {
  if (name === "aeo_check_query") {
    for (const f of ["query", "brand", "domain"]) {
      if (!args?.[f]) {
        return toolError(
          id,
          `Missing required field "${f}".\n  → aeo_check_query needs query, brand and domain. ` +
            `Example: {"query":"best issue tracker for software teams","brand":"Linear","domain":"linear.app"}`,
        );
      }
    }

    const engine = (args.engine ?? "chatgpt") as Engine;
    if (engine !== "chatgpt" && engine !== "perplexity") {
      return toolError(
        id,
        `Unknown engine ${JSON.stringify(args.engine)}.\n  → Use "chatgpt" or "perplexity".`,
      );
    }

    const cfg = loadConfig({
      brand: { name: args.brand, domain: args.domain, isBrand: true },
      competitors: (args.competitors ?? []).map((n: string) => ({
        name: n,
        domain: null,
        isBrand: false,
      })),
      engines: [engine],
      runs: 1,
      queries: [{ q: args.query, class: "unbranded" }],
    });

    const answer = await ask(engine, args.query);
    const score = scoreAnswer(
      answer.content,
      answer.citations,
      cfg,
      buildMatcher([cfg.brand, ...cfg.competitors]),
    );
    return toolText(id, JSON.stringify({ engine, model: answer.model, ...score }, null, 2));
  }

  if (name === "aeo_run_audit") {
    if (!args?.config) {
      return toolError(
        id,
        'Missing required field "config".\n  → Pass the full audit config object. ' +
          'Minimal example: {"config":{"brand":{"name":"Linear","domain":"linear.app"},' +
          '"runs":3,"engines":["chatgpt"],"queries":[{"q":"what is Linear","class":"branded"}]}}',
      );
    }

    let cfg;
    try {
      cfg = loadConfig(args.config);
    } catch (e) {
      // loadConfig messages already name the offending field and the legal values.
      return toolError(id, `${e instanceof Error ? e.message : e}\n  → Fix the config and call again.`);
    }

    const audit = await runAudit(cfg, new Date().toISOString());
    return toolText(id, toMarkdown(audit));
  }

  return toolError(
    id,
    `Unknown tool ${JSON.stringify(name)}.\n  → Available: ${TOOLS.map((t) => t.name).join(", ")}. ` +
      `Call tools/list for the schemas.`,
  );
}

async function handle(req: Req) {
  switch (req.method) {
    case "initialize":
      return ok(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "aeo-audit", version: "1.0.0" },
      });

    case "notifications/initialized":
      return; // Notification — no id, no response.

    case "tools/list":
      return ok(req.id, { tools: TOOLS });

    case "tools/call":
      try {
        return await callTool(req.id, req.params?.name, req.params?.arguments ?? {});
      } catch (e) {
        // Runtime faults (network, auth, quota) surface as tool errors with the
        // hint attached, so the agent can fix the cause instead of retrying blind.
        return toolError(req.id, e instanceof Error ? e.message : String(e));
      }

    default:
      if (req.id === undefined) return; // Unknown notification — ignore.
      return send({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
  }
}


// ── stdio loop ────────────────────────────────────────────────────────────
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let req: Req;
    try {
      req = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    handle(req).catch((e) => console.error(`aeo-audit mcp: ${e}`));
  }
});
