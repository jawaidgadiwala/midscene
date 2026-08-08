---
name: midscene-cli-provider
description: |
  Run Midscene UI automation billed to a coding-agent CLI subscription instead of an API key, via the claude:// or codex:// model providers.

  Use this skill when the user wants to:
  - Run Midscene without an ANTHROPIC_API_KEY or OPENAI_API_KEY
  - Bill UI automation to their Claude Code or Codex subscription
  - Write or run Midscene YAML test suites
  - Debug "Default model family is required for locate"
  - Debug a Midscene provider that will not start or times out

  Covers configuration, YAML authoring, running suites, and reading results.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Midscene via a CLI provider

Midscene normally calls a model over HTTP with an API key. Two providers instead
shell out to a coding-agent CLI that is already signed in, so calls are billed to
that subscription and no key appears in any config.

| Provider | CLI | Transport |
|---|---|---|
| `claude://` | Claude Code | spawns `claude -p` per call, in a temp dir |
| `codex://` | OpenAI Codex | one long-lived `codex app-server` connection |

> **Both providers require `MIDSCENE_MODEL_FAMILY`.** Without it every
> locate-driven action (`aiTap`, `aiHover`, …) fails immediately with
> *"Default model family is required for locate"*. This is the single most
> common setup failure. Set it before anything else.

## Step 1: Pick a provider and check the CLI is signed in

```bash
claude --version   # for claude://
codex --version    # for codex://
```

If the binary is missing or not signed in, stop and tell the user — no
configuration will make the provider work until then.

## Step 2: Write the env file

Never put these in a committed file if the repo is public. A local `.env` (which
Midscene loads automatically) or a gitignored `*.env` is fine.

Claude Code:

```bash
MIDSCENE_MODEL_BASE_URL=claude://opus
MIDSCENE_MODEL_NAME=claude-opus-5
MIDSCENE_MODEL_FAMILY=claude
MIDSCENE_MODEL_API_KEY=claude-cli-no-key-needed
```

Codex:

```bash
MIDSCENE_MODEL_BASE_URL=codex://app-server
MIDSCENE_MODEL_NAME=gpt-5.6-sol
MIDSCENE_MODEL_FAMILY=gpt-5
MIDSCENE_MODEL_API_KEY=codex-cli-no-key-needed
```

`MIDSCENE_MODEL_API_KEY` is required by Midscene's config plumbing but is never
sent anywhere by either provider. `MIDSCENE_MODEL_NAME` must name a model the
signed-in account can actually use.

For `claude://`, the part after the scheme is the model and accepts anything
`claude --model` accepts (`opus`, `sonnet`, a full model id). A bare `claude://`
lets the CLI choose.

## Step 3: Write the YAML suite

```yaml
web:
  url: https://example.com/
  viewportWidth: 1280
  viewportHeight: 900
  waitForNetworkIdle:
    timeout: 20000
    continueOnNetworkIdleError: true

tasks:
  - name: landing page loads
    flow:
      - sleep: 2000
      - aiAssert: the page has finished loading and shows readable content, not a blank screen or an error page

  - name: open sign in
    flow:
      - aiTap: the "Sign In" button in the top right header
      - sleep: 3000
      - aiQuery: >
          {heading: string, inputFields: string[], submitLabel: string}
        name: signin_summary
```

Rules that matter:

- Give every `aiQuery` a `name`. It becomes the key in the output JSON; without
  one the result is hard to read back.
- Describe elements by what a person sees, including position when the page
  repeats a label (`the "Sign In" button in the top right header`).
- Write assertions as full statements including the negative case
  (`…not a blank screen or an error page`). Bare `page loaded` passes on almost
  anything.
- Add `sleep` after navigation. These providers are slower than an HTTP model,
  and a screenshot taken mid-transition wastes a whole call.

## Step 4: Run

```bash
set -a && . ./claude-cli.env && set +a
npx midscene ./suite.yaml           # add --headed to watch the browser
```

Expect roughly 20-45s per suite of two or three model calls. `claude://` pays a
process spawn per call; `codex://` pays it once but is sensitive to the
`model_reasoning_effort` in `~/.codex/config.toml`.

Enable [caching](https://midscenejs.com/caching) for anything run repeatedly —
it replays the cached plan instead of re-planning, which removes almost all of
the per-call cost.

## Step 5: Read the results

| Path | Contents |
|---|---|
| `midscene_run/output/<suite>-<ts>.json` | `aiQuery` results and assertion verdicts |
| `midscene_run/report/<suite>-<ts>.html` | full run with screenshots per step |

Report the extracted data back to the user. A green exit code alone is not a
useful answer — the `aiQuery` output is the point.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Default model family is required for locate` | `MIDSCENE_MODEL_FAMILY` unset. See step 2. |
| `failed to start claude cli` | Binary not on `PATH`, or not signed in. Set `MIDSCENE_CLAUDE_CLI_PATH` if it is installed somewhere unusual. |
| Timeout | Raise `MIDSCENE_CLAUDE_CLI_TIMEOUT` (claude) or `MIDSCENE_MODEL_TIMEOUT` (codex). Both default to 600000 ms. |
| Assertion passes when it should not | The assertion is too vague. State what failure would look like. |
| Model has opinions about the repo | Only affects `codex://` — its thread inherits the process working directory, so a project `AGENTS.md` is in scope. `claude://` runs in a temp dir and is unaffected. |

Debug logs:

```bash
DEBUG=midscene:ai:call:claude-cli npx midscene ./suite.yaml
DEBUG=midscene:ai:call:codex      npx midscene ./suite.yaml
```

## Reference

- [Use the Claude CLI](https://github.com/jawaidgadiwala/midscene/blob/main/apps/site/docs/en/model-claude-cli.mdx)
- [Use the Codex CLI](https://github.com/jawaidgadiwala/midscene/blob/main/apps/site/docs/en/model-codex-cli.mdx)
