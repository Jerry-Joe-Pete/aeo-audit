#!/usr/bin/env node
// aeo-audit — measure how present a brand is in AI answer engines.
//
//   node src/cli.ts examples/linear.config.json
//   node src/cli.ts my-brand.json --runs 3 --out out/
//
// No build step, no dependencies. Node 22.6+ strips the types on the fly.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig } from "./config.ts";
import { runAudit } from "./variance.ts";
import { toJson, toMarkdown } from "./report.ts";

const USAGE = `aeo-audit — brand presence in AI answer engines

Usage
  node src/cli.ts <config.json> [options]

Options
  --runs <n>     Override runs per query (default: from config, or 5)
  --out <dir>    Write results here (default: ./out)
  --quiet        No progress output
  -h, --help     This message

Requires DATAFORSEO_AUTH_B64 in the environment or in .env.
See .env.example and README.md.`;

function parseArgs(argv: string[]) {
  const args = { config: "", runs: 0, out: "out", quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--runs") {
      args.runs = Number(argv[++i]);
      if (!Number.isInteger(args.runs) || args.runs < 1) {
        throw new Error(`--runs needs a positive integer, got ${JSON.stringify(argv[i])}`);
      }
    } else if (a === "--out") {
      args.out = argv[++i] ?? "out";
    } else if (a === "--quiet") {
      args.quiet = true;
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown option ${a}\n\n${USAGE}`);
    } else if (!args.config) {
      args.config = a;
    } else {
      throw new Error(`Unexpected argument ${a} — only one config file is accepted.`);
    }
  }
  if (!args.config) throw new Error(`No config file given.\n\n${USAGE}`);
  return args;
}

// Minimal .env reader. Nothing here justifies a dependency.
function loadDotEnv(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env is fine — the variable may already be exported.
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();

  const cfg = loadConfig(JSON.parse(readFileSync(args.config, "utf8")));
  if (args.runs) cfg.runs = args.runs;

  const pairs = cfg.queries.length * cfg.engines.length;
  const calls = pairs * cfg.runs;
  if (!args.quiet) {
    console.error(
      `${cfg.brand.name} · ${cfg.queries.length} queries × ${cfg.engines.length} engine(s) ` +
        `× ${cfg.runs} runs = ${calls} API calls`,
    );
  }

  const startedAt = new Date().toISOString();
  const audit = await runAudit(cfg, startedAt, args.quiet ? undefined : (m) => console.error(m));

  mkdirSync(args.out, { recursive: true });
  const stem = basename(args.config).replace(/\.config\.json$|\.json$/, "");
  const jsonPath = join(args.out, `${stem}.results.json`);
  const mdPath = join(args.out, `${stem}.results.md`);
  writeFileSync(jsonPath, toJson(audit));
  writeFileSync(mdPath, toMarkdown(audit));

  // Report goes to stdout so it can be piped; progress went to stderr.
  console.log(toMarkdown(audit));
  console.error(`\nWritten: ${jsonPath}\n         ${mdPath}`);

  // Distinct errors, once each. Sixty identical 401s are one problem, not sixty.
  const distinct = [...new Set(audit.results.flatMap((r) => r.errors))];
  if (distinct.length) {
    console.error(`\n${distinct.length} distinct error(s):`);
    for (const e of distinct) console.error(`\n  ${e.replace(/\n/g, "\n  ")}`);
  }

  const failed = audit.results.filter((r) => r.completed === 0).length;
  if (failed === audit.results.length) {
    console.error("\nEvery query failed. The rates above are not a finding — fix the cause above first.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
