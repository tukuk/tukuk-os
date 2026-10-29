#!/usr/bin/env bash
# r2-inventory.sh — what is inside the tukuk-fallback R2 bucket, and is it still free?
#
# R2 is the rung the failover brain serves FIRST during an outage (see
# deploy/GCP-FAILOVER.md), and Cloudflare's free R2 tier ends at **10 GB stored** + 1M
# Class A / 10M Class B operations per month. Nothing here is metered by egress — R2
# egress is free — so the only way this bucket costs money is by growing, or by being
# read an enormous number of times. This audit makes that visible instead of assumed.
#
# Read-only: it lists objects, it never writes or deletes.
#
#   bash scripts/r2-inventory.sh            # default bucket: tukuk-fallback
#   R2_BUCKET=other bash scripts/r2-inventory.sh
#
# Exit 1 when something breaks the free posture: bucket over 60% of the 10 GB ceiling, or
# a prefix whose keys are timestamped (so it can only grow).
#
# The API token is read from the repo .env, the environment, or wrangler's cached OAuth
# login, in that order. It is handed to curl on stdin only — never argv, never printed.
set -uo pipefail
cd "$(dirname "$0")/.."
BUCKET="${R2_BUCKET:-tukuk-fallback}"
ACC="${CLOUDFLARE_ACCOUNT_ID:-391d9aa59cfcc5ec44c3d25c855c45cb}"
CEILING_GB=10
WARN_GB=6

TOK="${CLOUDFLARE_API_TOKEN:-}"
[ -n "$TOK" ] || TOK=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .env 2>/dev/null | cut -d= -f2- | tr -d '"')
if [ -z "$TOK" ] && [ -f "$HOME/.config/.wrangler/config/default.toml" ]; then
  # the .env token is empty on some machines; wrangler's OAuth login works on the same API
  TOK=$(awk -F'"' '/^oauth_token/ {print $2; exit}' "$HOME/.config/.wrangler/config/default.toml")
fi
[ -n "$TOK" ] || { echo "no usable Cloudflare token (env, .env, or wrangler OAuth)"; exit 1; }

api() { # $1 = path under /accounts/$ACC
  printf 'Authorization: Bearer %s\n' "$TOK" \
    | curl -s -m 60 -H @- "https://api.cloudflare.com/client/v4/accounts/$ACC$1"
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "== R2 inventory: $BUCKET (account ${ACC:0:8}…, ceiling ${CEILING_GB} GB free)"
CUR=''
for page in $(seq 1 60); do
  if [ -z "$CUR" ]; then Q="objects?per_page=1000"; else Q="objects?per_page=1000&cursor=$CUR"; fi
  api "/r2/buckets/$BUCKET/$Q" > "$WORK/page.json"
  python3 - "$WORK" <<'PY' || exit 1
import json, sys, os
try:
    d = json.load(open(os.path.join(sys.argv[1], 'page.json')))
except Exception as e:
    print('  unreadable API response (%s): check the token and account id' % e)
    raise SystemExit(1)
if not d.get('success'):
    print('  API error: %s' % (d.get('errors'),))
    raise SystemExit(1)
with open(os.path.join(sys.argv[1], 'objects.jsonl'), 'a') as out:
    for o in (d.get('result') or []):
        out.write(json.dumps({'key': o.get('key'), 'size': int(o.get('size') or 0),
                              'class': o.get('storage_class'),
                              'modified': o.get('last_modified')}) + '\n')
ri = d.get('result_info') or {}
cur = ri.get('cursor', '') if ri.get('is_truncated') else ''
open(os.path.join(sys.argv[1], 'cursor'), 'w').write(cur or '')
PY
  CUR=$(cat "$WORK/cursor" 2>/dev/null || true)
  [ -z "$CUR" ] && break
done
echo "  pages_fetched=$page"

python3 - "$WORK" "$CEILING_GB" "$WARN_GB" "${DATED_CUTOFF:-2026-10-29}" "${SELF_PRUNING_DATED:-laptop-backup}" <<'PY'
import json, os, re, sys
work, ceiling, warn = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
cutoff, exempt = sys.argv[4], set(filter(None, sys.argv[5].split(',')))
path = os.path.join(work, 'objects.jsonl')
objs = [json.loads(l) for l in open(path) if l.strip()] if os.path.exists(path) else []
tot = sum(o['size'] for o in objs)
gb = tot / 1e9
print("  objects=%d  stored=%.2f GB  (%.1f%% of the %g GB free allowance)"
      % (len(objs), gb, gb / ceiling * 100, ceiling))

# A key is BOUNDED when the same key is rewritten (slot-<weekday><hour>, or a fixed name)
# and UNBOUNDED when it carries a date, so every run adds a new object.
dated = re.compile(r'(^|[/_.-])(20\d{2})[-/](\d{2})[-/](\d{2})|(20\d{6})T?\d{0,6}')
slots = {}
grown = {}
for o in objs:
    key = o['key'] or ''
    top = key.split('/')[0] or '(root)'
    if dated.search(key):
        e = grown.setdefault(top, [0, 0, ''])
    else:
        e = slots.setdefault(top, [0, 0, ''])
    e[0] += 1
    e[1] += o['size']
    e[2] = max(e[2], o.get('modified') or '')

def dump(title, table):
    print('  %s' % title)
    for p, (n, b, newest) in sorted(table.items(), key=lambda kv: -kv[1][1])[:16]:
        print('    %-24s objects=%-5d %8.2f MB  newest=%s' % (p, n, b / 1e6, newest[:10] or '-'))

dump('prefixes that are bounded (slot/fixed keys — overwritten, cannot grow):', slots)
print('  biggest objects:')
for o in sorted(objs, key=lambda o: -o['size'])[:10]:
    print('    %10d  %s' % (o['size'], (o['key'] or '?')[:64]))

problems = []
if gb > warn:
    problems.append('stored %.2f GB is over %.0f%% of the free ceiling' % (gb, warn / ceiling * 100))
if grown:
    print('  prefixes whose keys are DATE-STAMPED (one new object per run) — cutover was %s:' % cutoff)
    for p, (n, b, newest) in sorted(grown.items(), key=lambda kv: -kv[1][1]):
        tag = 'prunes itself' if p in exempt else ('STILL WRITING' if newest[:10] >= cutoff else 'frozen history')
        print('     %-24s objects=%-5d %8.2f MB  newest=%-10s %s' % (p, n, b / 1e6, newest[:10] or '-', tag))
        if p not in exempt and newest[:10] >= cutoff:
            problems.append('%s writes date-stamped keys after %s — unbounded growth'
                            % (p, cutoff))
    print('     Fix: write a slot key instead (scripts/backup-data.sh, backup-meili.sh do).')
print()
if problems:
    print('RESULT: ' + '; '.join(problems))
    raise SystemExit(1)
print('RESULT: free posture OK — %.1f%% of the 10 GB allowance, no unbounded writer.' % (gb / ceiling * 100))
PY
