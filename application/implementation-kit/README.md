# Tested implementation starter

This directory contains reusable reference code and verification tools, not the finished application. Use it to save time in the Claude build session. No visual design work is included.

## Run now

```sh
node --test implementation-kit/*.test.mjs
python3 validate_prototype_data.py
```

Both use only the existing Node/Python runtime. The financial kernel uses BigInt; APIs use `toWire()` to produce decimal-string money. Functions have no authorization, database mutation or external side effects. The application command handler must provide those boundaries; calling a pure guard is not permission to move money.

For database execution, use a local installation of the pinned dependency:

```sh
npm install --no-save --package-lock=false @electric-sql/pglite@0.5.16
node scripts/verify-database.mjs
```

If the npm registry is unavailable, use the included optional bootstrap. It downloads only the pinned engine files from the npm CDN into this project's ignored `.cache`, verifying every file against the committed SHA-256 manifest. It does not disable TLS validation, install global software or alter the database schema.

```sh
python3 scripts/bootstrap-db-harness.py
node scripts/verify-database.mjs
```

Alternatively set `PGLITE_PACKAGE_DIR` to an already downloaded and verified package directory. The verifier creates temporary on-disk databases under the system temporary directory, executes the complete schema, imports each model fixture, runs assertions, closes/reopens for persistence proof, then removes only its own temporary directories. It never points at a production database. The seed importer refuses non-prototype mode and nonempty tables.

## Files and reuse boundaries

| File | Reuse |
|---|---|
| `domain.mjs` | Price, split, payment allocation, cumulative partial/full returns, guarantee coverage/cap, sale discount, recourse restriction, affordability and decision role |
| `domain.test.mjs` | Executable reference examples and adverse/property checks; preserve tests when wrapping or porting to TypeScript |
| `calendar.mjs` / `calendar.test.mjs` | Persian month anniversaries, short-month clamp with preserved anchor, leap/year boundaries, Tehran cutoff and business-day calendar |
| `seed.mjs` | Validated model fixture insertion, typed JSON encoding, deferred FKs and DRAFT→POSTED journal ordering; run on an isolated dedicated migration connection |
| `pglite-0.5.16-files.json` | Pinned SHA-256 integrity manifest for the optional database-test engine; third-party source remains externally downloaded and license preserved |
| `../scripts/verify-database.mjs` | Schema/fixture/constraint/role/persistence harness; not an HTTP or multi-process load test |

## Database evidence and local demo fallback

The reviewed harness uses PGlite 0.5.16, which reports PostgreSQL 18.6 in this run. It supports the schema's `btree_gist` extension and persisted Node filesystem storage. See the project's [extension documentation](https://pglite.dev/extensions/) and [API documentation](https://pglite.dev/docs/api). This permits actual SQL execution without requiring a PostgreSQL server installation for the prototype review.

PGlite on-disk storage is an approved local-prototype fallback when a server/Docker is unavailable. Each model owns one process and one directory. Load each engine once server-side; never create a fresh in-memory DB per request. Use engine transaction callbacks to serialize commands and run the in-process job worker through the same transaction API. Do not use arbitrary `BEGIN`/`COMMIT` calls on a shared request connection, where requests could interleave. A `pg` server adapter can use an acquired dedicated client per transaction instead.

Set runtime role and model/tenant context transaction-locally from the authenticated session; reset automatically at transaction completion. Never leave an administrator role or previous user's settings on a reused connection. Seed/migration uses a distinct owner context before serving HTTP requests. Row-level model/tenant policies supplement, and do not replace, customer/creditor/mandate checks in repositories.

Production continues to require server PostgreSQL, concurrent connection/race tests, restore/operations evidence and the legal/banking release bundle. Embedded SQL execution does not certify live external integrations or the browser application.

## Commands that still need an application

`pnpm dev:model1` through `dev:model4`, HTTP authorization, durable application workers, signed adapter callbacks and browser end-to-end tests are build requirements in CLAUDE.md. They have not been implemented by this starter. Do not label the future app complete merely because this kit's tests pass.
