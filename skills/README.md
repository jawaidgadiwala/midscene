# Skills

[Agent Skills](https://github.com/anthropics/skills) shipped by this fork.

Upstream Midscene publishes platform-driving skills (browser, desktop, Android,
iOS, HarmonyOS) in a separate repository,
[web-infra-dev/midscene-skills](https://github.com/web-infra-dev/midscene-skills).
Those teach an agent to drive a device directly. The skill here is a different
job: configuring and running Midscene itself when the model is reached through a
coding-agent CLI rather than an API key.

| Skill | Covers |
|---|---|
| [`midscene-cli-provider`](./midscene-cli-provider/SKILL.md) | Running Midscene on a Claude Code or Codex subscription via the `claude://` and `codex://` providers — configuration, YAML authoring, running suites, reading results, troubleshooting. |

## Install

```bash
# Claude Code
npx skills add jawaidgadiwala/midscene --path skills -a claude-code
```

Or copy `skills/midscene-cli-provider/` into the agent's skills directory
directly — a skill is just a directory with a `SKILL.md`.

## See also

- [Use the Claude CLI](../apps/site/docs/en/model-claude-cli.mdx)
- [Use the Codex CLI](../apps/site/docs/en/model-codex-cli.mdx)
