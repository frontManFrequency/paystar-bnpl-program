# Model 3 — PayStar originates and sells receivables
## Technical architecture document

Version 1.0 · 16 November 2026 · implementation baseline and prototype specification.

Read this model's [PRD](PRD.md), [architecture](TAD.md), [database](database_structure.md) and [role flows](Userflow.md) together. The [single-session build instructions](../application/CLAUDE.md), [API contract](../openapi.json), [SQL schema](../schema.sql) and [synthetic fixture](prototype_data.json) are part of the build handoff.

**Decision precedence:** this user's four-model requirements → this model's explicit rules → shared baseline below → original [PRD](../PRD.md) and [business model](../business-model.md). Original source files remain historical inputs. Values marked **A-** are chosen implementation assumptions, not evidence of a signed commercial agreement or regulatory permission. No unresolved product decision is delegated to the implementer. Production activation requires the specified legal and banking review; prototypes run with isolated mocks.

## Model identity — non-negotiable routing

| Dimension | Binding rule |
|---|---|
| Customer creditor | PayStar before legal transfer; purchasing bank after legal transfer |
| Final customer decision | paystar-admin for origination; bank separately decides purchase eligibility |
| Check beneficiary | PayStar initially; purchasing bank after verified transfer |
| Clinic payer | PayStar treasury before sale |
| Bank role | Purchases selected originated receivables; purchase approval is not customer loan approval |
| Primary default exposure | PayStar before sale; after sale, bank with contractual recourse to PayStar or bank without customer-default recourse |
| Installment destination | PayStar account before transfer; bank collection account after transfer, with PayStar as servicing agent |
| Commission recipient | the current owner of the corresponding receivable |

## 1. Architecture and prototype deployment

Implement one TypeScript workspace with a reusable domain kernel and four independently runnable application configurations. Each model gets its own database/schema, fixture seed and port (3101–3104); shared UI/domain packages must not share balances across demos. A landing launcher may link to the four ports. Runtime model is fixed server-side per instance; a customer request cannot change it. This yields four functioning prototypes without implementing four divergent money engines.

Chosen implementation stack: Node 22 LTS-compatible runtime, TypeScript, React with Next.js App Router, PostgreSQL 16+, a PostgreSQL job/outbox worker, schema validation via Zod, server-side parameterized SQL using `pg`, and Vitest/Playwright for unit/end-to-end tests. These are implementation choices, not claims about newest releases. Resolve compatible exact dependency versions once and commit lockfile. Use local Docker Compose PostgreSQL where available; a real PostgreSQL connection supplied in environment is an equivalent development backend. For the single-session local prototype when neither is available, the tested PGlite 0.5.16 embedded PostgreSQL backend with an on-disk directory per model is explicitly approved. It executes the same schema and constraints; it is not an in-memory/browser-state substitute. Use one process per database, serialize each command with the engine transaction callback, and keep a transactional outbox worker in that process. Production still targets server PostgreSQL with multi-process/concurrency acceptance. Prototype payment, bank, KYC, Sayad, signature, SMS and file scan adapters are deterministic local mocks; live adapter configuration is absent by default.

Suggested layout: `apps/prototype` for common web shell; `packages/domain` for immutable-money/date/policy/transition logic; `packages/db` for SQL migration and repositories; `packages/adapters` for mock/provider interfaces; `packages/ui` for Persian RTL components; `tests` for behavioral and end-to-end coverage. Per-model commands choose model ID, port, DB URL and fixture path. The root SQL is a union schema; unsupported model operations are denied server-side and absent in UI. Production architecture can deploy the same modules as one modular monolith with explicit model and tenant partitioning; separate microservices are unnecessary at pilot volume.

Modules: Identity/Access; Business/Referral/Catalog; Applications/Evidence/Decision; Policy/Contracts/Checks; Credit/Orders; Billing/Payments/Ledger; Settlements/Refunds/Wallet; Collections/Guarantees; Banking/Facilities or Receivables; Support/Reporting; Audit/Notifications. Only Ledger writes journals; only Credit writes capacity; only Payment confirms provider receipts; external clients cannot set paid balances or owner history directly.

## 2. Trust boundaries, role access and authentication

Every request derives actor, memberships, model, tenant, scopes and session from verified authentication; never trust an input role/creditor ID as authorization. Prototype role switcher creates clearly labeled demo sessions for seeded users only, and is disabled when `APP_ENV != prototype`. Production customer login uses OTP plus verified account binding; privileged roles use passwordless enterprise identity plus MFA. Access token lifetime 15 minutes, rotating refresh session 7 days; privileged idle timeout 30 minutes. Logout and role revocation invalidate sessions. Cookies HttpOnly, Secure and SameSite=Lax; all browser mutation routes require CSRF token and origin validation.

| Resource/action | super-admin | paystar-admin | business-admin | customer | bank |
|---|---|---|---|---|---|
| Organizations, memberships, policy release | Manage with separate checker | Read own operational scope | Own profile only | None | Own bank contacts only |
| KYC/credit evidence | Auditor scope only, masked default | Assigned review scope | Recommendation summary only | Own | Only assigned bank cases or purchased-loan mandate |
| Customer final approval | Never as system override | Models 1/3 | Model 2 own creditor clinic | None | Model 4 |
| Referral status | Aggregate | Permitted operations | Own invited cases, minimal status | Own | No unrelated referral browsing |
| Order/service/return initiation | No impersonation | Support, cannot fabricate clinic approval | Own selling clinic | Own checkout/dispute; no return approval | Bank settlement/return acknowledgement scope |
| Payment and check data | Audit, not edit | Servicer scope | Own clinic creditor/order evidence | Own | Own creditor/facility/assigned assets |
| Payout and refund processing | Policy/audit, never self-check | Treasury maker/checker | Own statements and requests | Own withdrawal | Own bank confirmation/signing |
| Legal enforcement | No bypass | M1/unsold M3 creditor or delegated servicing | M2 own creditor | Own notices/appeal | M3 sold/M4 creditor |
| Model 3 sale decision | Audit only | Submit/accept seller | No | Notice only | Buyer decision/transfer confirmation |

Row scopes apply at repository query and PostgreSQL RLS layers. Inviter can see pseudonymous customer display name, application stage, update time and action needed, not documents, score, income, bank account, medical detail or another clinic's purchase. Bank in Model 1 sees facility covenants and approved aggregate reports; customer drilldown requires explicit separate reporting mandate. Model 2 bank gets no loan rows. Returned exports obey the same rules. Permission tests must cover list, detail, download, search, CSV and event-stream access, not just buttons.

## 3. Domain state machines

All transitions use command handler + current state + expected version + permission + evidence guard. Persist transition audit and outbox in the same transaction. Unlisted transitions fail `INVALID_TRANSITION`.

| Aggregate | States and normal transitions | Exceptional transitions |
|---|---|---|
| Application | DRAFT→IDENTITY_PENDING→FEE_PENDING→ASSESSMENT_PENDING→PAYSTAR_REVIEW→CREDITOR_REVIEW→APPROVED→CONTRACT_PENDING→ACTIVE | Any review→NEEDS_CORRECTION→saved `resume_stage`; review→REJECTED; DRAFT→EXPIRED; external stage→EXTERNAL_PENDING→original stage; unsigned→CANCELLED |
| Credit line | APPROVED_PENDING_CONTRACT→ACTIVE→EXPIRED/CLOSED | ACTIVE→HELD for delinquency/fraud/policy; HELD→ACTIVE on verified resolution and unexpired approval |
| Checkout | QUOTED→RESERVED→CONTRACT_READY→PAYMENT_PENDING→CONFIRMED | pre-confirmation→CANCELLED/EXPIRED; payment ambiguity→RECONCILIATION_REQUIRED |
| Service | AWAITING_FUNDS→READY_FOR_SERVICE→STARTED→COMPLETED | READY/STARTED/COMPLETED→DISPUTED; accepted return records independent adjustment |
| Installment | SCHEDULED→DUE→PARTIALLY_PAID→PAID | DUE/PARTIALLY_PAID→OVERDUE; approved adjustment→PARTIALLY_CANCELLED/CANCELLED; hardship→SUPERSEDED |
| Payment | CREATED→PENDING→SUCCEEDED | PENDING→FAILED/UNKNOWN; UNKNOWN→SUCCEEDED/FAILED only from provider evidence; SUCCEEDED→REVERSED by verified reversal |
| Check | DRAFT→REGISTERED→ACCEPTED→IN_CUSTODY | ACCEPTED/IN_CUSTODY→TRANSFER_PENDING→TRANSFERRED; IN_CUSTODY→PRESENTATION_LOCKED→CLEARED/BOUNCED; settled obligation→RELEASE_PENDING→RELEASED |
| Settlement/withdrawal | QUEUED→SUBMITTED→CONFIRMED | SUBMITTED→UNKNOWN→CONFIRMED/FAILED; FAILED→new attempt, same economic obligation |
| Refund | REQUESTED→CLINIC_APPROVED→POSTED→FUNDED→PAID_OUT | REQUESTED→REJECTED; POSTED→FUNDING_DELAYED→FUNDED; partial withdrawal leaves funded remainder |
| Collection | MONITORING→SOFT→LEGAL_REVIEW→LEGAL_ACTIVE→RECOVERY→CLOSED | →DISPUTED; legal action never follows a timer without approval |
| Guarantee claim | DRAFT→ELIGIBLE→APPROVED→SUBMITTED→RECOVERED→CLOSED | →REJECTED/CONTESTED; partial recovery retains residual and cap usage |

For Models 1/3 the PayStar reviewer is also creditor authority, so `CREDITOR_REVIEW` records a second independent credit decision within paystar-admin scope. Model 2 uses clinic reviewer, Model 4 bank reviewer. `APPROVED` means a limit decision, not that funds exist or clinic is paid. `ACTIVE` line can precede a specific purchase's checks; each purchase still needs its own security.

Installment status is a projection of due date and component balances; it is not a mutable source of truth. A partially cancelled installment can still have an overdue residual. Compute payment state and delinquency state separately to avoid concealing overdue debt behind a cancellation label.

## 4. Core transactions and concurrency

**Reservation transaction:** acquire customer exposure row, credit line, clinic exposure and program exposure locks in stable ID order; validate line/approval/evidence/clinic/model; calculate P and quote hash; enforce combined monthly affordability for each affected Jalali month; compare P with available; insert reservation and reserved funding if needed; increment row versions; append `credit.reserved.v1`. All caps include outstanding reservations. `READ COMMITTED` with explicit `FOR UPDATE` locks is acceptable; use serializable retry for multi-party transfer/recourse. Lock timeout 3 seconds; retry serialization errors up to 3 times with jitter before returning 409.

**Payment confirmation:** verify signature, provider status, currency, amount and merchant/creditor account; insert inbox row unique(provider,event_id); lock payment, purchase, installments, line and ownership epoch; confirm receipt unique(provider,provider_reference); allocate once; append balanced journal; convert reserved P to outstanding P if first payment; apply actual paid principal release; create settlement obligation and outbox; commit. Payment created in one owner epoch cannot silently route receipt to a later owner without bank-payable remittance logic.

**Refund transaction:** lock purchase, component allocations, current ownership and line; verify clinic authorization, exact cumulative return and no concurrent transfer lock; calculate cumulative deltas; post cancellation/reversal and wallet liability/bridge receivable; update component amounts and release principal delta; append event; enqueue bank adjustment, check replacement/release and partner recovery. A repeat request returns same refund ID. Return approval during transfer stops/finalizes transfer according to actual external evidence; never loses either command.

**Ownership transaction:** verify all legal evidence; lock lot/purchase/checks and owner intervals; close previous half-open owner interval and open next at exact effective timestamp; preserve schedule IDs; move internal ownership memorandum; open bank purchase-price claim or clear advance; notify customer; commit. Cash settlement and owner change are distinct commands. External legal changes cannot be reversed by rolling back a later local transaction; reconcile and append corrective history.

**Wallet withdrawal:** lock wallet; available cash-backed balance minus held payouts >= request; create hold and payout intent once; call provider outside DB transaction; finalize from signed response/inquiry. Successful payout reduces cash and wallet liability; failed final result releases hold; unknown remains held. Refund funding and withdrawable balance use separate fields.

Always use an outbox for effects after commit, inbox for received events, and idempotency key for initiated commands. No external HTTP request is performed while holding a database transaction open.

## 5. HTTP contract and integration behavior

The root `openapi.json` is the machine-readable baseline for required endpoints. Base `/api/v1`; JSON UTF-8; dates ISO 8601 UTC plus separate local due-date string; UUID IDs; money decimal strings of integer rial; currency literal IRR; page size default 25, max 100, cursor pagination. API errors are `{error:{code,message,field_errors,retryable,correlation_id}}`; never include provider secrets or raw national ID. Statuses: 400 malformed, 401 unauthenticated, 403 forbidden, 404 absent or inaccessible, 409 stale state/idempotency conflict, 422 business-rule failure, 429 throttled, 503 external dependency unavailable.

Every money/state mutation requires `Idempotency-Key`, scoped by actor+method+route. Store request hash and result; same key+body returns original response, same key+different body returns 409. Keys retained for 30 days, permanent provider receipt uniqueness retained for financial lifetime. `If-Match` carries row version for reviewer decisions, policy publication and clinic return approval. Webhooks use provider event identity instead of user idempotency header. Numeric currency strings reject exponent notation, decimals and negative values where inappropriate.

Integration adapters (mock implementations are compulsory):

| Adapter | Request → response | Failure behavior |
|---|---|---|
| Identity | national ID, DOB, mobile, consent → MATCH/MISMATCH/UNKNOWN, verified field set, evidence ID | UNKNOWN waits/reviews; mismatch blocks; never approve on HTTP200 alone |
| Account | transient card/token, national ID → token, IBAN, bank, account, owner match | Mismatch asks correction; strip PAN from logs and storage |
| Credit | subject token, consent ID → band, normalized score, obligations, bounced-check flag, report time/hash | Timeout pending; no record becomes UNKNOWN, not D-band |
| Payment | amount, creditor account token, purchase/reference → redirect token; verify/inquire → final receipt | Redirect success is not confirmation; inquiry every 1/5/15 minutes then hourly to 24h |
| Bank | signed application/draw/purchase/refund instruction → accepted, rejected, correction or pending with external ref/version | Bank state stays pending; manual signed bank file uses identical validation and two-person evidence review |
| Sayad/security | issuer/beneficiary/amount/maturity/ID → verified registration, acceptance, transfer reference/time | No assumed API access; manual authorized evidence adapter and bank acknowledgment required in live deployments |
| Signature | document hash, signers, consent challenge → evidence bundle, timestamp, signature verification | Expired/hash mismatch invalidates signature and requires new customer action |
| SMS | template, mobile token, occurrence key → accepted/delivered/failed | Retry 1/5/30 minutes; in-app record remains; no debt state change |
| Storage/scan | file token/hash/type → scan status and immutable object ref | Quarantine until clean; no reviewer download of unsafe file |

Webhook HMAC-SHA256 covers timestamp+'.'+raw body; reject timestamp skew over 5 minutes, wrong signature and repeated event ID. Bank adapters may require mTLS plus signature. Store payload hash, redacted envelope and receipt time. Duplicate callbacks return HTTP200 with duplicate=true after authentication. Out-of-order events trigger status inquiry; a late PENDING cannot downgrade SUCCEEDED. Retry delivery at 1m, 5m, 15m, 1h, 6h, then daily up to 3 days; dead-letter queue is visible to operations. Replaying a dead-letter reuses original economic idempotency key.

Example `POST /checkouts`: `{credit_line_id,order_id,principal_irr:"400000000",expected_order_version:1}` → `{checkout_id,status:"RESERVED",expires_at,quote:{principal_irr:"400000000",commission_irr:"48000000",total_irr:"448000000",installments:[...]},version:1}`. Creating the quote never creates a payment receipt. The sample fixture contains exact persisted numbers.

## 6. Operational ledger and reconciliation

Each journal belongs to a legal book (`PAYSTAR`, `CLINIC:<id>`, `BANK:<id>`) and currency IRR. Own-entity books and external-servicing mirrors are explicitly marked; a bank receivable in a servicing mirror is not a PayStar asset. A journal must balance within each legal book: total debits=total credits, positive integer amounts, at least two lines, immutable after posting. Corrections append linked reversal journals. Deferred commission is distinguished from recognized revenue; signed finance policy controls recognition, baseline recognizes each installment's commission on its original due date or earlier cash receipt, with refunded commission reversed.

| Economic event | Debit | Credit | Book |
|---|---|---|---|
| Originate financed P | Customer principal receivable P | Clinic settlement payable P | Creditor book |
| Book C schedule | Customer commission receivable C | Deferred commission C | Creditor book |
| Customer installment paid | Cash P_i+C_i | Customer principal receivable P_i; commission receivable C_i | Creditor book |
| Recognize due/paid commission | Deferred commission C_i | Commission revenue C_i | Creditor book |
| Pay funded-model clinic | Clinic settlement payable P | Cash P | Creditor book |
| Model 2 installment service sale | Same origination/commission schedules, but clinic settlement payable is replaced with clinic service revenue/clearing P | See debit above | Clinic mirror; no fictitious PayStar settlement |
| Facility draw (M1) | PayStar cash | Facility principal liability | PayStar |
| Facility principal repayment | Facility liability | PayStar cash | PayStar |
| Refund unpaid component | Clinic recovery receivable for principal; deferred commission or contra-revenue for commission | Customer principal/commission receivable | Creditor book |
| Refund paid component entitlement | Clinic recovery receivable for principal; deferred commission or contra-revenue for commission | Customer refund payable | Creditor book |
| Bridge funds customer refund for another creditor | Due from accountable partner | Segregated bridge cash | PayStar |
| Wallet funding transfer | Segregated wallet cash | Customer wallet liability | PayStar wallet book; creditor refund payable cleared through reciprocal partner clearing |
| Withdraw wallet | Customer wallet liability | Segregated wallet cash | PayStar wallet book |
| Guarantee cash deposited | Restricted cash | Guarantee deposit liability | Beneficiary book |
| Apply verified guarantee recovery | Restricted cash/liability clearing or guarantee proceeds | Creditor recovery clearing, then claim allocation | Creditor book; no automatic customer debt discharge |

The wallet bridge transfer must be represented as two linked balanced journals, with bank transfer reference, never two unrelated increases in cash. For PayStar creditor refunds, settle its refund payable into wallet clearing rather than creating a receivable from itself. Receivable assignment economics and optional recourse are separate seller/buyer journals, detailed in the model section; statutory accounting mapping requires finance review.

Reconcile daily by 10:00 Tehran: opening balance + receipts - payouts=closing provider/bank cash; match each provider reference, amount, currency, creditor account and date to journal/receipt. Difference classifications: missing callback, duplicate receipt, amount mismatch, wrong destination, reversed payment, unconfirmed payout, timing difference. Put unmatched cash in suspense with owner and age; it does not release customer credit until validated. Critical unexplained differences pause affected new payouts immediately. Investigator and checker approve corrections; closed day reopens only with recorded finance permission.

## 7. Jobs, events, live status and failure recovery

A durable job table uses unique job key, `run_at`, retry count, lease owner/expiry and last error. `SELECT ... FOR UPDATE SKIP LOCKED` leases a job for 60 seconds; heartbeat every 20 seconds; expired lease is retryable. Jobs are at-least-once; effect handlers must be idempotent. Required jobs: reservation expiry each minute; provider inquiry; daily delinquency calculation at 00:05 local; reminders; settlement batches at 14:00 business days; reconciliation at 09:00; stale catalog every hour; review/correction expiry; contract/check release follow-up; data retention; daily cohort/liquidity metrics; guarantee expiry and facility repayment alerts.

Events carry `event_id`, `aggregate_type/id`, `aggregate_version`, `model`, `tenant`, `occurred_at`, `schema_version`, `correlation_id` and minimal payload. Names include `application.submitted.v1`, `application.decisioned.v1`, `credit.reserved.v1`, `purchase.confirmed.v1`, `payment.allocated.v1`, `settlement.confirmed.v1`, `refund.posted.v1`, `wallet.withdrawal_confirmed.v1`, `installment.overdue.v1`, `check.holder_changed.v1`, `ownership.transferred.v1`, `guarantee.claimed.v1`. Event ordering is per aggregate; consumers discard duplicate version and request refreshed state on gaps.

Server-sent events `/events` sends only authorized tenant/resource changes with resume cursor. Browser updates visible status within 5 seconds of commit; reconnect uses Last-Event-ID and re-fetch snapshot; fallback polls every 15 seconds. Never publish raw KYC, national ID or account identifiers through events. Version mismatch in UI shows updated data and asks actor to review again; does not overwrite another review.

Recovery runbooks: unknown payment→inquire/reconcile, never press "paid"; payout timeout→same transfer reference inquiry, never create second transfer; bank outage→queue/pending and SLA escalation; Sayad mismatch→hold contract/transfer; signing outage→preserve quote and rebuild on expiry; DB outage→fail writes and show temporary issue; notification outage→keep in-app history and retry; ledger mismatch→freeze affected cash flows, retain collection ability, reconcile and post reversal. Financial rollback means compensating entries and external reversals, never deleting history.

## 8. Security, privacy, retention and accessibility

Use TLS, encryption at rest and envelope encryption for identity, bank and raw credit evidence. Separate keys by environment; rotate application secrets every 90 days and immediately after compromise. National-ID lookup uses keyed deterministic hash; full national ID is encrypted, never used as URL ID. Audit every sensitive read, export, decision, approval, login, failed authorization and financial command. Redact logs by allowlist. Signed download URLs last 5 minutes. Object storage blocks public access, validates MIME and scans uploads. Rate limit authentication, searches, exports and provider-triggering commands.

Prototype only uses synthetic identifiers `DEMO-*`; real national IDs/cards/IBANs are deliberately absent. A strict mock adapter accepts those identifiers; production adapters reject them. This prevents accidentally treating a fixture as a real customer. Prototype reset is available only with environment assertion and affects only the selected demo database.

Retention assumption: executed contracts, financial/security/ownership records and audit 10 years after closure; rejected application supporting documents 180 days; draft documents 30 days; raw provider response 90 days with evidence hashes retained; operational logs 90 days; consent proof follows associated contract. Legal hold suspends deletion. Erasure pseudonymizes unnecessary personal fields while retaining mandatory financial evidence; it cannot delete active debt. Legal review must approve these periods before live deployment.

UI: Persian RTL, Persian numerals for display with normalized ASCII accepted on input, exact rial API values, toman primary labels, Jalali dates plus accessible Gregorian alternative. WCAG 2.2 AA target; keyboard navigation, labeled fields, focus after errors, status text not color only, screen-reader live status, mobile layouts at 360px. Text direction for IBAN, IDs and amounts is controlled. Every page implements loading/empty/error/retry/forbidden states and masks sensitive data by default.

## 9. Performance, deployment and quality gates

Pilot load assumption: 500 approved customers, 50 concurrent users, 20 ordinary API requests/second and 5 financial writes/second; p95 read <=500ms and internal write <=1s excluding external providers. Financial transaction budget 3 seconds. Availability target 99.5% monthly; backup RPO15 minutes and RTO4 hours, encrypted daily backup plus continuous WAL archival; restore rehearsal before production and quarterly. Prototypes use local persistent volumes and seed reset, with no availability claim.

Environment variables: APP_ENV, MODEL_ID, DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY_ID, ADAPTER_MODE=mock, DEMO_CLOCK, PUBLIC_BASE_URL; live secrets exist only in secret manager and cannot be set by customer payload. Build dev/staging/prod separately; CI checks types, money/date/authorization tests, migrations on empty and seeded DB, OpenAPI validation and end-to-end role scenarios. Migrations use expand→backfill→validate→contract, with no destructive automatic rollback. Commit lockfile and exact migration order. Seed is idempotent by stable IDs, refused outside prototype environment.

Test scenarios: rounding remainders; Jalali leap/short month and year boundary; checkout expiry/payment race; concurrent purchases breaching cap; repeated callback; out-of-order reversal; cross-tenant ID probing; duplicate financial maker/checker; overdue commission-only debt; full/partial/repeated refund; refund after assignment; bank cash before/after legal transfer; guarantee cap exhaustion; facility repayment unaffected by customer default; Model 2 check/online mutual exclusion; Model 4 bank-only authority. Add browser tests for each dedicated role flow, with assertions against persisted amounts and journals rather than just visible toast messages.

Production release requires signed model agreement/policy bundle, live adapter certification, bank account/beneficiary confirmation, reconciled migration, restore drill and finance/legal/bank authorization. Prototype completion requires all local acceptance scenarios passing and four accessible model instances; live release is explicitly a different gate.
## 10. Model 3 implementation specialization

Enable OriginationTreasury, SalePortfolio, Eligibility, Offer, LegalAssignment, OwnerHistory, ServicingMandate, Recourse and WarrantyIndemnity modules. Funding purchase uses PayStar cash before any bank sale. Sale cash recycles PayStar liquidity only when confirmed; sold customer principal continues consuming the customer's line.

Seller operational sale bridge uses `asset_carrying_amount = unpaid_principal + unpaid_commission - unrecognized_deferred_commission`. On effective legal transfer append memorandum ownership change. Statutory derecognition is gated by finance policy (`SALE_DERECOGNIZED` or `SECURED_FINANCING`) and must not be inferred merely from `WITHOUT_RECOURSE`. For the prototype use operational subledger: debit bank purchase-price receivable at agreed price, clear transferred customer asset/deferred commission and post balancing transfer gain/loss. For with-recourse lots separately book risk exposure memo and verified indemnity/repurchase obligation when triggered; do not count outstanding customer debt twice in total program exposure. In a production secured-financing treatment, finance may retain asset and recognize funding liability while legal owner still changes; this affects statutory export only, not customer creditor display.

Bank mirror opens acquired asset at purchase price with nominal customer claim kept as face components; discount accretion is a separate approved accounting policy. Customer pays scheduled face, never purchase price. A bank purchase payment settles seller's bank purchase-price receivable; bank cash before transfer remains buyer advance liability. Transfer fees and holdback each have their own payable/receivable, not hidden discount fields.

Repurchase reserves PayStar liquidity, obtains recalculated payoff, pays bank, verifies reverse legal/security transfer and updates owner epoch. If transfer-back fails after payment, display `REPURCHASE_PAID_PENDING_TRANSFER` and track bank obligation to transfer rights. No duplicate customer collection path opens. Customer cure cancels or reduces pending demand before funding; excess after funding becomes bank reimbursement payable. Without-recourse attempts for reason CUSTOMER_DEFAULT fail 422; WARRANTY_BREACH requires accepted evidence bundle and maker/checker.

The transfer lock must expire safely: after one business day with no external legal movement, cancel offer lock and resume payments; after any verified legal movement, escalate reconciliation and route payments to actual holder, never automatically revert. A return has priority over a not-yet-effective sale; if already effective, process bank-owned cancellation and partner indemnity. Tests simulate legal/cash events in both orders, a payment at owner-epoch boundary and duplicate assignment callbacks.

## Reviewed implementation starter

Use [SESSION_BLUEPRINT](../application/SESSION_BLUEPRINT.md), [implementation kit](../application/implementation-kit/README.md), [operational diagrams](../DIAGRAMS.md) and [presentation acceptance](../application/PRESENTATION_ACCEPTANCE.md). The kit is tested reference domain and database tooling, not a completed HTTP backend. Pre-purchase checks must persist `expected_installment_sequence`; maturity/amount validation uses the frozen quote. No visual design additions are required by this review.
