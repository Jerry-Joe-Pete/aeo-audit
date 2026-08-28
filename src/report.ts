// Two outputs: JSON for machines, Markdown for the README. Neither invents a
// number — a query that failed every run shows as "n/a", not as 0.

import type { Audit, QueryResult } from "./variance.ts";
import type { QueryClass } from "./config.ts";

const pct = (r: number) => `${Math.round(r * 100)}%`;
const frac = (r: number, n: number) => `${Math.round(r * n)}/${n}`;

function queryTable(rows: QueryResult[]): string {
  const head =
    "| Query | Engine | Mentioned | Cited | Best rank | Stable |\n" +
    "|---|---|---|---|---|---|";
  const body = rows.map((r) => {
    if (r.completed === 0) {
      return `| ${r.query} | ${r.engine} | n/a | n/a | n/a | all ${r.runs} runs failed |`;
    }
    const stable = r.flapped ? `no — varied across ${r.completed} runs` : "yes";
    return (
      `| ${r.query} | ${r.engine} | ${frac(r.mentionRate, r.completed)} | ` +
      `${frac(r.citationRate, r.completed)} | ${r.bestRank ?? "—"} | ${stable} |`
    );
  });
  return [head, ...body].join("\n");
}

function classBlock(a: Audit, cls: QueryClass): string {
  const s = a.byClass[cls];
  if (s.queries === 0 && s.failed === 0) return `_No ${cls} queries in this audit._`;
  if (s.queries === 0) return `_All ${s.failed} ${cls} queries failed — no data._`;
  return [
    `- Queries measured: **${s.queries}**` + (s.failed ? ` (${s.failed} excluded: every run failed)` : ""),
    `- Cited in every run: **${s.citedAlways}/${s.queries}**`,
    `- Cited in at least one run: **${s.citedEver}/${s.queries}**`,
    `- Mean mention rate: **${pct(s.meanMentionRate)}**`,
    `- Mean citation rate: **${pct(s.meanCitationRate)}**`,
    `- Queries that gave different answers across runs: **${s.flapped}/${s.queries}**`,
  ].join("\n");
}

export function toMarkdown(a: Audit): string {
  const flappedTotal = a.results.filter((r) => r.flapped).length;
  const failed = a.results.filter((r) => r.completed === 0).length;

  const lines = [
    `# AEO audit — ${a.brand}`,
    "",
    `Measured ${a.startedAt.slice(0, 10)} · ${a.market.location_name} / ${a.market.language_code} · ` +
      `engines: ${a.engines.join(", ")} · ${a.runs} runs per query · ` +
      `${a.results.reduce((n, r) => n + r.completed, 0)} API calls, $${a.totalCostUsd.toFixed(4)}`,
    "",
    "## Branded queries",
    "",
    classBlock(a, "branded"),
    "",
    "## Unbranded queries",
    "",
    classBlock(a, "unbranded"),
    "",
    "## Stability",
    "",
    `${flappedTotal} of ${a.results.length} query/engine pairs returned a different ` +
      `outcome across ${a.runs} identical runs.`,
    failed > 0 ? `\n${failed} pair(s) failed every run and are excluded from all rates above.` : "",
    "",
    "## Per query",
    "",
    queryTable(a.results),
    "",
    "## Most cited domains across all answers",
    "",
    a.topCitedHosts.length
      ? ["| Domain | Answers citing it |", "|---|---|", ...a.topCitedHosts.map((h) => `| ${h.host} | ${h.count} |`)].join("\n")
      : "_No citations returned._",
    "",
  ];

  return lines.filter((l) => l !== "").join("\n") + "\n";
}

export function toJson(a: Audit): string {
  return JSON.stringify(a, null, 2) + "\n";
}
