# aeo-audit

**Linear is named in 56 of 58 AI answers about its own market. Its domain is cited
in 18. And "what is Linear app" — the least contested query it has — returned a
citation to linear.app in 1 of 5 identical runs.**

Measured 28 August 2026 · ChatGPT `gpt-5-mini` with live web search · United
States / `en` · 12 queries × 5 runs · 58 completed calls · $0.67.

---

## Why the branded/unbranded split matters

An answer engine asked "what is Linear app" should be a free win — the brand owns
its own name and there is nowhere else for the model to go. Asked "best issue
tracker for software teams" it has the whole market to choose from, and that is
the query a buyer types before they know who to buy from. Averaging the two
produces a number dominated by queries the brand was never at risk of losing.

So the split is worth measuring. What this audit found is that for Linear it
barely moves the citation rate: **9 of 25 branded answers cite linear.app, and 9
of 33 unbranded ones.** 36% against 28%. The gap most AEO reporting is built to
reveal is, here, close to noise.

Two things that did move, sharply:

**Mention and citation are not the same measurement.** Linear is named in 97% of
answers and cited in 31%. A blended "visibility score" that counts either one
would report this brand as dominant. It is dominant in the prose and absent from
two thirds of the source lists.

**The measurement is unstable.** 8 of 12 query/engine pairs returned a different
outcome across 5 identical runs. That is the finding that governs every other
number on this page.

## Methodology

- **Engine** — ChatGPT (`gpt-5-mini`) with live web search, reached through the
  DataForSEO AI Optimization API. Perplexity (`sonar`) is supported by the tool
  and was left out of this audit: adding a second engine doubles the cost and the
  stability result below was already unambiguous on one.
- **Queries** — 12 in the example audit: 5 branded, 7 unbranded.
- **Repeats** — 5 runs per query. 60 calls attempted, 58 completed; two runs of
  one query failed on a network fault and are excluded rather than counted as
  zero, which is why that query reports 3 runs and not 5.
- **Market** — United States, `en`. Answer engines are market-sensitive; a
  German-market audit of the same brand is a different measurement, not a
  refinement of this one.
- **Mention** — the brand name, or a configured spelling variant, appears in the
  answer prose. Matched on Unicode word boundaries, so `linearity` does not
  count as `Linear`.
- **Citation** — a domain in the answer's source list is the brand's own domain
  or a subdomain of it. Citations are read from the response's structured
  annotations, not parsed out of the prose.
- **Rank** — position of the brand among all detected entities, by first
  appearance in the answer.

Mention and citation are measured separately and reported separately. A brand
can be discussed at length and cited zero times, and the reverse also happens.

## Limits of the method

**Read this before quoting any number above.**

**One measurement is not a trend.** Every figure here is a single point in time.
Answer engines re-rank continuously as their search index shifts. A number from
last month and a number from today are two observations, not a movement.

**The same question does not get the same answer.** This is not a caveat, it is
the main result: **8 of 12** query/engine pairs returned a *different* outcome
across 5 identical runs. "what is Linear app" cited linear.app once in five
attempts. A single run of that query has a two-in-three chance of telling you the
brand is not cited for its own name, and a one-in-five chance of the opposite. That is why `runs` defaults to 5
and why the report carries a stability count. Any AEO figure published from a
single run — including every screenshot of a single ChatGPT answer — has an
error bar its author did not measure.

**Live search makes runs non-comparable in a stricter sense.** With web search
on, two runs minutes apart may retrieve different pages. The variance measured
here therefore mixes model sampling and retrieval drift, and this tool cannot
separate the two.

**Twelve queries are a probe, not a market.** The unbranded set was chosen by
hand, before any result was seen. A different plausible set would produce different numbers. Nothing here
supports a claim about "share of AI search" — only about these queries.

**One engine is not the market.** No Perplexity in this run, and no Gemini,
Claude, Copilot or Google AI Overviews at all. Coverage is what DataForSEO
exposes, and the numbers above describe ChatGPT only.

**58 runs do not make 31% a precise figure.** With this sample the aggregate
citation rate carries roughly ±6 percentage points of sampling error before any
retrieval drift is counted. The 36%/28% branded-versus-unbranded difference is
inside that band — which is exactly why it is reported as "close to noise" above
and not as a gap.

**Citation ≠ influence.** Being cited is not being recommended. This tool counts
citations and mentions; it does not read tone, and a mention can be unfavourable.

**Entity matching has a floor.** Name matching is string-based. A brand
discussed purely by description — "the fast keyboard-driven tracker" — is
invisible to it.

What the numbers *can* support: a comparison between branded and unbranded
performance for one brand, at one time, on one query set, with a stated error
bar. That is a narrower claim than most AEO reporting makes, and it is the
reason this section is the longest in the file.

## Running it against your own brand

**Prerequisite: a DataForSEO account.** This tool reaches every engine through
DataForSEO's AI Optimization API rather than calling OpenAI and Perplexity
directly. One credential covers ChatGPT, Perplexity and Google AI Overviews, and
it returns citation annotations in a single shape. The cost is that you cannot
run this with just an OpenAI key. That is a deliberate trade and the reason it
is stated here rather than three sections down.

No install step and no dependencies — Node 22.6+ strips the TypeScript at load.

```bash
git clone https://github.com/Jerry-Joe-Pete/aeo-audit
cd aeo-audit
cp .env.example .env      # add base64("login:password")
node src/cli.ts examples/linear.config.json
```

To audit your own brand, copy the example config, change the brand and domain,
and replace the queries. Keep the `branded`/`unbranded` labels honest — a query
containing your brand name is branded, whatever its intent.

```bash
node src/cli.ts my-brand.config.json --runs 3
```

Expected output: a Markdown report on stdout, plus `out/<name>.results.json`
and `out/<name>.results.md`. Progress goes to stderr, so `> report.md` gives a
clean file.

**Cost.** $0.0157 per call, measured, not estimated. The example audit above was
58 calls for $0.67. The formula is queries × engines × runs.

`--runs 1` makes a 12-query audit 12 calls instead of 60, for about $0.19. It
also removes the stability number, which on this evidence is the most useful
thing the tool produces.

## Use from an agent loop

```json
{
  "mcpServers": {
    "aeo-audit": {
      "command": "node",
      "args": ["/absolute/path/to/aeo-audit/mcp/server.ts"],
      "env": { "DATAFORSEO_AUTH_B64": "..." }
    }
  }
}
```

Two tools. `aeo_check_query` is one API call against one query — the cheap probe.
`aeo_run_audit` takes a full config and returns the Markdown report.

```json
{
  "name": "aeo_check_query",
  "arguments": {
    "query": "best issue tracker for software teams",
    "brand": "Linear",
    "domain": "linear.app",
    "competitors": ["Jira", "Asana", "Notion"]
  }
}
```

Returns `brandMentioned`, `brandRank`, `brandCited`, `competitorsMentioned` and
`citedHosts`.

[AGENT-NOTES.md](AGENT-NOTES.md) has the transcripts: what each failure mode
returns and why the message is shaped that way.

## Example audit — Linear

Config: [examples/linear.config.json](examples/linear.config.json) · full output:
[examples/linear.results.json](examples/linear.results.json)

| Query | Class | Mentioned | Cited | Best rank | Stable |
|---|---|---|---|---|---|
| what is Linear app | branded | 5/5 | 1/5 | 1 | no |
| Linear vs Jira for software teams | branded | 5/5 | 0/5 | 1 | yes |
| Linear app pricing | branded | 5/5 | 5/5 | 1 | yes |
| is Linear good for issue tracking | branded | 5/5 | 2/5 | 1 | no |
| Linear app review | branded | 4/5 | 1/5 | 1 | no |
| best issue tracker for software teams | unbranded | 3/3 | 1/3 | 2 | no |
| fastest project management tool for engineers | unbranded | 4/5 | 1/5 | 1 | no |
| Jira alternatives for small engineering teams | unbranded | 5/5 | 2/5 | 2 | no |
| how to track bugs and features in one tool | unbranded | 5/5 | 0/5 | 2 | yes |
| best sprint planning software 2026 | unbranded | 5/5 | 1/5 | 2 | no |
| lightweight issue tracker with keyboard shortcuts | unbranded | 5/5 | 4/5 | 1 | no |
| project management tool startups actually use | unbranded | 5/5 | 0/5 | 1 | yes |

| Domain | Answers citing it |
|---|---|
| linear.app | 18 |
| clickup.com | 8 |
| jetbrains.com | 8 |
| stackfyi.com | 7 |
| reddit.com | 6 |
| shortcut.com | 6 |
| github.com | 4 |
| atlassian.com | 4 |
| thedigitalprojectmanager.com | 3 |
| docs.gitlab.com | 3 |

**Interpretation.** Linear owns the conversation and not the sources. It is named
in 56 of 58 answers, ranked first in every branded answer and first or second in
every unbranded one — but its own domain appears in 18. The answers about Linear
are largely built from ClickUp's, JetBrains' and Reddit's pages, plus an
aggregator (`stackfyi.com`) that outranks Atlassian here.

The two stable results are the interesting ones. "Linear app pricing" cited
linear.app in 5 of 5 runs: for a hard fact about the product, the vendor page is
the only source worth using. "Linear vs Jira for software teams" cited it in 0 of
5, every time preferring third-party comparisons — the model treats the vendor as
an unsuitable source for a verdict about itself. That is a content gap with an
obvious owner, and it is invisible to any tool that measures mentions.

Everything else moved between runs. On this evidence, a one-shot AEO screenshot
of any of these queries is not a measurement.

## Who built this

Seliem Attia — SEO/GEO practitioner working out of the German/Swiss border
region, mostly on AI search visibility and the measurement problem behind it.

seliemattia@proton.me
