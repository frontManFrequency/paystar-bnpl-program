# Validation report — bank-presentation handoff review

Date: 16 November 2026. Scope: source documentation, executable reference domain/calendar, complete SQL schema and synthetic fixtures. The browser application has not yet been implemented.

## Results actually observed

| Layer | Result | Evidence |
|---|---|---|
| Static document/API/data validator | PASS; 31,392 assertions, 99 API operations | [JSON result](implementation-kit/static-validation.json) |
| Financial and Persian-calendar reference code | PASS; 17 Node tests, zero failed/skipped | [Test output](implementation-kit/reference-test-results.txt) |
| SQL schema and all four seeds | PASS; 64 executed assertions in on-disk embedded PostgreSQL | [Database results](implementation-kit/database-validation.json) |
| Six operational diagrams | PASS; canonical structural/static lint, no diagnostics | [Source](../diagrams/flows.json), [diagrams](../DIAGRAMS.md) |

Static assertion count primarily measures field/reference coverage, not the number of end-to-end tests. Diagram lint does not claim acceptance by every Mermaid renderer.

## Executed database scope

Engine: PGlite 0.5.16 reporting PostgreSQL 18.6. The full schema ran unchanged with btree_gist. All four fixtures loaded using the reusable seed importer. Tests verified balanced legal-book journals, seed debt projections, posted journal/line immutability, amount constraints, overlapping ownership rejection, cross-model foreign-key rejection, one active check per checkout/installment, runtime-role model and tenant RLS, and on-disk persistence after close/reopen. Temporary test databases were removed by the harness after verification.

| Model | Loaded records | Result |
|---|---:|---|
| 1 | 303 | PASS |
| 2 | 295 | PASS |
| 3 | 394 | PASS |
| 4 | 306 | PASS |

## Remaining application acceptance

Not executed: actual Next.js/HTTP handlers, API-level role and creditor authorization, browser flows, concurrent multi-process/server-PostgreSQL races, final meeting rehearsal or real bank/payment/Sayad integration. These are explicit P0 gates in [PRESENTATION_ACCEPTANCE.md](PRESENTATION_ACCEPTANCE.md). Embedded PostgreSQL checks do not prove those application boundaries. The bank presentation must not be called ready until its P0 checks pass on the actual build.

## Reproduce

```sh
node --test implementation-kit/*.test.mjs
python3 validate_prototype_data.py
node scripts/verify-database.mjs
```

The database engine is verified and cached in this workspace. For another environment, use the pinned installation/bootstrap in [implementation-kit/README.md](implementation-kit/README.md). Registry/CDN timeouts occurred during preparation; an already verified download was reused and every cached file rechecked against the committed SHA-256 manifest. This is not a claim that the future application dependencies are installed.

No real customer data, bank facility, legal contract, payment, external message or regulatory approval was created. Production release still requires the specified legal/banking review and operational certification. Additional visual-design work was excluded at the user’s request.

## Source preservation

The original root PRD.md had pre-existing uncommitted changes. This task did not modify it or business-model.md; their hashes match the prior handoff.

- `PRD.md`: SHA-256 `3b42cda4b38849478504407ac1fac034220df0bca949cea8e1f6f8d4902ab223`
- `business-model.md`: SHA-256 `48737538826fb6c527290877faf9cc9e24e5a4d35f75ec2707e2bc2ef929f708`
