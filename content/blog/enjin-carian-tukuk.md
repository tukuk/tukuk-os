SLUG: enjin-carian-tukuk
TITLE: The Tukuk Search Engine — BM25, AI Reranking, and Short Answers
EXCERPT: Behind Tukuk's single search box sit three layers: probabilistic scoring, a neural reranker model, and answer generation — all without cookie tracking.
TAGS: search, bm25, ai, rerank, privacy

## One box, three layers

Tukuk-OS started as a search engine, and that is still its core. When you type something and press Enter, one request passes through several stages that are rarely visible:

**Layer 1 — BM25.** The classic probabilistic scorer from the 90s that is still the default inside Lucene and Elasticsearch. It scores term matches with weighting: rare terms (like "quality") contribute more than frequent ones ("and"), and excessive repetition is penalized so documents cannot game the ranking by repeating words. Fast and explainable.

**Layer 2 — Rerank.** The top BM25 candidates are then reordered by a small neural model that understands *semantics*, not just word overlap. This is what separates a "good" search from a "correct" one — a question like "why do eyes water" can return articles about tears even when not a single word matches.

**Layer 3 — Answer.** For suitable questions, the system reads the strongest snippet and generates one short, precise answer, complete with its sources. You get the core first, then the full results if you want to go deeper.

## Fast even offline

The most frequent search results are cached all the way to the edge. There is a lightweight index that works without a connection, and a service worker stores assets so the search page feels instant. Our principle: **feeling fast is a feature, not an accident** — Core Web Vitals are kept under control so that even when the server is slow, the interface stays responsive.

## Privacy by design

No accounts. No tracking cookies. No ad profiles built behind the scenes. Search history is stored locally and can be deleted at any time. We believe a good search engine does not need to watch you to be useful — it only needs to understand your question. That is what we chase in every release, and the reason Tukuk is built from scratch: full control means full responsibility for your data.
