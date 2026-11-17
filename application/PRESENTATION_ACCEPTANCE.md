# Acceptance gate for a bank-manager demonstration

The standard is a coherent, rehearsed and evidence-backed prototype. “Perfect” is not a test result. The build is presentation-ready only when every P0 below passes in the actual application. Documents and passing reference math cannot satisfy the browser, authorization or concurrency rows.

## Mandatory pass/fail matrix

| ID | Check | Expected evidence | Gate |
|---|---|---|---|
| P0-01 | Start all four models from documented commands | Four reachable URLs, distinct model IDs and isolated persistent DBs | No presentation if failed |
| P0-02 | Seed/reset and persistence | Reset restores expected data; restart/refresh preserves later confirmed mutation; other model unaffected | No presentation if failed |
| P0-03 | Five roles per model | Each can enter its own workspace; Model 2 bank role honestly restricted | No presentation if failed |
| P0-04 | Model-specific final decision | Only PayStar M1/M3, clinic M2, bank M4 can approve customer credit; unauthorized HTTP calls denied | No presentation if failed |
| P0-05 | Fresh customer path | Draft → fee → assessment → correction → final approval → contract/checks → checkout → confirmed first payment | No presentation if failed |
| P0-06 | Creditor and check consistency | Same correct creditor/beneficiary across agreement, payment, statement and custody chain | No presentation if failed |
| P0-07 | Bank/funder payout and service gate | Funded models pay full P to clinic; service start denied before funds; M2 has no upfront funding claim | No presentation if failed |
| P0-08 | Exact standard money example | 400m principal +48m commission; first paid112m; outstanding principal300m; early payoff336m | No presentation if failed |
| P0-09 | Next payment and duplicate webhook | Next payment reduces outstanding principal to200m; replay adds no cash, debt reduction or credit release | No presentation if failed |
| P0-10 | Ambiguous/late payment | Unknown stays pending; payment after expired released reservation becomes refundable unapplied money | No presentation if failed |
| P0-11 | Two concurrent checkouts at cap | At most allowed exposure commits; no negative available capacity or doubled clinic liability | No presentation if failed |
| P0-12 | Partial/full/interleaved returns | Half return after first payment refunds56m and releases150m principal; subsequent full return adds56m/150m; repeated call zero | No presentation if failed |
| P0-13 | Wallet cash and withdrawal | Owed/funded/held distinct; only funded available can withdraw; failed/unknown payouts handled correctly | No presentation if failed |
| P0-14 | Clinic return authority | Customer dispute is not return approval; initiator cannot check own approval | No presentation if failed |
| P0-15 | Model 1 independent bank schedule | Customer default or return leaves facility due unchanged | No presentation if failed |
| P0-16 | Model 2 check versus online collection | Pending online intent prevents presentation; no two allocations from check+online; no fake bank decision queue | No presentation if failed |
| P0-17 | Model 3 sale rejection and both event orders | Rejection leaves PayStar owner; cash-first is advance; legal-first changes owner and opens bank receivable | No presentation if failed |
| P0-18 | Model 3 both recourse modes | Ordinary default demand rejected without recourse; valid with-recourse repurchase waits for reverse legal/check transfer | No presentation if failed |
| P0-19 | Model 4 bank-only commands | Final approval, confirmed disbursement, legal handoff and bank refund acknowledgment cannot be forged by PayStar | No presentation if failed |
| P0-20 | Delinquency, affordability and guarantees | DPD blocks new spend; recycled credit respects monthly affordability; caps and prerequisite recovery evidence enforced | No presentation if failed |
| P0-21 | Tenant, customer, bank and export isolation | URL guessing, list/search/export/event-stream access cannot reveal another subject's restricted records | No presentation if failed |
| P0-22 | Financial traceability | Each visible amount drills down to source facts; journals balanced and immutable; mismatches remain visible | No presentation if failed |
| P0-23 | Synthetic data honesty | Simulation visible; adversarial test accounts not represented as actual performance; immature cohort outcomes=N/A | No presentation if failed |
| P0-24 | No live side effects | No real SMS, KYC, money, check registration, bank submission, external publishing or messaging | No presentation if failed |
| P0-25 | Complete rehearsal | Timed walkthrough performed on final build; observed results and command/test logs retained | No presentation if failed |

Accessibility and responsive requirements already in TAD remain requirements. The user's latest instruction excludes additional visual-design work from this preparation task. Do not treat visual redesign as permission to postpone functional completion.

## Automated tests versus rehearsal

Reference tests in implementation-kit verify pure financial rules. Database harness executes the schema, seeds, financial constraints, ownership overlap prevention, basic RLS and disk persistence in embedded PostgreSQL. These do not prove HTTP permissions, simultaneous multi-process transactions, provider certification or browser behavior. The actual app must add integration/end-to-end tests for those boundaries. `test.skip`, unimplemented handlers, no-op buttons, direct client mutation of money and silent fallback to dummy charts fail this gate.

## Evidence the Claude session must leave

Create `BUILD_RESULTS.md` with commit/build identifier if available, start commands, four URLs, fixture/clock version, tested scenarios mapped to P0 IDs, failing or untested checks, and screenshot/statement paths from the actual build when useful. Include server/browser test output and state what was manually rehearsed. A failure must remain visible; do not label the build ready while a P0 is unresolved.

No legal certification follows from passing these checks. Production release still requires the documented legal and banking approvals, real adapter certification and infrastructure acceptance.
