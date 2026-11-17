# Compact one-session implementation blueprint

## What exists and what must be built

The four model specifications, schema, fixtures and API contract are complete source inputs. The application does not yet exist. Executable reference money functions, seed importer and database harness now reduce the build effort; reuse them instead of inventing parallel calculations. No new visual-design deliverable is requested.

Build one reusable web/domain codebase with four server-fixed model configurations and four persistent databases. A launcher links the models and remembers the current role/scenario; it must never let a request change model ownership. All five roles and all four model workflows remain in scope. Use source PRDs as reference, not 16 documents pasted into model context at once.

## First commands and read budget

1. Read this document, CLAUDE.md, BANK_DEMO_PLAYBOOK.md and PRESENTATION_ACCEPTANCE.md.
2. Run `node --test implementation-kit/*.test.mjs` and `python3 validate_prototype_data.py`.
3. Read `implementation-kit/README.md`; run the database harness after installing its pinned test dependency, or use the provided integrity-checked bootstrap when the package registry is unavailable.
4. Read Model 1 PRD shared sections once, and each model's section 11. Read common TAD once, then model-specific section 10. Query JSON/SQL for only the modules being built.
5. Read the relevant role flow when implementing that workspace. Avoid loading every fixture row or every API response schema into context.

This workflow is designed for one sustained Claude session. It does not guarantee a particular model's context or execution budget. Work toward every P0 acceptance criterion; do not claim completion because a session or timer is ending.

## Shared implementation boundaries

| Reusable unit | Exact responsibility |
|---|---|
| Money kernel | `implementation-kit/domain.mjs`; BigInt math, price, allocation, return deltas, guarantee caps, sale price, affordability and role guard |
| Calendar | `implementation-kit/calendar.mjs`: UTC storage + Jalali month anchor/clamp; business-day calendar is explicitly synthetic in prototype_content.json; test leap/month/year boundaries |
| Authorization | Verified user+membership+model+resource ownership, permission subscopes and distinct human checker; no role from untrusted JSON |
| Persistence | `schema.sql`; `implementation-kit/seed.mjs`; transactions, expected versions, immutable posted journals, idempotency and outbox |
| Provider boundary | Deterministic adapter outcomes, verified callbacks, retries/inquiry; live provider settings disabled |
| Model strategy | Final customer approver, initial creditor, funding payer, payment account, enabled bank operations and recourse policy |
| Statement service | One computation used by customer, clinic, PayStar and bank views; separate principal/commission/penalty/cancelled/refunded components |
| Demo controller | Role login, scenario load/reset, monotonic clock, action-triggered mock events, immutable source fixtures and reversible fresh run |

Never implement financial commands as arbitrary “set status” endpoints. Each command verifies actor and state, locks aggregates, applies one domain effect, posts accounting and audit/outbox in one transaction, then calls external adapters outside that transaction. Refer to TAD for exact boundaries.

## Build order with a usable checkpoint at each stage

1. **Bootable shared application:** configuration, server-derived sessions, database migration/seed, read-only role dashboards and statement queries. Four instances must start before model feature development branches apart.
2. **One complete common transaction:** referral/application, mock verification/assessment, correction, final decision strategy, contract/security, order/reservation, first payment and payout, customer statement. Implement Model 4 first for the bank walkthrough, then enable Model 2 and Model 1 authority/funding strategies. This supersedes the previous suggested implementation order only; it does not reduce other model scope.
3. **Money-changing operations:** remaining payment, early payoff, partial/full return, wallet, unknown outcome, idempotency, refund recovery, daily reconciliation and delinquency. Reuse the tested kernel.
4. **Distinct model controls:** Model 1 independent facility; Model 2 check presentation lock; Model 3 origination/sale/transfer cash ordering/recourse; Model 4 bank acknowledgment and collections mandate. Complete both Model 3 recourse modes.
5. **Operational completeness:** catalog/dedicated showcase, reports with correct denominators, evidence downloads, support/appeal/hardship, guarantees and all five role flows. External legal enforcement, provider processes and connector events are simulated through faithful adapters, not performed live.
6. **Acceptance and rehearsal:** real database/server integration tests, browser role flows and the fifteen-minute meeting run. Fix every P0. Save actual evidence to BUILD_RESULTS.md.

## Missing-case rules that must not be invented during build

- The clinic can initiate/approve a return; the customer opens a dispute. A different clinic user checks a return approval.
- Bank purchase cash does not itself transfer receivable/check ownership. Legal effective ownership and cash settlement are different facts.
- Sale/recovery/write-off never automatically restores the customer's line. Only customer principal payment, approved cancellation or legally effective discharge does.
- Check verification and payment intent may precede purchase creation. Store checkout links and intended installment sequence; populate purchase/installment links atomically at confirmation.
- A checkout expires without erasing externally registered checks. Store release-required security and permit verified re-use only when customer, clinic, amount, beneficiary, maturity and signed terms exactly match a fresh quote; otherwise require release/replacement. Never revive expired credit reservations after late payment.
- Refund deltas use original component minus cumulative paid amount, not already-adjusted residual. PayStar's refund bridge is not permission to spend bank/customer restricted money.
- A reversal after a component was already returned must not violate `refunded <= paid` or resurrect cancelled service debt. Keep the returned entitlement history, suspend the related withdrawal if still unspent, and create a separately evidenced duplicate-reimbursement recovery case/receivable. Treasury/legal approval determines recovery; the first demo handles this as an explicit reconciliation exception, never silent negative money.
- Baseline penalty is zero; old-policy assessed penalties are separate. No compounding or invented collection charges.
- Source fixtures contain intentionally adverse cases. Reports must label selected scenario and denominator. “No matured observations” displays N/A, not 0% loss or 100% success.

## Why no additional broad documents

The existing 16 documents already cover product/architecture/schema/roles. Adding another generalized PRD, speculative business forecast, design system or slide deck would duplicate requirements and consume context. The new materials focus on missing executable foundations, semantic diagrams, the meeting narrative and verifiable acceptance. Continue implementing once these are read.
