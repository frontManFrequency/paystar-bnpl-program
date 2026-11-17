# Build results — Model 4 prototype

Date: 2026-11-17 · Next.js 15.5.29 · PGlite 0.5.16 (embedded PostgreSQL 18) · fixture schema 1.0 · demo clock 2026-11-16T08:30Z

## Scope delivered
Only **Model 4** (the bank as creditor from inception) was built, on port 3104, as requested in this session. Models 1–3 are **not built**. The kernel and schema are shared, but `scripts/run-model.mjs` refuses models 1–3 instead of pretending to run them.

## How it was verified
| Suite | Command | Result |
|---|---|---|
| Reference kernel (money, calendar) | `node --test implementation-kit/*.test.mjs` | 17/17 pass |
| Model 4 integration (real schema/fixture, on-disk DB, dispatcher, webhooks) | `tsx --test tests/model4.test.ts` | 10/10 pass |
| HTTP end-to-end against the production build | `npm run test:e2e` | 25/25 pass |
| Full fresh journey over HTTP, rendering every page at each state | `node scripts/walkthrough.mjs` | pass (26 page renders, 0 server errors) |
| Type check / production build | `npm run typecheck`, `npm run build` | clean |

## P0 mapping
| ID | Status | Evidence |
|---|---|---|
| P0-01 | **Partial** | Only Model 4 runs (http://localhost:3104, isolated `.data/model4`). Models 1–3 not built. |
| P0-02 | Pass | Reset via HTTP and CLI; close/reopen persistence test; reset restores 300m statement |
| P0-03 | Pass | All five roles render their workspace (e2e); others redirected to /forbidden server-side |
| P0-04 | Pass | PayStar/super-admin `decision.bank_final` → 403 (integration + HTTP); only bank approves |
| P0-05 | Pass | Draft → identity → account → docs → fee → report → PayStar → bank correction → resubmit → bank approval → contract → checks → first payment |
| P0-06 | Pass | Bank is creditor in the contract, check beneficiary/custodian, payment intent and ownership history |
| P0-07 | Pass | Clinic payout 400m (full P); service start denied until bank payout confirmed; bank maker/checker |
| P0-08 | Pass | 400m + 48m; 4 × 112m; 300m after the first payment; payoff 336m; service fee 3m |
| P0-09 | Pass | Next payment → 200m; duplicate/replayed signed webhook adds no receipt, journal or credit release |
| P0-10 | Pass | Unknown stays UNKNOWN until inquiry; success after the 16-minute expiry → UNAPPLIED, no purchase, reservation released |
| P0-11 | Pass* | Two parallel 100m checkouts at the cap → one 200, one 422. *Serialized single-process engine, not a multi-process PostgreSQL race test |
| P0-12 | Pass | 50% return: 56m wallet, 150m released; full return adds 56m/150m; repeat is no-op/409 |
| P0-13 | Pass | Owed/funded/held separate; failed payout releases hold; unknown held then confirmed once |
| P0-14 | Pass | Customer cannot approve returns (403); clinic initiator cannot check own return (409); other clinic 404 |
| P0-15–P0-18 | **Not applicable / not built** | Model 1–3 behaviors |
| P0-19 | Pass | Final approval, disbursement, legal authorization and amendment acknowledgement are bank-only |
| P0-20 | Pass | Overdue line HELD, new order rejected; guarantee claim needs DPD60 + legal authorization + customer and check recovery + 15 days; 20% of 300m = 60m; maker/checker; customer debt unchanged. Monthly affordability enforced at checkout (not separately unit-tested) |
| P0-21 | Pass | Statement API/page 404 for other customer/clinic; clinic CSV export scoped; RLS tenant scope; CSRF origin check |
| P0-22 | Pass | /statement shows statement → allocation → receipt → journal lines → bank instruction; journals balanced per book; posted rows immutable (DB triggers) |
| P0-23 | Pass | Simulation banner on every page; default rate shown as N/A with a synthetic-data label |
| P0-24 | Pass | All adapters in-process mocks; no outbound network; rendered pages reference no external hosts |
| P0-25 | **Not done** | No human timed rehearsal or real-browser click-through was performed |

## Known limitations
- No real-browser (Playwright) test. HTTP and server rendering are verified, but client-side click handlers were not run in a browser.
- Live updates use refresh-after-action, not server-sent events. Scheduled jobs run when the demo clock advances, not in a background worker.
- Hardship requests record the bank's approve/reject decision only; the schedule amendment is not applied.
- Organization creation, policy editing and catalog editing are read-only views.
- Two dev-only transitive npm advisories remain (postcss, sharp); the Next.js critical advisories are fixed by 15.5.29.
- This is a prototype: no legal, banking, Sayad or payment certification is implied.
