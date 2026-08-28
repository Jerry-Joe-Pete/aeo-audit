# Notes for agents calling this server

This file exists because "good error messages" is easy to claim and easy to
check. Below are four real transcripts against `mcp/server.ts`, unedited.

The design rule they follow: **an error is only useful if the reader can act on
it without opening the source.** Every failure here names the offending field,
the legal values, and the next step.

## 1. Missing a required field

```json
→ {"method":"tools/call","params":{"name":"aeo_check_query","arguments":{"brand":"Linear"}}}
← isError: true
  Missing required field "query".
    → aeo_check_query needs query, brand and domain. Example:
      {"query":"best issue tracker for software teams","brand":"Linear","domain":"linear.app"}
```

The example is a complete, valid call — not a description of one. An agent can
copy it, substitute its own values and succeed on the second attempt.

## 2. Wrong enum value, nested three levels deep

```json
→ {"name":"aeo_run_audit","arguments":{"config":{"brand":{"name":"L","domain":"l.app"},
   "queries":[{"q":"a","class":"nope"}]}}}
← isError: true
  config: queries[0].class must be "branded" or "unbranded", got "nope"
    → Fix the config and call again.
```

The path `queries[0].class` is in the message. "Invalid config" would have
forced a guess across every field in the object.

## 3. Tool name typo

```json
→ {"name":"aeo_typo","arguments":{}}
← isError: true
  Unknown tool "aeo_typo".
    → Available: aeo_check_query, aeo_run_audit. Call tools/list for the schemas.
```

The recovery path is named. The agent does not have to know that `tools/list`
exists — it is told.

## 4. Environment not set up

```
  DATAFORSEO_AUTH_B64 is not set.
    → Set it to base64("login:password") from your DataForSEO account.
      Copy .env.example to .env and fill it in, or export the variable.
```

Checked once before the first request, not on request 1 of 60. An audit that
would fail on every call fails in 60 milliseconds instead of after three
retries per query.

## Choosing between the two tools

`tools/list` returns `aeo_check_query` first, and its description says it is the
cheap one — exactly one API call. `aeo_run_audit` states its cost in the
description as a formula plus a worked example (`14 queries × 1 engine × 5 runs
= 70 calls`). An agent exploring the surface has what it needs to avoid opening
with the expensive call.

Both tool descriptions say what the tool **returns**, not only what it does.
Return shape is what an agent actually selects on.

## Transport notes

- Newline-delimited JSON-RPC 2.0 over stdio. No SDK dependency.
- Tool failures come back as `tools/call` results with `isError: true`, never as
  JSON-RPC transport errors. A transport error aborts the agent's turn; a tool
  error is something it can read and retry.
- Unimplemented methods return `-32601` with the method name echoed back.
