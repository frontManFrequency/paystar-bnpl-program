# Claude build instructions — four PayStar BNPL prototypes

## Outcome

Build four working, locally runnable prototypes using these completed specifications. Deliver an operational application for each business model, with persisted synthetic data and all five role workspaces. Use a common implementation kernel, but run four isolated databases and ports. Documentation alone, static mock screens, hardcoded dashboard metrics or one blended business model do not satisfy this build request.

This folder currently contains requirements, an executable initial PostgreSQL schema, an API contract and synthetic fixtures. **The web prototypes themselves have not been built yet.** This handoff is designed to let one Claude session implement them without asking product-design questions. Live lending, money movement, external messaging and legal execution remain disabled; use the provided deterministic adapters and demo clock. Required legal/banking release controls remain in the product for any future production activation.

## Read order and authority

1. This file, [compact session blueprint](SESSION_BLUEPRINT.md), [bank-manager walkthrough](../BANK_DEMO_PLAYBOOK.md) and [presentation acceptance](PRESENTATION_ACCEPTANCE.md). Consult [gap closure](PROTOTYPE_READINESS.md) as needed.
2. All four model PRDs: [Model 1](../model-1-paystar-creditor/PRD.md), [Model 2](../model-2-clinic-creditor/PRD.md), [Model 3](../model-3-receivables-sale/PRD.md), [Model 4](../model-4-bank-creditor/PRD.md). Shared numbered baseline sections are identical; read once, then each model's section 11 and identity table.
3. [Model 1 architecture](../model-1-paystar-creditor/TAD.md) shared sections, then section 10 of each other model's TAD.
4. [Database definition](../model-1-paystar-creditor/database_structure.md), [schema.sql](../schema.sql), [openapi.json](../openapi.json).
5. Each model's Userflow.md and prototype_data.json. Userflow has dedicated `super-admin`, `paystar-admin`, `business-admin`, `customer` and `bank` sections.

Precedence: user four-model specification and explicit model rules → shared baseline → historical original PRD/business-model. Do not revive historical undecided points or assume that all models are bank-direct lending. Preserve original root PRD.md and business-model.md; they are foundation evidence. Model-specific exceptions override generic workflow, especially bank approval, clinic payment, recourse and check ownership.

## Implementation contract

- Build a TypeScript/React/Next.js app, PostgreSQL persistence and a durable database worker; use the architecture choices in TAD. No external provider credentials are required. Generate compatible lockfile from installed dependencies; do not claim a package is installed without checking.
- Run `pnpm dev:model1`, `pnpm dev:model2`, `pnpm dev:model3`, `pnpm dev:model4` on ports 3101/3102/3103/3104. Each command uses its own DB URL and fixed MODEL_ID. Provide `pnpm dev:all`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm demo:reset`, `pnpm test`, `pnpm test:e2e` and setup instructions. npm equivalents are acceptable if pnpm is unavailable; provide consistent scripts.
- Use PostgreSQL databases `paystar_m1`–`paystar_m4` when available. If no server/Docker exists, use the reviewed PGlite 0.5.16 backend with four separate on-disk data directories, one process each, and transaction callback serialization. This explicit prototype fallback removes a local setup blocker while preserving the SQL schema and disk persistence. It does not replace production server PostgreSQL or its concurrency tests.
- Apply schema.sql per database. Seed JSON rowsets in a transaction with deferred FKs; insert journals as DRAFT, then lines, then POSTED. SQL triggers intentionally reject directly inserting posted headers. Use stable IDs and isolated reset. Runtime DB role must differ from owner/migration role so RLS works.
- Implement model authorization in server handlers and repositories; RLS adds model/tenant defense. Every role has an accessible demo session. Model 2 bank workspace is deliberately restricted but informative. A super-admin cannot impersonate a creditor decision or a bank cash confirmation.
- Persian RTL UI with exact currency labels and Jalali calendar, mobile support and accessible controls. Generate simple SVG clinic placeholders in code; no external images or API keys. Use server-side BigInt/rational arithmetic, not JS floating-point currency.
- All main buttons perform persistent operations. Dashboard balances derive from the same journals/installments/ownership records as statements. The guided demo can reset/replay every supplied scenario. Demo IDs `DEMO-*` are accepted only by mock validators.
- Mock bank/KYC/payment/Sayad/signature/SMS providers are internal adapters, with visible "simulation" labeling and no network side effect. Their event callbacks still use signatures, idempotency and production-shaped envelopes. `/demo/events` may schedule a mock response, but must invoke ordinary domain handlers and cannot directly set balances.
- Contracts are generated readable demo documents from signed term snapshots. Show creditor, check beneficiary, four installments, pricing/fees, return terms and simulation label. Never describe demo signatures or Sayad status as a real legal operation.
- The signed policy assumption values are complete for implementation. Preserve mandatory production release bundle. Do not ask the user to choose rates, dates, roles, tables, provider names or default paths; use the documented decisions. If a real integration is unavailable, retain mock behavior and explicit pending state, not a fabricated success.

## One-session build sequence

1. Inspect available runtime and existing workspace; bootstrap shared app/kernel/config and migrations, preserving documentation.
2. Reuse `implementation-kit/domain.mjs` and its passing tests for money, commission, splitting, allocation, returns, guarantees, sale pricing and affordability. Reuse `implementation-kit/calendar.mjs` and its Jalali/calendar tests; add application transaction/authorization tests; do not rewrite the kernel without preserving its contract.
3. Implement DB repositories, verified demo sessions, role/tenant authorization, transaction/idempotency helpers, ledger posting, inbox/outbox and mock adapter registry. Seed all four DBs and check fixture balances.
4. Implement shared pages: role dashboards; referral/OTP/consent/KYC/account/application; review/correction; line; clinic order/checkout/contract/check verification; first payment; purchase/installments/receipt; catalog/showcase; refund/wallet/withdrawal; support/collections/guarantee; statements/audit/reconciliation. Build these on actual endpoints.
5. Implement four model modules, in order: Model 4 final bank decision/draw/mandate for the primary walkthrough; Model 2 clinic decision and collection; Model 1 facility/PayStar funding; Model 3 eligibility/offer/assignment/cash/recourse. Use a server-side strategy registry for authority and routing, not UI-only conditionals.
6. Implement durable jobs and fixed/advanceable clock. Run all five role flows per model. Make confirmation and error/pending states clear; exercise role-switch navigation on one underlying transaction.
7. Run type, domain, migration, authorization, webhook-race, ledger and browser tests. Repair failures. Start all four apps, inspect each role's main screens and at least one complete mutation flow per model. Report actual commands, URLs and limitations. Do not claim real bank/Sayad/payment certification.

Work through shared foundations once and implement every model before spending time polishing minor style. If context gets tight, write progress/next steps to a local build status file and continue; do not silently drop model-specific behavior. The goal is a complete demo, not a guaranteed prediction about how much an arbitrary model session can finish.

## Exact required demonstrations

| Model | Creditor action | Funding/payment | Distinct demonstration |
|---|---|---|---|
| 1 | PayStar final approval | PayStar clinic payout; separate lender schedule | Customer default leaves PayStar bank repayment due unchanged |
| 2 | Clinic final approval | Customer installment receipts directly to clinic | Check presentation and online payment mutually exclusive; no bank credit role |
| 3 | PayStar origination; bank purchase decision | Clinic paid before sale; sale cash separate from legal transfer | Both recourse modes, rejected sale, legal-before-cash and cash-before-legal |
| 4 | Bank final approval | Bank pays clinic and receives installments | Bank correction/rejection; bank-only funds confirmation; refund amendment acknowledgement |

All four must also show correction, failure/timeout, duplicate callback, early payoff, 50% return then full return, refund wallet withdrawal, overdue hold, role isolation and maker/checker rejection. The standard example is 400,000,000 IRR principal, 48,000,000 commission, four payments of 112,000,000, and after first payment 300,000,000 outstanding principal.

## Completion evidence

Deliver repository code, setup/env example without secrets, migration and seed commands, four running URLs, demo user/role chooser, passing test results, and a concise implementation report mapping each required scenario to a test/result. Retain production legal and banking gates. Do not send real SMS/email, submit real credit checks, transfer real money, register real checks, or publish externally as part of this prototype build.

## Shared prototype copy and validation data

[prototype_content.json](../prototype_content.json) supplies Persian consent and notification text, labels, error messages, input normalization/checksum rules, explicit synthetic holiday policy and agreement section templates. These texts are simulation content; production consent/contracts require the signed release bundle. Generate agreements from these section templates plus exact model terms and immutable quote snapshots. Do not read entire seed/API files into model context: inspect relevant schemas/rows programmatically and use the compact read order above.

Seeded identity/income document keys resolve through the mock storage adapter to the embedded synthetic asset in prototype_content.json; render the category and demo identity in a visibly labeled preview. Actual uploaded files use real byte hashes and scanner results. Seeded fee receipts and clinic subscription postings are present, so revenue and audit pages can be derived from data.

## Latest review decisions

The user explicitly excluded additional visual-design work. Focus on functional completeness, correct bank-facing evidence, reliable setup and the meeting walkthrough. Reuse [implementation-kit/README.md](implementation-kit/README.md). All P0 checks in [PRESENTATION_ACCEPTANCE.md](PRESENTATION_ACCEPTANCE.md) must pass before calling the application presentation-ready. Current database-harness results validate embedded PostgreSQL behavior, not a completed browser application.
