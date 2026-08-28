// Every query runs N times. That is the difference between this tool and a
// screenshot of one ChatGPT answer.
//
// A single run gives you a boolean: cited, or not. N runs give you a rate and,
// more importantly, a flap count — how many queries returned a different answer
// to the same question. That number is the honest headline of any AI-visibility
// audit, and it is the one nobody publishes.

import { ask, assertCredentials } from "./engines/dataforseo.ts";
import { buildMatcher, scoreAnswer, type AnswerScore } from "./measure.ts";
import type { Config, Engine, Query, QueryClass } from "./config.ts";

export type QueryResult = {
  query: string;
  class: QueryClass;
  engine: Engine;
  runs: number;
  /** Runs that returned an answer at all. Failures are excluded, never counted as 0. */
  completed: number;
  mentionRate: number;
  citationRate: number;
  /** True when the same query gave different answers across runs. */
  flapped: boolean;
  /** Best (lowest) brand rank observed; null if never mentioned. */
  bestRank: number | null;
  /** Domains cited instead, by frequency across all runs. */
  citedHosts: Record<string, number>;
  competitorsMentioned: Record<string, number>;
  /** Actual USD billed by the provider for this query's runs. */
  costUsd: number;
  errors: string[];
};

const rate = (hits: number, total: number) => (total === 0 ? 0 : hits / total);

async function runOne(
  cfg: Config,
  matcher: ReturnType<typeof buildMatcher>,
  query: Query,
  engine: Engine,
  onProgress?: (msg: string) => void,
): Promise<QueryResult> {
  const scores: AnswerScore[] = [];
  const errors: string[] = [];
  let cost = 0;

  for (let i = 0; i < cfg.runs; i++) {
    try {
      const answer = await ask(engine, query.q);
      cost += answer.cost;
      scores.push(scoreAnswer(answer.content, answer.citations, cfg, matcher));
      onProgress?.(`  ${engine} run ${i + 1}/${cfg.runs}  ${query.q.slice(0, 52)}`);
    } catch (e) {
      // One failed run must not discard the other four. Keep the whole message:
      // the second line carries the recovery hint and is the useful half.
      errors.push((e instanceof Error ? e.message : String(e)).slice(0, 400));
    }
  }

  const citedHosts: Record<string, number> = {};
  const competitorsMentioned: Record<string, number> = {};
  for (const s of scores) {
    for (const h of new Set(s.citedHosts)) citedHosts[h] = (citedHosts[h] ?? 0) + 1;
    for (const c of new Set(s.competitorsMentioned)) {
      competitorsMentioned[c] = (competitorsMentioned[c] ?? 0) + 1;
    }
  }

  const mentions = scores.filter((s) => s.brandMentioned).length;
  const cites = scores.filter((s) => s.brandCited).length;
  const ranks = scores.map((s) => s.brandRank).filter((r): r is number => r !== null);

  const mentionRate = rate(mentions, scores.length);
  const citationRate = rate(cites, scores.length);

  return {
    query: query.q,
    class: query.class,
    engine,
    runs: cfg.runs,
    completed: scores.length,
    mentionRate,
    citationRate,
    flapped:
      (mentionRate > 0 && mentionRate < 1) || (citationRate > 0 && citationRate < 1),
    bestRank: ranks.length ? Math.min(...ranks) : null,
    citedHosts,
    competitorsMentioned,
    costUsd: cost,
    errors,
  };
}

export type ClassSummary = {
  /** Queries that produced at least one usable answer. Rates are over these. */
  queries: number;
  /** Queries where every run failed. Excluded from every rate below. */
  failed: number;
  /** Queries where the brand was cited in EVERY completed run. */
  citedAlways: number;
  /** Queries where the brand was cited in at least one run. */
  citedEver: number;
  meanMentionRate: number;
  meanCitationRate: number;
  flapped: number;
};

export type Audit = {
  brand: string;
  domain: string | null;
  market: Config["market"];
  engines: Engine[];
  runs: number;
  /** Wall-clock start, ISO 8601. Supplied by the caller so results stay reproducible. */
  startedAt: string;
  totalCostUsd: number;
  results: QueryResult[];
  byClass: Record<QueryClass, ClassSummary>;
  topCitedHosts: Array<{ host: string; count: number }>;
};

function summarise(results: QueryResult[], cls: QueryClass): ClassSummary {
  const all = results.filter((r) => r.class === cls);
  // A query whose every run failed is missing data, not a 0% result. Averaging
  // it in as zero would quietly understate the brand and read as a finding.
  const rows = all.filter((r) => r.completed > 0);
  const n = rows.length;
  return {
    queries: n,
    failed: all.length - n,
    citedAlways: rows.filter((r) => r.citationRate === 1).length,
    citedEver: rows.filter((r) => r.citationRate > 0).length,
    meanMentionRate: n ? rows.reduce((s, r) => s + r.mentionRate, 0) / n : 0,
    meanCitationRate: n ? rows.reduce((s, r) => s + r.citationRate, 0) / n : 0,
    flapped: rows.filter((r) => r.flapped).length,
  };
}

export async function runAudit(
  cfg: Config,
  startedAt: string,
  onProgress?: (msg: string) => void,
): Promise<Audit> {
  // Fail now, not after the first of sixty calls.
  assertCredentials();

  const matcher = buildMatcher([cfg.brand, ...cfg.competitors]);
  const results: QueryResult[] = [];

  // Sequential on purpose. Parallel runs against the same endpoint invite rate
  // limiting, and a 20-query audit finishing in four minutes instead of one is
  // not a problem worth solving here.
  for (const engine of cfg.engines) {
    for (const query of cfg.queries) {
      results.push(await runOne(cfg, matcher, query, engine, onProgress));
    }
  }

  const hostTotals: Record<string, number> = {};
  for (const r of results) {
    for (const [h, c] of Object.entries(r.citedHosts)) hostTotals[h] = (hostTotals[h] ?? 0) + c;
  }

  return {
    brand: cfg.brand.name,
    domain: cfg.brand.domain,
    market: cfg.market,
    engines: cfg.engines,
    runs: cfg.runs,
    startedAt,
    totalCostUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    results,
    byClass: { branded: summarise(results, "branded"), unbranded: summarise(results, "unbranded") },
    topCitedHosts: Object.entries(hostTotals)
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
  };
}
