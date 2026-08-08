# Midscene on a CLI subscription

[Midscene](https://midscenejs.com) normally calls a model over HTTP with an API
key. This fork adds a second route: shell out to a coding-agent CLI that is
already signed in, so calls are billed to that subscription and no key appears
in any config.

| Provider | CLI | Status |
| --- | --- | --- |
| [`claude://`](./model-claude-cli.mdx) | Claude Code | added by this fork |
| [`codex://`](./model-codex-cli.mdx) | OpenAI Codex | ships upstream, undocumented until now |

## Quick start

```bash
export MIDSCENE_MODEL_BASE_URL=claude://opus
export MIDSCENE_MODEL_NAME=claude-opus-5
export MIDSCENE_MODEL_FAMILY=claude
export MIDSCENE_MODEL_API_KEY=claude-cli-no-key-needed

npx midscene ./suite.yaml
```

`MIDSCENE_MODEL_FAMILY` is not optional. Without it every locate-driven action
fails with *"Default model family is required for locate"*, and the error does
not say which value to use. This is the most common setup failure for both
providers.

There is an [Agent Skill](./skill.md) that walks a coding agent through the
whole setup.

## Scope

These pages cover **only** what this fork adds. Everything else — the API
reference, platform guides, YAML syntax, caching — lives in the
[upstream Midscene documentation](https://midscenejs.com), which is the
authority and is not duplicated here.

Source: [github.com/jawaidgadiwala/midscene](https://github.com/jawaidgadiwala/midscene).
Chinese versions of both provider pages exist in the repository under
`apps/site/docs/zh/`.
