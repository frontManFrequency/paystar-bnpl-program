# Prototype readiness and completed gap review

Version 1.0 · 16 November 2026. This is a development handoff for four working prototypes; it is not a claim that the applications already exist or that live financial operations are approved.

## Deliverables and build boundary

Each model folder contains PRD.md, TAD.md, database_structure.md, Userflow.md and prototype_data.json. The root adds CLAUDE.md as single-session build instructions, schema.sql as executable PostgreSQL initial migration, openapi.json as a typed API contract, and validate_prototype_data.py as a repeatable static fixture/contract validator. Shared content is repeated in each four-document model set so a model folder remains understandable independently; root machine artifacts centralize field/API definitions to prevent drift.

Four working prototypes should share a domain kernel and be deployed with isolated model IDs, databases and ports. This is the explicit scope decision. No one blended application may silently move a customer between creditor models. A public launch is outside the prototype build and remains blocked by legal/banking release gates.

## Gap closure register

| Gap in original documents or build walk-through | Closed implementation decision | Evidence/destination |
|---|---|---|
| Four business models versus original bank-direct-only PRD | Creditor strategy per model; final decision, funds and holder routing differ | Model PRD identity table and section 11 |
| Five roles including bank without a lending role | Five workspaces; Model 2 bank limited information/authorized account observer | Every Userflow role section |
| Rate, basis, split, rounding and early settlement | Explicit 12% flat demo policy, independent component split, remaining commission only | PRD assumptions and examples; fixtures |
| Assessment fee and failed provider | 500,000 IRR once; executed-service non-refund; failed-service/duplicate refund | PRD A-06 and application flow |
| Tax amount and treatment | Prototype tax rate 0, separately stored tax; production tax policy release required, no assertion of tax exemption | Policy fixture and invoices schema |
| Currency ambiguity | Integer IRR API/DB; labeled toman UI and exact rial detail | All docs/API/fixtures |
| Monthly dates | Jalali anniversary with clamp and Tehran cutoff | TAD tests and actual fixture dates |
| Credit reserve, retry and races | Full-P reserve, principal-only release, expiry late receipt refund, locked caps | TAD transactions and tests |
| Debt/check records before purchase exists | Check and payment-intent checkout links; purchase link becomes populated on confirmation | SQL and API |
| Multiple clinic credit ownership | Model 2 per-creditor clinic line; other models inviter flag default false | PRD A-02 and model specializations |
| Merchant paid amount versus first installment | Funded model full P payout; first principal offsets net financing, never another merchant payout | Model examples and journals |
| Guarantees variety and order | NONE plus six instrument profiles, explicit cap/trigger, recovery and legal evidence | PRD guarantees; tables and role flows |
| Model 3 sale ownership vs cash timing | Effective owner independent of proceeds, bank payable/advance states, original schedules preserved | Model 3 PRD/TAD |
| Recourse ambiguity | Separate default-repurchase and warranty/service-return remedies; no ordinary default recourse on non-recourse lots | Model 3 guards and mocks |
| Full/partial refund, repeated rounding and commission | Cumulative proportional allocation, delta-only cancellation/refund, principal release once | PRD algorithm; refund fixtures/tests |
| Refund liquidity in low-capital models | Prefunded bridge, partner reimbursement claim and visible owed/unfunded incident state | PRD A-20 and wallet tables |
| Check presentation double collection | Mode lock plus pending-online drain, authenticated clearing and check return | Model 2 TAD/Userflow |
| Bank authority and asynchronous mirror | Expected vs acknowledged balances; bank final decision and disbursement | Model 4 bank instructions |
| Screens, permissions and empty/error states | Dedicated role journeys, routes, actions and server permission table | Userflows/TAD |
| APIs and persistence | Shared machine-readable contract, normalized schema with FKs/checks/indexes | openapi.json/schema.sql |
| Demo data and inaccessible live integrations | Synthetic stable UUIDs, role sessions, deterministic adapters and clock | Per-model JSON |
| Tests and one-session build order | Sequenced build contract and required evidence; no blank product decisions | CLAUDE.md |
| Legal/banking review | Versioned release bundle blocks live activation while mocks remain runnable | All PRDs/TADs |

## Additional binding prototype decisions

**Fees/tax:** Prototype VAT/other tax is 0 as a simulation input, not a legal exemption. Store `net`, `tax`, reversal and payer separately. Production legal/finance review must release exact tax treatment and invoice content. Subscription and bank service fee are separate from customer installment obligations. Alternative fees listed by the user remain configurable but zero by default, never silently collected.

**Missing live providers:** Mock provider names are `mock-identity`, `mock-credit`, `mock-account`, `mock-payment`, `mock-bank`, `mock-sayad`, `mock-signature`, `mock-sms`. No real provider access has been asserted. Production interface adapters require a signed integration/authorization contract and certification; unauthorized API discovery is not part of the prototype.

**Customer guarantee alternatives:** The baseline is three checks. Optional customer bank guarantee/cash collateral in Models 1/3 is a typed security profile, implemented using the dedicated `customer_securities` table and submission/verification endpoints. Backend checks coverage >= three remaining installment amounts, beneficiary, expiry >= final maturity+90 days and the enabled signed profile. Until that profile is enabled, UI offers checks only. Clinic's six guarantee forms are supported as described, including property and repurchase workflows; enforcement is an evidence/approval workflow, not automated legal execution.

**Environment scale:** Seed includes two clinics for isolation tests, not five live contracted clinics. Pilot cap is five clinics; prototype may demo with two. No real patient/customer personal information is present. Real-looking token prefixes are explicitly rejected by live adapters when beginning with DEMO or MOCK.

**Statements and servicing scope:** Include principal/commission/penalty/cancelled/refunded/paid/outstanding totals, creditor timeline, check release status, payment references and pending external adjustments. Never present a bank servicing mirror as PayStar's financial asset. Revenue reports use legal-book ownership and actual fee/commission events.

**Catalog completion:** Local SVG image placeholder and hosted clinic checkout are generated by the app; no external site is required to complete a demo. The hosted order page implements the same signed order contract as a clinic website. WooCommerce and custom-website connectors share that contract; a demo connector simulates price change, stale inventory and order callbacks without requiring a real store installation.

## Validation scope

The static validator checks document and API references, fixture relationships and monetary invariants. The follow-up review also executes the complete schema and all four seeds in on-disk embedded PostgreSQL, verifies financial constraints, owner overlap prevention, check uniqueness, basic model/tenant RLS and persistence. Reference financial and Jalali calendar tests pass. These do not substitute for concurrent server transactions, HTTP authorization or browser end-to-end testing in the actual application. No production compliance conclusion follows from a passing prototype test.

## Shared prototype copy and validation data

[prototype_content.json](../prototype_content.json) supplies Persian consent and notification text, labels, error messages, input normalization/checksum rules, explicit synthetic holiday policy and agreement section templates. These texts are simulation content; production consent/contracts require the signed release bundle. Generate agreements from these section templates plus exact model terms and immutable quote snapshots. Do not read entire seed/API files into model context: inspect relevant schemas/rows programmatically and use the compact read order above.

See [validation report](VALIDATION_REPORT.md) for the checks actually performed and the remaining application-level verification required during implementation.

## Bank-presentation readiness review — added after the initial handoff

The second review found concrete gaps and added only the materials needed to close them:

- [SESSION_BLUEPRINT.md](SESSION_BLUEPRINT.md): compact read order and implementation priorities for one sustained Claude session.
- [BANK_DEMO_PLAYBOOK.md](../BANK_DEMO_PLAYBOOK.md): fifteen-minute/five-minute scripts, exact money narrative, bank concerns and explicit pilot-design decision.
- [PRESENTATION_ACCEPTANCE.md](PRESENTATION_ACCEPTANCE.md): 25 mandatory presentation gates; app completion requires observed results, not just prepared documentation.
- [DIAGRAMS.md](../DIAGRAMS.md): six semantic funds/ownership/payment diagrams, statically validated; no visual-design work added.
- [implementation kit](implementation-kit/README.md): tested money/calendar code, seed importer and executable database harness.

A concrete schema gap was fixed: pre-purchase checks now persist `expected_installment_sequence`, with one active check per checkout/sequence. This avoids losing the installment association before purchase rows exist. All fixtures, schema docs and API fields are synchronized.

A local setup blocker was removed: verified PGlite 0.5.16 files are cached in this workspace and the harness runs without Docker/server PostgreSQL. An on-disk embedded backend is now explicitly allowed for the local prototypes; production still requires server PostgreSQL and its acceptance. npm registry/CDN access was intermittent during preparation; the verified cache supports the existing workspace, and the pinned bootstrap/normal npm command supports transfer to another environment. Do not assume future app framework dependencies are already installed.

The user explicitly said to forget design; no design system, screen mockups or styling assets were added. No further broad product documents are recommended before implementation. Run the app build, test and rehearsal next; a one-session outcome or a “perfect” application cannot be established before those checks pass.
