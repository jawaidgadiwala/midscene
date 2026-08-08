// Copies the fork's provider docs out of apps/site into this standalone site.
//
// apps/site stays the canonical home for these pages so they remain a clean
// upstream contribution. This site only republishes them, so nothing is
// authored twice.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(__dirname, '../../site/docs/en');
const TARGET_DIR = path.join(__dirname, '../docs');

const PAGES = ['model-claude-cli.mdx', 'model-codex-cli.mdx'];

// Pages that exist upstream but not here have to become absolute links.
const EXTERNAL_LINKS = {
  './caching.mdx': 'https://midscenejs.com/caching',
};

mkdirSync(TARGET_DIR, { recursive: true });

for (const page of PAGES) {
  const source = path.join(SOURCE_DIR, page);
  let content = readFileSync(source, 'utf-8');

  for (const [from, to] of Object.entries(EXTERNAL_LINKS)) {
    content = content.split(`(${from})`).join(`(${to})`);
  }

  const target = path.join(TARGET_DIR, page);
  writeFileSync(target, content);
  console.log(`synced ${page}`);
}

// The skill is the repo's own artifact; publish it verbatim.
const SKILL_SOURCE = path.join(
  __dirname,
  '../../../skills/midscene-cli-provider/SKILL.md',
);
const skill = readFileSync(SKILL_SOURCE, 'utf-8');
// Strip the agent frontmatter — it is machine metadata, not page content.
const body = skill.replace(/^---\n[\s\S]*?\n---\n/, '');
writeFileSync(path.join(TARGET_DIR, 'skill.md'), body);
console.log('synced SKILL.md -> skill.md');
