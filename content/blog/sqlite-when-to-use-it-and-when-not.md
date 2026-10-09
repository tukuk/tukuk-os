SLUG: sqlite-when-to-use-it-and-when-not
TITLE: SQLite Is Not a Toy: When One File Is the Right Database
EXCERPT: The default reflex is "spin up Postgres/MySQL". For a single app, a small team, or an edge workload, SQLite beats that — zero server, one file, real ACID, and boring in the best way.
TAGS: database, sqlite, backend, architecture

## The Wrong Assumption

People hear "SQLite" and think mobile apps and todo lists. But SQLite is the most-deployed database on earth, and for a **single service** it is often the *superior* choice to a client/server RDBMS. There is no separate process to install, secure, monitor, back up, or lose. The database **is** a file.

## What SQLite Is Genuinely Good At

- **Zero operational surface.** No daemon, no port to expose, no auth to misconfigure. `npm` install, open a file, done.
- **Real ACID transactions.** Reads-see-committed, atomic writes, crash-safe journaling (WAL mode). This is not "localStorage with extra steps".
- **Blazing reads.** Data is local; no network hop per query. With an index, lookups are microseconds.
- **Trivial backups & forking.** Copy one file. Branch the data by copying. Diff two files.
- **Embeddability.** Tests that need a real DB, CLI tools, per-user analytics files, an edge function's local cache.

## Where It Genuinely Stops

- **Write concurrency across many separate processes/hosts.** SQLite locks the *file* for writers. One writer at a time (though WAL lets readers run concurrently). Great for a single app; not for a fleet of app servers all hammering the same DB over NFS.
- **Scale-out.** There is no built-in replication/sharding. If you need horizontal app servers writing to a shared DB, that's a server RDBMS (or Postgres + connection pooling).
- **Very high concurrent write volume.** "Thousands of writes/sec from many clients" is the classic signal to graduate.

The dividing line is not "small vs big data" — it's **one writer-process (SQLite) vs many (client/server)**. A single Node app with an internal worker pool fits SQLite comfortably at surprising sizes (tens of GB, high read throughput).

## Doing It Right in Node

```js
// libsql / better-sqlite3 style: enable WAL once, per connection pool
db.exec('PRAGMA journal_mode = WAL;');   // concurrent readers, durable writers
db.exec('PRAGMA foreign_keys = ON;');     // enforced constraints
```

- **WAL mode** unless you need the simplest durability trade.
- **Prepared statements** for anything repeated — plan once, bind many.
- **Index your hot WHERE/ORDER columns;** measure with `EXPLAIN QUERY PLAN`.
- **Back up with the online backup API**, not `cp`, on a busy DB (a torn copy is worse than none).

## The Honest Migration Path

Start with SQLite. It will let you go further than you expect. When (not if) you outgrow one-writer scale, the SQL you wrote mostly moves to Postgres — the schema and queries survive; the *connection* changes. You have not wasted the choice; you've simply reached the part where a server DB earns its operational cost.

Choosing SQLite is not "settling for less". For a self-contained service, it's the calm, fast, zero-ops database that lets you ship.
