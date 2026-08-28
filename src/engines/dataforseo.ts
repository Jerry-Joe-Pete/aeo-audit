// DataForSEO is the gateway to every engine here. One credential covers ChatGPT,
// Perplexity and Google AI Overviews, which is why this tool talks to it instead
// of to each provider directly. The trade-off is stated plainly in the README:
// you need a DataForSEO account to run this at all.
//
// Endpoint: POST /v3/ai_optimization/{engine}/llm_responses/live
// Auth:     Basic, base64("login:password") in DATAFORSEO_AUTH_B64

import type { Citation } from "../measure.ts";
import type { Engine } from "../config.ts";

const BASE = "https://api.dataforseo.com/v3";
const TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;

const MODELS: Record<Engine, { path: string; model: string }> = {
  chatgpt: { path: "chat_gpt", model: "gpt-5-mini" },
  perplexity: { path: "perplexity", model: "sonar" },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LlmAnswer = {
  content: string;
  citations: Citation[];
  model: string;
  cost: number;
};

/**
 * Errors carry the failing endpoint, the DataForSEO status code and the next
 * step. An agent calling this through the MCP server has to be able to recover
 * from the message alone — see AGENT-NOTES.md.
 */
export class DataForSeoError extends Error {
  // Declared explicitly rather than as a constructor parameter property:
  // parameter properties emit code, and Node's type stripping only erases.
  hint: string;

  constructor(message: string, hint: string) {
    super(`${message}\n  → ${hint}`);
    this.name = "DataForSeoError";
    this.hint = hint;
  }
}

function authHeader(): string {
  const auth = process.env.DATAFORSEO_AUTH_B64;
  if (!auth) {
    throw new DataForSeoError(
      "DATAFORSEO_AUTH_B64 is not set.",
      'Set it to base64("login:password") from your DataForSEO account. ' +
        "Copy .env.example to .env and fill it in, or export the variable.",
    );
  }
  return `Basic ${auth.trim()}`;
}

// Retry only what can succeed on a second try: network faults, 5xx, 429, and
// DataForSEO task codes >= 50000 (their internal errors). Every 4xx is a
// caller mistake and retrying it just burns time and quota.
// Task code 40501 "No Search Results" is an empty answer, not a failure.
async function call(path: string, task: Record<string, unknown>): Promise<{ result: unknown; cost: number }> {
  let detail = "";
  let hint = "Check https://docs.dataforseo.com/v3/ai_optimization/overview/ for the endpoint contract.";

  // Resolved once, outside the loop. A missing credential is not a transient
  // fault and must not be retried — it would turn one clear error into three.
  const auth = authHeader();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1500 * 2 ** (attempt - 1));

    let retryable = true;
    try {
      const r = await fetch(`${BASE}/${path}`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const j = (await r.json().catch(() => null)) as any;
      const t = j?.tasks?.[0];

      if (r.ok && t && t.status_code < 40000) {
        return { result: t.result?.[0] ?? null, cost: Number(j?.cost ?? 0) };
      }
      if (t?.status_code === 40501) return { result: null, cost: Number(j?.cost ?? 0) };

      if (r.status === 401) {
        hint = "DATAFORSEO_AUTH_B64 was rejected. Re-encode base64(\"login:password\") — note the colon.";
        retryable = false;
      } else if (r.status === 402 || t?.status_code === 40200) {
        hint = "Your DataForSEO balance is exhausted. Top it up, then re-run.";
        retryable = false;
      } else {
        retryable = r.status >= 500 || r.status === 429 || (t?.status_code ?? 0) >= 50000;
      }
      detail = `http=${r.status} task=${t?.status_code ?? "-"} ${t?.status_message ?? ""}`.trim();
    } catch (e) {
      detail = `fetch failed: ${e}`;
      hint = "Network or timeout. The request is idempotent — safe to re-run.";
    }

    if (!retryable) break;
  }

  throw new DataForSeoError(`${path}: ${detail}`, hint);
}

// The response nests text and citations inside message sections. Citations live
// as annotations on the section, NOT in the text — they cannot be recovered by
// parsing the prose, which is why the raw answer is kept alongside.
function parse(result: any): { content: string; citations: Citation[]; model: string } {
  const text: string[] = [];
  const citations: Citation[] = [];

  const hasMessages = (o: any) =>
    Array.isArray(o?.items) && o.items.some((i: any) => i?.type === "message");
  const root = hasMessages(result) ? result : (result?.items?.[0] ?? result);

  for (const item of root?.items ?? []) {
    if (item?.type !== "message") continue;
    for (const sec of item.sections ?? []) {
      if (sec?.text) text.push(sec.text);
      for (const a of sec?.annotations ?? []) {
        if (a?.url) citations.push({ url: a.url, title: a.title ?? null });
      }
    }
  }

  return {
    content: text.join("\n\n"),
    citations,
    model: root?.model_name ?? result?.model_name ?? "",
  };
}

export async function ask(engine: Engine, prompt: string): Promise<LlmAnswer> {
  const { path, model } = MODELS[engine];
  const { result, cost } = await call(`ai_optimization/${path}/llm_responses/live`, {
    user_prompt: prompt,
    model_name: model,
    web_search: true,
  });
  const p = parse(result);
  return { content: p.content, citations: p.citations, model: p.model || model, cost };
}

/** Fail before the first API call if the environment is not set up. */
export function assertCredentials(): void {
  authHeader();
}
