# Model 2 — Clinic as customer creditor
## User flows by role

Version 1.0 · 16 November 2026 · implementation baseline and prototype specification.

Read this model's [PRD](PRD.md), [architecture](TAD.md), [database](database_structure.md) and [role flows](Userflow.md) together. The [single-session build instructions](../application/CLAUDE.md), [API contract](../openapi.json), [SQL schema](../schema.sql) and [synthetic fixture](prototype_data.json) are part of the build handoff.

**Decision precedence:** this user's four-model requirements → this model's explicit rules → shared baseline below → original [PRD](../PRD.md) and [business model](../business-model.md). Original source files remain historical inputs. Values marked **A-** are chosen implementation assumptions, not evidence of a signed commercial agreement or regulatory permission. No unresolved product decision is delegated to the implementer. Production activation requires the specified legal and banking review; prototypes run with isolated mocks.
## Entry points and interaction contract

Every role gets a distinct workspace, navigation and authorization scope. The prototype landing page shows model name, legal creditor, demo clock, role switcher and scenario chooser. Switching roles changes the demo session, not the model or the underlying persisted transaction. All screens use Persian RTL, toman labels with exact rial detail, Jalali dates and responsive layouts. The same scenario must be inspectable across customer, clinic, PayStar and bank views with consistent values. A clear simulation banner appears on every page.

Each mutation shows a review summary before submission, disables duplicate clicks while pending and displays a durable reference/status after success. Unknown external status says "در انتظار تأیید" and exposes a refresh/support action; it never says paid. Errors preserve entered values and identify the specific field. Empty lists explain eligibility and provide a permitted next step. Downloads include current creditor and "demo" watermark in prototype. Dashboard totals come from persisted records, not hardcoded cards.

The steps below are acceptance specifications. A transition requires backend authorization even when the button is hidden. Financial checker must be a different user; the seeded second operator provides that path. Support/appeal allows correction of evidence but cannot bypass a creditor's decision.

## super-admin

### S1. Access, organizations and permission management

Entry `/admin/overview` after privileged login/MFA (or explicit demo role session). Show current model, enabled institutions, policy release status, outstanding debt, overdue exposure, funding/refund-bridge capacity, reconciliation exceptions and queue age. Select `/admin/organizations` → create clinic/bank record → enter legal identifier, verified account token, operational contact and agreement evidence → save as DRAFT → assign a different checker → activate after verified account and agreements. Invalid/duplicate legal identifier blocks save; suspended clinic cannot originate but its existing customers retain servicing.

Open organization → Members → invite user → choose one of five roles and scoped capabilities → confirm. The last active super-admin cannot remove themselves. A clinic membership cannot select another clinic. Revoke immediately invalidates active sessions, downloads and event subscriptions. Audit screen lists actor, time, action, affected resource and reason.

### S2. Policy release and operational controls

`/admin/policies` lists draft/approved/retired versions and frozen contract counts. Create version from baseline; edit rate/cap/fee/guarantee/collection settings; preview 40-million-toman quote and changed behavior; attach agreement hashes; submit. A distinct authorized checker verifies legal/bank release bundle and activates at effective date. Existing contracts remain on old policy. Prototype release uses conspicuously simulated approvals; live missing evidence blocks activation.

`/admin/operations` → select affected clinic/funder/model → Pause new originations → record reason → confirm. Existing payment, refund and support workflows stay available. Re-enable requires resolved incident and separate checker. Exceptions dashboard links unbalanced/missing bank transactions, provider downtime, stale data and overdue payouts; it cannot edit raw ledger rows.

### S3. Audit, report and prototype reset

`/admin/audit` filters events and evidence hashes with masked PII. Export obeys scope and produces an audited time-limited file. `Reports` compares repayment cohorts, conversion, actual PayStar margin and cash obligations with denominators defined in PRD. Synthetic counts are labeled demo.

`/demo` reset is shown only in prototype environment, requires selecting current model and a confirmation phrase, then restores that model's fixture and fixed clock. It cannot reset another model or production. Changing clock runs scheduled jobs deterministically; returning clock backwards requires reset, preventing accidental negative DPD or duplicate events.

## paystar-admin

### P1. Review and correction queue

Entry `/ops/applications`: filter by status, stage, age, clinic and assigned reviewer. Select application → see identity match, account match, consent proof, assessment freshness/band, income and debt-capacity calculation, uploaded evidence and referral scope. Documents must be scan-clean. Select Approve preliminary review, Reject, or Request correction. Rejection requires reason and customer-safe explanation; correction requires precise fields/documents and 14-day deadline. Submission is version-checked; if another reviewer acted, reload the changed case before deciding again.

A correction event sends SMS/in-app and updates customer and referring clinic statuses without disclosure of raw evidence. Customer resubmission returns to saved reviewer stage. Evidence expiry triggers refresh with no duplicate assessment fee inside the same active cycle. A fee charged but report not delivered within 48 hours moves to refund processing; it cannot be marked non-refundable merely because a charge succeeded.

### P2. Credit servicing, treasury and reconciliation

`/ops/purchases` opens contract, creditor, security holder, principal/commission, payment allocations, service status and clinic settlement. A read-only timeline joins all references. `Payments` lists unknown/duplicate/unmatched receipts; inquire with provider, reconcile and propose correction with evidence. A second operator approves a reversal; manual typing of "paid" is unavailable.

`/ops/settlements` shows obligations by creditor/funder and destination. Validate funding, verified beneficiary, maker/checker approval and idempotent transfer reference → submit → await bank/provider confirmation. Unknown response remains pending with funds held; inquiry resolves it. `Refunds` receives clinic-approved returns, displays cumulative component deltas and current owner; post once, fund wallet from bridge and track partner reimbursement. Never cancel a partner's accounting record without the acknowledged amendment path required by that model.

`/ops/reconciliation` compares bank statement and ledger totals, groups mismatches, assigns investigator and checker and preserves before/after proof. `Collections` shows DPD, prior contacts, dispute, legal authority and check holder. Within mandate send approved reminder or log contact. Legal escalation packages evidence and waits for creditor authority; no automatic enforcement button from timer alone.

### P3. Support, dispute, wallet and privacy operations

`/ops/support` triages complaint/appeal/hardship; show ownership, SLA and existing actions. Verified payment dispute invokes reconciliation; service dispute contacts selling clinic without giving operator power to invent a return approval. Approved hardship prepares a 30-day schedule amendment with no added commission and replacement-check evidence; customer/creditor sign before activation. Reject with reason leaves original schedule intact.

`/ops/wallet` shows liability, funded amount, held payout and available amount separately. Confirmed same-owner IBAN and cooling period are mandatory; unknown payouts remain held. Partner reimbursement failure triggers treasury incident and new-origination pause without deleting wallet liability. Export/read of PII is purpose-scoped and audited.
### P4. Model 2 recommendation and servicing

Send assessment and recommended ceiling to clinic; action is "Recommend to clinic", not "Final approval". Track clinic decision and overdue SLA. Servicing shows clinic as creditor and payment account. Subscription invoices are collected separately. When clinic switches an installment to check presentation, lock online intake and resolve pending intent before allowing evidence upload. If check bounces, create overdue case; no receipt is posted. Serious delinquency escalates to clinic legal team under service mandate.

## business-admin

### B1. Clinic onboarding, referral and showcase

Entry `/business/overview` shows only own clinic: invitation funnel, orders, service queue, cash/settlement schedule, overdue exposure applicable to model, refund claims and guarantee cap. Complete legal details, verified settlement account, sign clinic/refund/guarantee agreements and nominate two authorized operators for return approvals. Account change enters re-verification and payout cooling; old confirmed obligations are not redirected without review.

`/business/referrals` → Create link/QR → preview model/creditor/disclosures → share manually with patient. Dashboard shows invited customer's display name, application status, updated time and generic action, not national ID/credit report. Revoke link stops future use but does not erase existing attribution.

`/business/catalog` creates service title/category, non-medical description, price, availability, image and HTTPS clinic URL; preview dedicated `/b/{slug}` storefront; publish. A stale feed shows sync error and hides buyable item after 24 hours. Refresh never changes existing signed order price. Connector settings provide signed REST events and allowlisted callback URL.

### B2. Quote, checkout and service delivery

`/business/orders` → New order → identify consenting customer by referral/session token → select service and amount → choose financed amount and separately record cash contribution if any → send secure checkout link. Do not expose customer bank details. Price changes increment order version and require a new quote. The clinic cannot mark first installment paid itself.

Monitor order status: waiting for evidence/signature/first payment → confirmed → waiting for funds or ready for service according to model. Start service is disabled until READY_FOR_SERVICE. Record service start/completion and customer acknowledgement. Partial delivery remains an explicit service record; no automatic full completion from cash receipt.

### B3. Returns, statements and guarantee responses

Select order → Return → choose full/partial financed service amount and reason/evidence → preview refunded paid amounts, cancelled future amounts, cash-contribution return and clinic liability → submit → second authorized clinic operator approves. A duplicate request returns existing reference. Returns beyond unreturned value fail. Customer can raise dispute, but this clinic approval remains the monetary return trigger.

Statements separate financed principal, commission if clinic creditor, gross entitlement, actual cash, reserve withholding, platform fees, refunds and outstanding reimbursement. A reserve is a liability/security, not a PayStar fee. Guarantee screen shows beneficiary, type, coverage, cap used/reserved, expiry and claim evidence. Respond to claim or dispute it; no action exceeds contractual cap or transfers ownership without legal evidence. Downloads cannot include another clinic's debt.
### B4. Model 2 creditor decision and check collection

`/business/credit-requests` shows own clinic's applicant summary, affordability recommendation, proposed amount and risk band without raw provider report. Approve <= recommended ceiling, reject with reason or request exact correction. Approval creates clinic-scoped line and clinic-customer installment agreement. Receive first payment and provide service; statement shows only cash actually collected and future clinic receivables, not an upfront PayStar payout.

`/business/checks` → installment → choose online or present check. To present, request lock → wait pending online payment resolution → confirm legal custody → record bank presentation reference → wait bank clear/bounce evidence. Online success requires check release; check success uses the same receipt allocation. At serious default, clinic legal officer authorizes action and records evidence. PayStar provides operational assistance but cannot become the creditor by clicking an action.

## customer

### C1. Referral, registration and application

Entry `/r/{token}` displays clinic, selected model, actual creditor, assessment fee and four-payment example. Invalid/revoked/expired token shows safe explanation and clinic contact; it does not silently attribute to a different clinic. Choose Continue → enter national ID, mobile and birth date → OTP → review identity/credit/account consent separately → identity result. Mobile mismatch asks correction; provider outage displays waiting with retry, no false approval.

`/apply/account` → card verification → masked account/IBAN owner result → correct mismatch. `/apply/documents` uploads identity/income evidence, displays scan/progress and file errors. `/apply/assessment` discloses 500,000 IRR fee and executed-service non-refund policy, then routes to mock/real payment. Failed/unknown fee payment retains application, avoids duplicate charge and shows reconciliation status. `/applications/{id}` shows review stage, next action, SLA and a status timeline.

NEEDS_CORRECTION highlights only requested fields, preserves previous evidence and submits to the original reviewer stage. REJECTED shows safe reason, reapply date and Appeal. APPROVED shows approved limit, expiry, allowed-clinic restriction and creditor; signing framework agreement activates eligible line. The line display separates available from temporarily blocked spendable amount.

### C2. Discover service, purchase and security

`/showcase` or `/b/{slug}` → filter category/price/clinic → inspect freshness → open clinic site or hosted order page. Before eligible approval, installment price is a labeled example. At checkout choose financed amount within limit; any cash contribution is shown separately. Review P, commission, four dates, total, creditor, check beneficiary and refund terms. Any merchant/price mismatch requests a new quote; insufficient credit points to available balance, never suggests a second identity.

`/checkout/{id}/contract` shows immutable agreement and signature challenge. Register three postdated checks using authorized external bank/Sayad channel; enter reference and upload evidence; wait for verified acceptance/custody. UI does not claim that entering a Sayad ID registered a check. Incorrect beneficiary/amount/date blocks payment until corrected. Approved substitute security appears only under an eligible Model 1/3 policy.

Pay first installment → return to processing screen → provider-verified success creates receipt and independent four-installment schedule. Timeout stays pending; retry queries existing intent before making a new one. View order confirmation and clinic-funding status. Treatment can begin when clinic sees READY_FOR_SERVICE, not merely after a browser redirect.

### C3. Repayment, default, refunds and account service

`/account/credit` shows cap, outstanding principal, reserved credit and spendable balance. `/account/purchases/{id}` shows each principal/commission/penalty, paid allocations, due date, current creditor and check holder. Select one or multiple installments or full payoff → review remaining amounts → pay to displayed creditor route → receipt. Early payoff keeps remaining scheduled commission but never charges already paid commission again. Partial payment reduces principal first and only corresponding principal restores capacity.

Late account shows DPD, unpaid amount, blocked-new-purchase reason, next collection stage and support/hardship request. Payment reminders link to authenticated account. Payment cure restores spendable eligibility only after all overdue components and other holds clear. A lawful original penalty can remain after return; baseline penalty is zero.

Service problem → `/account/support` → create dispute → follow clinic review. Once clinic approves a return, see component breakdown and future cancelled installments; no duplicate credit increase. `/account/wallet` shows owed, cash-backed available and pending withdrawal separately. Select verified own IBAN → amount → confirm → pending/success. A new IBAN displays 24-hour cooling period; failed definitive payout releases hold, unknown remains pending. Full or early settlement shows each check's release status and receipt, with support escalation if holder delays.

Profile permits contact changes with verification, consent history/export, marketing preference and privacy request. Active financial records remain under retention; a privacy request never deletes the debt. Logout clears session and sensitive local state.
### C4. Model 2 clinic relationship

The clinic makes final decision, signs installment service agreement, receives your checks and receives each payment. The first installment is the baseline down payment. Another clinic requires its own approval even if the invitation restriction toggle is off. If an installment is being collected by check, online Pay is disabled with a bank-processing explanation, preventing duplicate payment. Release/return of a paid check is tracked with the clinic.

## bank

### K0. Bank workspace contract

Entry `/bank/overview` displays the model-specific legal role, institution identity, mandate scope and pending tasks. Bank users never see another bank's private portfolio. Every approval/transfer/collection command has an authorized user and separate checker where it moves money or rights. Importing signed bank files uses the same validation and audit as API events, with preview of accepted/rejected rows. A malformed file cannot mark all rows successful.

The model-specific journey below defines whether there is a credit queue, facility or purchase queue. An absent role is shown honestly; adding a bank tab must not accidentally give the bank customer approval rights in every model. Statements distinguish face debt, acquired-asset price, facility balance, servicing mirror and verified cash. Bank API downtime remains visible and pending; neither PayStar nor super-admin can impersonate a bank confirmation.
### K1. No customer-credit role

`/bank/overview` explicitly states "Clinic-funded installment sale: no bank lending or approval role". Application/credit-decision, customer collections, facility and receivables-purchase navigation are absent and their APIs return 403. An optional bank settlement-observer mandate opens `/bank/account-reconciliation` for authorized account receipts only. The demo's bank role must function as an informative restricted workspace, not a blank error page or a fictional lender dashboard.
## Cross-role end-to-end acceptance scripts

1. **Happy path:** business-admin creates referral/order; customer submits identity/fee/evidence; paystar-admin reviews; model's creditor approves; customer signs and supplies correct checks; first payment confirms; funded-model payer confirms clinic funds; clinic records service; customer sees three remaining installments and correct creditor. All workspaces show the same references and amounts.
2. **Correction/rejection:** reviewer asks for income correction; customer edits only requested evidence, returns to saved stage; reviewer rejects with reapply date; clinic sees generic outcome; no credit line becomes spendable.
3. **Payment uncertainty:** customer payment mock times out; PayStar sees pending; duplicate webhook arrives after inquiry; exactly one receipt/allocation/journal/released principal exists. Page reload preserves result.
4. **Default and recovery:** advance demo clock past next due date; no new checkout is allowed; reminders and case follow correct days; enforcement/guarantee require creditor authority and evidence. Customer payment reduces balance once and appropriate dashboards update.
5. **Return:** clinic initiator and distinct checker approve half return; paid refund and unpaid cancellation match PRD numbers; customer withdraws funded wallet; duplicate approval has no effect. Finish full return and prove cumulative totals and no extra credit release.
6. **Security and isolation:** customer attempts another customer's URL; clinic attempts another tenant export; bank attempts forbidden model action; maker tries to check own command; all fail server-side without leaking sensitive fields.
7. **Model-specific lifecycle:** Model 1 lender repayment remains due after customer default; Model 2 bank workspace is restricted and check/online routes exclude each other; Model 3 exercises both recourse modes and both cash/transfer orders; Model 4 final approval/disbursement/refund acknowledgment require bank identity.

Each script has a resettable fixture or deterministic mock event in the build pack. Completion requires the persisted domain state, ledger and user-visible result to agree, not merely clickable prototype navigation.
