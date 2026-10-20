#!/usr/bin/env python3
"""Bulk-append every real UNESCO World Heritage site from the official
whc.unesco.org XML list (1273 rows) into src/warisan-data.json, matching each
with its English Wikipedia article title via Wikidata P757 (join by UNESCO
id_number). Only honest, authoritative facts are used: name, wiki, country,
continent, lat/lng, type. Existing entries are kept and new duplicates are
skipped (by slug AND case-insensitive wiki)."""
import json, re, sys
from urllib.parse import unquote

# ── ISO 3166-1 alpha-2 → tukuk-os region bucket ─────────────────────────────
AFRICA = set("dz ao bj bw bf bi cm cf td km cg cd ci eg gq er et ga gm gn gw ke ls lr ly mg mw ml mr mu ma mz na ne ng rw st sn sc sl so za ss sd sz tz tg tn ug eh zm zw".split())
AMERICAS = set("ag ai bl bo br bb bz ca cl co cr cu dm do ec gd gf gl gp gt gy hn ht jm kn kc lc mf mq ni pa pe pm pr sv sx tt us uy vc ve".split())
ASIA = set("af am az bd bh bt bn kh cn hk in id ir iq il jp jo kg kr kp kw la lb mn mm np om ph pk ps qa sa sg sy th tj tl tm tr ae uz vn ye".split())
OCEANIA = set("as au ck fj fm gu ki mh nr nc nz nu pf pg pn sb tk to tv vu wf ws".split())
EUROPE = set("ad al at ax be bg by ch cy cz de dk ee es fi fo fr gb ge gr hr hu ie is it li lt lu lv mc md me mk mt nl no pl pt ro rs ru se si sk sm ua va xk".split())

def iso_to_region(iso):
    iso = iso.lower()
    if iso in AFRICA: return "Africa"
    if iso in AMERICAS: return "Americas"
    if iso in ASIA: return "Asia"
    if iso in OCEANIA: return "Oceania"
    if iso in EUROPE: return "Europe"
    return None

# ── slugifier mirrors warisan.js ────────────────────────────────────────────
import unicodedata
def slugify(name):
    s = name.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    # ASCII-transliterate chars NFD does not fold
    s = s.replace("\u0131","i").replace("\u00fe","th").replace("\u00f0","d")
    s = re.sub(r"[^a-z0-9]+","-",s)
    return s.strip("-")

# ── load existing data ──────────────────────────────────────────────────────
P = "src/warisan-data.json"
data = json.load(open(P, encoding="utf-8"))
existing_slugs = {slugify(s["name"]) for s in data}
existing_wikis_lc = {s["wiki"].lower() for s in data}
print("existing:", len(data))

# ── parse UNESCO XML ────────────────────────────────────────────────────────
raw = open("/tmp/whs.xml","r",encoding="utf-8",errors="ignore").read()
rows = re.findall(r"<row>(.*?)</row>", raw, re.S)
print("xml rows:", len(rows))

def tag(t, block):
    m = re.search(rf"<{t}>(.*?)</{t}>", block, re.S)
    return m.group(1).strip() if m else ""

# ── parse Wikidata P757 → enwiki map ────────────────────────────────────────
w = json.load(open("/tmp/wikimap.json"))
exact = {}    # p757 (no dash) → article title
dashed = {}   # base id → first component's article title
for b in w["results"]["bindings"]:
    p = b["p757"]["value"]
    art = b.get("article", {}).get("value")
    if not art: continue
    title = unquote(art.split("/wiki/",1)[1]).replace("_"," ")
    if "-" in p:
        base = p.split("-")[0]
        dashed.setdefault(base, title)
    else:
        exact[p] = title

# ── build new entries ───────────────────────────────────────────────────────
added = 0
skipped_dup = 0
skipped_no_iso = 0
skipped_no_coords = 0
for r in rows:
    idn = tag("id_number", r)
    site = tag("site", r)
    cat = tag("category", r)
    if not site or cat not in ("Cultural","Natural","Mixed"):
        continue
    m = re.search(r"<poi><latitude>([-\d.]+)</latitude><longitude>([-\d.]+)</longitude><iso2>(\w+)</iso2>", r)
    if not m:
        skipped_no_coords += 1
        continue
    lat = round(float(m.group(1)),4); lng = round(float(m.group(2)),4); iso = m.group(3)
    region = iso_to_region(iso)
    if not region:
        skipped_no_iso += 1
        continue
    # pick a country label (first in <states>)
    states = tag("states", r) or ""
    country = states.split(",")[0].strip() or iso.upper()
    # wiki lookup (prefer exact id, else dashed component)
    wiki = exact.get(idn) or dashed.get(idn) or site
    slug = slugify(site)
    if not slug:
        continue
    if slug in existing_slugs or wiki.lower() in existing_wikis_lc:
        skipped_dup += 1
        continue
    data.append({"name":site,"wiki":wiki,"country":country,"region":region,"lat":lat,"lng":lng,"type":cat})
    existing_slugs.add(slug); existing_wikis_lc.add(wiki.lower())
    added += 1

print(f"added: {added}  skipped_dup: {skipped_dup}  skipped_no_iso: {skipped_no_iso}  skipped_no_coords: {skipped_no_coords}  total: {len(data)}")

with open(P,"w",encoding="utf-8") as f:
    f.write("[\n")
    for i,s in enumerate(data):
        f.write(json.dumps(s,ensure_ascii=False))
        f.write(",\n" if i != len(data)-1 else "\n")
    f.write("]\n")
print("wrote", P)
