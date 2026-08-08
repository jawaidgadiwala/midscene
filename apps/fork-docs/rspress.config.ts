import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rspress/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_URL = 'https://github.com/jawaidgadiwala/midscene';

// Project sites are served from a subpath (e.g. /midscene/ on GitHub Pages).
const SITE_BASE = process.env.SITE_BASE || '/';

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  base: SITE_BASE,
  outDir: 'doc_build',
  title: 'Midscene CLI Providers',
  description:
    'Run Midscene UI automation on a Claude Code or Codex subscription, with no API key.',
  lang: 'en',
  themeConfig: {
    outlineTitle: 'On this page',
    lastUpdated: true,
    socialLinks: [{ icon: 'github', mode: 'link', content: REPO_URL }],
    footer: {
      message:
        'A fork of <a href="https://github.com/web-infra-dev/midscene">Midscene</a> by ByteDance, MIT licensed. These pages document fork-only additions.',
    },
    nav: [
      { text: 'Claude CLI', link: '/model-claude-cli' },
      { text: 'Codex CLI', link: '/model-codex-cli' },
      { text: 'Agent Skill', link: '/skill' },
      { text: 'Midscene docs', link: 'https://midscenejs.com' },
    ],
    sidebar: {
      '/': [
        {
          text: 'Overview',
          link: '/',
        },
        {
          text: 'Providers',
          items: [
            { text: 'Use the Claude CLI', link: '/model-claude-cli' },
            { text: 'Use the Codex CLI', link: '/model-codex-cli' },
          ],
        },
        {
          text: 'Agent Skill',
          link: '/skill',
        },
      ],
    },
  },
});
