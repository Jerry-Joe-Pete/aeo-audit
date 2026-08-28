// Two measurements, deliberately kept apart:
//
//   mention  — the entity's name appears in the answer text
//   citation — the entity's domain appears in the answer's source list
//
// They are not the same thing and they do not move together. A brand can be
// described at length and cited zero times; a domain can be cited as a source
// while the brand is never named in the prose. Collapsing the two into one
// "visibility" number is the most common way these audits go wrong.

import type { Config, Entity } from "./config.ts";

// ── Text safety ───────────────────────────────────────────────────────────
// Slicing a string by UTF-16 code units can cut an emoji in half and leave a
// lone surrogate behind. That survives in memory but breaks JSON encoders.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitize(s: string): string {
  return s.replace(LONE_SURROGATE, "").replace(/\0/g, "");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Name matching ─────────────────────────────────────────────────────────
// ONE combined regex over every entity name, not one regex per entity. With a
// few dozen entities and answers a few thousand characters long, the per-entity
// loop is what blows the time budget — the combined alternation is a single pass.
//
// Word boundaries use \p{L}\p{N} rather than \b, because \b treats "ä" and "ß"
// as boundaries and would match "Sales" inside "Salesförderung".

export type Matcher = { re: RegExp; byNeedle: Map<string, Entity> };

export function buildMatcher(entities: Entity[]): Matcher | null {
  const byNeedle = new Map<string, Entity>();

  for (const e of entities) {
    const needles = [e.name, ...(e.variants ?? [])]
      .map((v) => v.trim())
      // Variants of 1–2 characters match inside unrelated words far too often.
      .filter((v) => v.length >= 3);

    for (const n of needles) {
      const key = n.toLowerCase();
      // First entity to claim a needle keeps it — ambiguous names resolve in
      // config order, which is at least predictable.
      if (!byNeedle.has(key)) byNeedle.set(key, e);
    }
  }

  if (byNeedle.size === 0) return null;

  // Longest alternative first, so a multi-word brand wins over the generic word
  // inside it: "Linear App" must match before "Linear".
  const alternation = [...byNeedle.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");

  return {
    re: new RegExp(`(^|[^\\p{L}\\p{N}])(${alternation})(?=$|[^\\p{L}\\p{N}])`, "giu"),
    byNeedle,
  };
}

export type Mention = { entity: Entity; index: number; context: string };

/** First occurrence per entity, ordered by position in the answer. */
export function findMentions(content: string, matcher: Matcher | null): Mention[] {
  if (!matcher) return [];
  const first = new Map<Entity, Mention>();
  matcher.re.lastIndex = 0;

  for (const m of content.matchAll(matcher.re)) {
    const entity = matcher.byNeedle.get(m[2].toLowerCase());
    if (!entity || first.has(entity)) continue;
    const index = (m.index ?? 0) + m[1].length;
    first.set(entity, {
      entity,
      index,
      context: sanitize(content.slice(Math.max(0, index - 40), index + 80))
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  return [...first.values()].sort((a, b) => a.index - b.index);
}

// ── Citation matching ─────────────────────────────────────────────────────
export type Citation = { url: string; title: string | null };

export function citedHosts(citations: Citation[]): string[] {
  const hosts: string[] = [];
  for (const c of citations) {
    try {
      hosts.push(new URL(c.url).hostname.toLowerCase().replace(/^www\./, ""));
    } catch {
      // A malformed citation URL is data, not a crash. Skip it.
    }
  }
  return hosts;
}

/** True if any cited host is, or is a subdomain of, one of the brand's own domains. */
export function isOwnCitation(hosts: string[], ownDomains: string[]): boolean {
  return hosts.some((h) => ownDomains.some((d) => h === d || h.endsWith(`.${d}`)));
}

// ── Per-answer scoring ────────────────────────────────────────────────────
export type AnswerScore = {
  brandMentioned: boolean;
  /** 1-based rank of the brand among all matched entities; null if not mentioned. */
  brandRank: number | null;
  brandCited: boolean;
  competitorsMentioned: string[];
  citedHosts: string[];
};

export function scoreAnswer(
  content: string,
  citations: Citation[],
  cfg: Config,
  matcher: Matcher | null,
): AnswerScore {
  const mentions = findMentions(sanitize(content), matcher);
  const brandIdx = mentions.findIndex((m) => m.entity.isBrand);
  const hosts = citedHosts(citations);

  return {
    brandMentioned: brandIdx >= 0,
    brandRank: brandIdx >= 0 ? brandIdx + 1 : null,
    brandCited: isOwnCitation(hosts, cfg.ownDomains ?? []),
    competitorsMentioned: mentions.filter((m) => !m.entity.isBrand).map((m) => m.entity.name),
    citedHosts: hosts,
  };
}
