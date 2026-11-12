'use strict';
// ==============================================================================
// export-content.js — a PORTABLE snapshot of the whole CMS content layer.
//
// It reads the live store (no app boot, no writes) and dumps, into
// generated/content-export/:
//   blog/<slug>.md   — every post (incl. drafts & scheduled) as readable Markdown
//                      with a full metadata header,
//   posts.json       — the raw post records, verbatim,
//   settings.json    — the runtime settings tree (ads/tag/UI toggles).
//
// Why: data/ is R2-backed hourly and content/*.md is in git, but that couples a
// restore to the running app. This export is human-readable and restorable on
// its own — the belt-and-braces "content backup" that runs daily before upload.
// ==============================================================================
const fs = require('fs');
const path = require('path');
const store = require('../src/store');

const OUT = path.join(__dirname, '..', 'generated', 'content-export');
const BLOG = path.join(OUT, 'blog');
fs.mkdirSync(BLOG, { recursive: true });

// getAllPostsAll → includes drafts + scheduled ones (a backup must be complete).
const posts = store.getAllPostsAll(100000);
const flat = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
const safeName = (s, fb) => String(s || fb).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fb;

for (const p of posts) {
  const slug = safeName(p.slug, p.id);
  const md = [
    `SLUG: ${flat(p.slug)}`,
    `TITLE: ${flat(p.title)}`,
    `EXCERPT: ${flat(p.excerpt)}`,
    `TAGS: ${(p.tags || []).join(', ')}`,
    `STATUS: ${p.status || 'published'}`,
    `PUBLISH_AT: ${p.publishAt || ''}`,
    `CREATED_AT: ${p.createdAt || ''}`,
    `UPDATED_AT: ${p.updatedAt || ''}`,
    `AUTHOR: ${flat(p.author)}`,
    '',
    p.content || '',
    '',
  ].join('\n');
  try { fs.writeFileSync(path.join(BLOG, `${slug}.md`), md); } catch (e) { console.error(`[export-content] skip ${slug}: ${e.message}`); }
}

const data = store.load();
fs.writeFileSync(path.join(OUT, 'posts.json'), JSON.stringify(posts, null, 2));
fs.writeFileSync(path.join(OUT, 'settings.json'), JSON.stringify((data && data.settings) || {}, null, 2));

const drafts = posts.filter((p) => p.status === 'draft').length;
console.log(`[export-content] ${posts.length} posts (${drafts} drafts) + settings → ${path.relative(process.cwd(), OUT)}`);
