'use strict';
// ── TUKUK-OS /alat/kamus — Dictionary + translation proxy (FREE, no API key) ──
// Two keyless open sources back the human-language side of the tool:
//   • Free Dictionary API (api.dictionaryapi.dev) — monolingual definitions, phonetics
//     and a spoken-audio URL for the languages it holds (English richest, several others).
//   • MyMemory (api.mymemory.translated.net) — machine translation across ~50 languages.
// Both are anonymous and rate-limited, so every answer is cached here (definitions a day,
// translations a few hours) with the same {data, expiresAt} + stale-serving pattern as
// src/muzik.js, and the axios instance carries the outbound circuit-breaker (attachGuard):
// one slow or dead upstream call costs a short cooldown, never a queued request per visitor.
// The playful "languages" (animal / alien / sound / ancient scripts) are pure client-side
// encoders in public/kamus.js and never touch this module.
const axios = require('axios');
const { attachGuard } = require('./outbound');

const http = axios.create({
  timeout: 9000,
  headers: { 'User-Agent': 'TukukOS-Kamus-Client/1.0 (+https://tukuk.org)' },
});
attachGuard(http, { name: 'kamus', budgetMs: 6000 });

const DICT_URL = 'https://api.dictionaryapi.dev/api/v2/entries';
const MT_URL = 'https://api.mymemory.translated.net/get';

const DEF_TTL = 24 * 60 * 60 * 1000;   // a word's meaning is not going anywhere today
const TR_TTL = 6 * 60 * 60 * 1000;     // machine translations of a fixed phrase are stable enough

const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
  if (cache.size > 500) {                 // bounded: drop the entry that expires soonest
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// A lookup code is 2-5 letters (ISO 639-1/2/3); anything else is refused before the call.
function normLang(code) {
  const c = String(code || '').trim().toLowerCase();
  return /^[a-z]{2,5}$/.test(c) ? c : 'en';
}

// ── Definitions (Free Dictionary API) ──
async function define(word, lang) {
  const w = String(word || '').trim().slice(0, 64);
  const l = normLang(lang);
  if (!w) return { found: false, word: '', lang: l };
  const key = `def:${l}:${w.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  if (hit && hit.stale) { fetchDefine(key, l, w).catch(() => {}); return hit.data; }
  return fetchDefine(key, l, w);
}
async function fetchDefine(key, lang, word) {
  try {
    const res = await http.get(`${DICT_URL}/${lang}/${encodeURIComponent(word)}`);
    const entries = Array.isArray(res.data) ? res.data : [];
    const first = entries[0] || {};
    const phon = first.phonetic
      || (Array.isArray(first.phonetics) && first.phonetics.find((p) => p && p.text) || {}).text
      || '';
    const audio = (Array.isArray(first.phonetics) && first.phonetics.find((p) => p && p.audio) || {}).audio || '';
    const meanings = (Array.isArray(first.meanings) ? first.meanings : []).map((m) => ({
      partOfSpeech: String(m.partOfSpeech || ''),
      defs: (Array.isArray(m.definitions) ? m.definitions : []).slice(0, 4).map((d) => ({
        def: String(d.definition || ''),
        example: String(d.example || ''),
      })).filter((d) => d.def),
    })).filter((m) => m.defs.length);
    const value = { found: meanings.length > 0, word: String(first.word || word), lang, phonetic: phon, audio, meanings };
    cacheSet(key, value, DEF_TTL);
    return value;
  } catch (err) {
    if (err.response && err.response.status === 404) {   // not held → a clean "no entry", cached so we don't re-probe
      const value = { found: false, word, lang };
      cacheSet(key, value, DEF_TTL);
      return value;
    }
    const h = cacheGet(key);
    if (h) return h.data;                                // stale beats an error page
    throw err;
  }
}

// ── Translation (MyMemory) ──
async function translate(text, from, to) {
  let s = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const src = normLang(from);
  const dst = normLang(to);
  if (!s) return { ok: false, error: 'empty' };
  if (src === dst) return { ok: true, text: s, src, dst, detected: src, cached: false };
  const key = `tr:${src}:${dst}:${s.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return { ...hit.data, cached: true };
  if (hit && hit.stale) { fetchTranslate(key, s, src, dst).catch(() => {}); return { ...hit.data, cached: true }; }
  return fetchTranslate(key, s, src, dst);
}
async function fetchTranslate(key, text, from, to) {
  try {
    const res = await http.get(MT_URL, { params: { q: text, langpair: `${from}|${to}` } });
    const data = res.data || {};
    const status = Number(data.responseStatus || data.responseDetails || 0);
    const translated = data.responseData && data.responseData.translatedText;
    // MyMemory answers HTTP 200 even on a quota/refusal; the real signal is responseStatus.
    if (!translated || (status && status >= 400)) {
      const h = cacheGet(key);
      if (h) return h.data;
      const e = new Error('translate refused'); e.upstream = true; throw e;
    }
    const value = {
      ok: true,
      text: String(translated),
      src: from,
      dst: to,
      detected: (data.match && data.match.length && data.match[0].translation) ? from : from,
      chars: text.length,
    };
    cacheSet(key, value, TR_TTL);
    return { ...value, cached: false };
  } catch (err) {
    const h = cacheGet(key);
    if (h) return { ...h.data, cached: true };           // stale beats an error page
    throw err;
  }
}

module.exports = { define, translate, normLang };
