// Audit configuration: a brand, the domains that count as "its own", the
// competitors worth naming, and the queries — each labelled branded or unbranded.
//
// The branded/unbranded label is the whole point of the file. Everything else
// is plumbing. See README, "Why the branded/unbranded split matters".

export type QueryClass = "branded" | "unbranded";

export type Entity = {
  /** Display name, matched case-insensitively against the answer text. */
  name: string;
  /** Bare host, no scheme, no path. Used for citation matching. */
  domain: string | null;
  /** True for the audited brand and its sub-brands, false for competitors. */
  isBrand: boolean;
  /** Extra spellings. Entries shorter than 3 characters are ignored — see measure.ts. */
  variants?: string[];
};

export type Query = { q: string; class: QueryClass };

export type Engine = "chatgpt" | "perplexity";

export type Config = {
  brand: Entity;
  competitors: Entity[];
  /** Additional own properties (docs subdomain, help centre, YouTube channel …). */
  ownDomains?: string[];
  market: { location_name: string; language_code: string };
  engines: Engine[];
  /** Repeats per query per engine. >1 turns non-determinism into a measured range. */
  runs: number;
  queries: Query[];
};

const bareHost = (s: string) =>
  s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Parse and validate a config file. Throws with a message a human can act on. */
export function loadConfig(raw: unknown): Config {
  const c = raw as Partial<Config>;
  const fail = (msg: string) => {
    throw new Error(`config: ${msg}`);
  };

  if (!c.brand?.name) fail("brand.name is required");
  if (!Array.isArray(c.queries) || c.queries.length === 0) fail("queries must be a non-empty array");

  for (const [i, q] of (c.queries ?? []).entries()) {
    if (!q?.q) fail(`queries[${i}].q is empty`);
    if (q.class !== "branded" && q.class !== "unbranded") {
      fail(`queries[${i}].class must be "branded" or "unbranded", got ${JSON.stringify(q?.class)}`);
    }
  }

  const engines = (c.engines?.length ? c.engines : ["chatgpt"]) as Engine[];
  for (const e of engines) {
    if (e !== "chatgpt" && e !== "perplexity") fail(`unknown engine ${JSON.stringify(e)}`);
  }

  const runs = Number(c.runs ?? 5);
  if (!Number.isInteger(runs) || runs < 1) fail(`runs must be an integer >= 1, got ${c.runs}`);

  return {
    brand: { ...c.brand!, isBrand: true, domain: c.brand!.domain ? bareHost(c.brand!.domain) : null },
    competitors: (c.competitors ?? []).map((e) => ({
      ...e,
      isBrand: false,
      domain: e.domain ? bareHost(e.domain) : null,
    })),
    ownDomains: [
      ...(c.brand!.domain ? [bareHost(c.brand!.domain)] : []),
      ...(c.ownDomains ?? []).map(bareHost),
    ],
    market: {
      location_name: c.market?.location_name ?? "United States",
      language_code: c.market?.language_code ?? "en",
    },
    engines,
    runs,
    queries: c.queries!,
  };
}
