# Model 3 — PayStar originates and sells receivables
## Database structure

Version 1.0 · 16 November 2026 · implementation baseline and prototype specification.

Read this model's [PRD](PRD.md), [architecture](TAD.md), [database](database_structure.md) and [role flows](Userflow.md) together. The [single-session build instructions](../application/CLAUDE.md), [API contract](../openapi.json), [SQL schema](../schema.sql) and [synthetic fixture](prototype_data.json) are part of the build handoff.

**Decision precedence:** this user's four-model requirements → this model's explicit rules → shared baseline below → original [PRD](../PRD.md) and [business model](../business-model.md). Original source files remain historical inputs. Values marked **A-** are chosen implementation assumptions, not evidence of a signed commercial agreement or regulatory permission. No unresolved product decision is delegated to the implementer. Production activation requires the specified legal and banking review; prototypes run with isolated mocks.
## 1. Database conventions and authoritative boundaries

The executable [schema.sql](../schema.sql) is the canonical initial migration and the field catalog below is generated from the same definitions. PostgreSQL 16+, UTF-8, UTC timestamps, IRR bigint monetary columns. API money is a decimal string to avoid JavaScript integer precision assumptions. IDs are UUID. Every table has `id`, `model_id` (1–4), nullable `tenant_id`, `created_at`, `updated_at` and optimistic `version`; `UNIQUE(id,model_id)` enables composite references that prevent cross-model links. `tenant_id` is the responsible clinic/bank for restricted rows, or null for shared platform/customer infrastructure. Null never means public API access.

Foreign keys use NO ACTION with deferred validation; there is no cascading deletion of financial records. All `@table` references below mean a UUID composite foreign key to `(id,model_id)` in that table. Required fields say NOT NULL; omitted NOT NULL means nullable. JSON is allowed for immutable policy/evidence/line-item snapshots, not as the authoritative store of balances, payment allocations, ownership or security amounts. Core scalar fields must be queried through typed repositories, not raw JSON guessing.

Common timestamps and version must be set by repository updates: expected `version` in WHERE, increment once per mutation, fail conflict if affected rows !=1. Posted records and append-only histories use immutable events instead. Encrypted fields and lookup hashes have separate keys. Do not store complete card number, CVV, PIN, banking password or real personal data in fixtures.

## 2. Relationship map and aggregate ownership

Organizations→memberships/users; user→customer→applications→decisions/assessments/documents; application→credit_line/contracts; business→referral/catalog/order; order→checkout→reservation→purchase→four installments→payment allocations/checks. A payment receipt points to one intent and many component allocations. Purchase has immutable originator and time-versioned current owner. Refund→component adjustments→wallet entries/partner settlements. Journal→two or more lines→same legal-book accounts. Guarantee→claims→collection case. Model 1 facility→movements and independent dues. Model 3 portfolio→lots→ownership history/recourse claims. Model 4 bank instruction links expected and acknowledged state to application/purchase.

The authoritative debt is original installment components minus cancellations and paid allocations, with refunds of prior paid components tracked separately. `principal_paid_irr` is cumulative successful paid amount net of actual payment reversals, not net of return refunds. Therefore refunding a previously paid principal does not resurrect debt. Financial reversals and schedule amendments are new events with references to originals. A hardship schedule has a new schedule_version; old rows become SUPERSEDED, with remaining amounts carried forward once and original payments retained. Queries select the active schedule version.

## 3. Table and field catalog

### `organizations`

Legal parties: PayStar, clinic, bank, investor; identity and verified payout destination.

| Field | SQL type / nullability / invariant |
|---|---|
| `name` | `text NOT NULL` |
| `party_type` | `text NOT NULL CHECK (party_type IN ('PAYSTAR','CLINIC','BANK','INVESTOR'))` |
| `legal_identifier_token` | `text NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'ACTIVE'` |
| `payout_account_token` | `text` |
| `slug` | `text` |

Additional constraints: `UNIQUE (model_id, legal_identifier_token), UNIQUE (model_id, slug)`.

### `users`

Login identity; no plaintext credentials or sensitive ID in fixtures.

| Field | SQL type / nullability / invariant |
|---|---|
| `display_name` | `text NOT NULL` |
| `mobile_token` | `text NOT NULL` |
| `national_id_hash` | `text` |
| `national_id_encrypted` | `text` |
| `status` | `text NOT NULL DEFAULT 'ACTIVE'` |

Additional constraints: `UNIQUE (model_id,mobile_token), UNIQUE (model_id,national_id_hash)`.

### `memberships`

Five role grants with organization and least-privilege subscopes.

| Field | SQL type / nullability / invariant |
|---|---|
| `user_id` | `@users NOT NULL` |
| `organization_id` | `@organizations` |
| `role` | `text NOT NULL CHECK (role IN ('super-admin','paystar-admin','business-admin','customer','bank'))` |
| `scopes` | `jsonb NOT NULL DEFAULT '[]'` |
| `status` | `text NOT NULL DEFAULT 'ACTIVE'` |

### `sessions`

Revocable sessions and demo login identity.

| Field | SQL type / nullability / invariant |
|---|---|
| `user_id` | `@users NOT NULL` |
| `session_hash` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz` |
| `mfa_verified` | `boolean NOT NULL DEFAULT false` |

Additional constraints: `UNIQUE (model_id,session_hash)`.

### `customers`

Customer legal/contact identity and affordability input; sensitive values tokenized/encrypted.

| Field | SQL type / nullability / invariant |
|---|---|
| `user_id` | `@users NOT NULL` |
| `identity_details` | `jsonb NOT NULL DEFAULT '{}'` |
| `verified_monthly_income_irr` | `bigint NOT NULL DEFAULT 0 CHECK (verified_monthly_income_irr >= 0)` |
| `external_monthly_obligations_irr` | `bigint NOT NULL DEFAULT 0 CHECK (external_monthly_obligations_irr >= 0)` |
| `kyc_status` | `text NOT NULL DEFAULT 'UNVERIFIED'` |
| `kyc_verified_at` | `timestamptz` |

Additional constraints: `UNIQUE (model_id,user_id)`.

### `bank_accounts`

Verified owner account references, never full card credentials.

| Field | SQL type / nullability / invariant |
|---|---|
| `owner_user_id` | `@users` |
| `owner_organization_id` | `@organizations` |
| `provider_token` | `text NOT NULL` |
| `iban_encrypted` | `text NOT NULL` |
| `bank_name` | `text NOT NULL` |
| `card_last4` | `char(4)` |
| `owner_match` | `boolean NOT NULL DEFAULT false` |
| `verified_at` | `timestamptz` |
| `cooling_until` | `timestamptz` |

Additional constraints: `CHECK ((owner_user_id IS NULL) <> (owner_organization_id IS NULL)), UNIQUE (model_id,provider_token)`.

### `referrals`

Signed invitation and immutable submitted application attribution.

| Field | SQL type / nullability / invariant |
|---|---|
| `business_id` | `@organizations NOT NULL` |
| `token_hash` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz` |
| `source` | `text NOT NULL DEFAULT 'CLINIC_LINK'` |

Additional constraints: `UNIQUE (model_id,token_hash)`.

### `consents`

Versioned purpose consent, withdrawal history and proof.

| Field | SQL type / nullability / invariant |
|---|---|
| `customer_id` | `@customers NOT NULL` |
| `purpose` | `text NOT NULL` |
| `text_version` | `text NOT NULL` |
| `text_hash` | `text NOT NULL` |
| `given_at` | `timestamptz NOT NULL` |
| `withdrawn_at` | `timestamptz` |
| `proof` | `jsonb NOT NULL DEFAULT '{}'` |

### `policies`

Immutable price/risk/refund/collection configuration after two-person release.

| Field | SQL type / nullability / invariant |
|---|---|
| `name` | `text NOT NULL` |
| `policy_version` | `integer NOT NULL` |
| `configuration` | `jsonb NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'DRAFT'` |
| `effective_at` | `timestamptz` |
| `agreement_hash` | `text` |
| `proposed_by` | `@users NOT NULL` |
| `approved_by` | `@users` |

Additional constraints: `UNIQUE (model_id,name,policy_version), CHECK (approved_by IS NULL OR approved_by <> proposed_by)`.

### `applications`

Application workflow, review return stage and decision scope.

| Field | SQL type / nullability / invariant |
|---|---|
| `customer_id` | `@customers NOT NULL` |
| `referral_id` | `@referrals NOT NULL` |
| `creditor_id` | `@organizations NOT NULL` |
| `policy_id` | `@policies NOT NULL` |
| `status` | `text NOT NULL` |
| `resume_stage` | `text` |
| `recommended_limit_irr` | `bigint NOT NULL DEFAULT 0 CHECK (recommended_limit_irr >= 0)` |
| `approved_limit_irr` | `bigint CHECK (approved_limit_irr >= 0)` |
| `inviter_only` | `boolean NOT NULL DEFAULT false` |
| `correction_due_at` | `timestamptz` |
| `reapply_at` | `timestamptz` |
| `expires_at` | `timestamptz NOT NULL` |
| `previous_application_id` | `@applications` |

### `documents`

Immutable file references and hashes, scan/read authorization evidence.

| Field | SQL type / nullability / invariant |
|---|---|
| `application_id` | `@applications` |
| `customer_id` | `@customers` |
| `category` | `text NOT NULL` |
| `object_key` | `text NOT NULL` |
| `content_hash` | `text NOT NULL` |
| `mime_type` | `text NOT NULL` |
| `size_bytes` | `bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760)` |
| `scan_status` | `text NOT NULL DEFAULT 'PENDING'` |
| `retention_until` | `timestamptz` |
| `legal_hold` | `boolean NOT NULL DEFAULT false` |

### `assessments`

Provider evidence and normalized decision features, not an unexplained score.

| Field | SQL type / nullability / invariant |
|---|---|
| `application_id` | `@applications NOT NULL` |
| `provider_reference` | `text NOT NULL` |
| `risk_band` | `text NOT NULL CHECK (risk_band IN ('A','B','C','D','UNKNOWN'))` |
| `existing_obligations_irr` | `bigint NOT NULL DEFAULT 0` |
| `report_hash` | `text NOT NULL` |
| `assessed_at` | `timestamptz NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `features` | `jsonb NOT NULL DEFAULT '{}'` |

Additional constraints: `UNIQUE (model_id,provider_reference)`.

### `decisions`

Append-only human decisions and field-level correction/appeal rationale.

| Field | SQL type / nullability / invariant |
|---|---|
| `application_id` | `@applications NOT NULL` |
| `actor_id` | `@users NOT NULL` |
| `stage` | `text NOT NULL` |
| `outcome` | `text NOT NULL CHECK (outcome IN ('APPROVE','REJECT','CORRECTION'))` |
| `reason_code` | `text NOT NULL` |
| `customer_message` | `text NOT NULL` |
| `field_errors` | `jsonb NOT NULL DEFAULT '[]'` |
| `approved_limit_irr` | `bigint` |

### `credit_lines`

Approved limit and locked balance projection; customer exposure remains after sale.

| Field | SQL type / nullability / invariant |
|---|---|
| `customer_id` | `@customers NOT NULL` |
| `application_id` | `@applications NOT NULL` |
| `creditor_id` | `@organizations NOT NULL` |
| `allowed_business_id` | `@organizations` |
| `limit_irr` | `bigint NOT NULL CHECK (limit_irr BETWEEN 0 AND 400000000)` |
| `outstanding_principal_irr` | `bigint NOT NULL DEFAULT 0 CHECK (outstanding_principal_irr >= 0)` |
| `reserved_principal_irr` | `bigint NOT NULL DEFAULT 0 CHECK (reserved_principal_irr >= 0)` |
| `status` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `hold_reason` | `text` |

Additional constraints: `UNIQUE (model_id,application_id)`.

### `exposure_buckets`

Serialization lock and aggregate cap for customer, clinic, funding pool or program.

| Field | SQL type / nullability / invariant |
|---|---|
| `scope_type` | `text NOT NULL` |
| `scope_key` | `text NOT NULL` |
| `limit_irr` | `bigint NOT NULL CHECK (limit_irr >= 0)` |
| `outstanding_irr` | `bigint NOT NULL DEFAULT 0` |
| `reserved_irr` | `bigint NOT NULL DEFAULT 0` |

Additional constraints: `UNIQUE (model_id,scope_type,scope_key), CHECK (outstanding_irr >= 0 AND reserved_irr >= 0)`.

### `catalog_items`

Service/merchant catalog with freshness and link data; no diagnosis.

| Field | SQL type / nullability / invariant |
|---|---|
| `business_id` | `@organizations NOT NULL` |
| `external_sku` | `text NOT NULL` |
| `title` | `text NOT NULL` |
| `category` | `text NOT NULL` |
| `price_irr` | `bigint NOT NULL CHECK (price_irr > 0)` |
| `available` | `boolean NOT NULL DEFAULT true` |
| `image_url` | `text` |
| `checkout_url` | `text NOT NULL` |
| `source_updated_at` | `timestamptz NOT NULL` |

Additional constraints: `UNIQUE (model_id,business_id,external_sku)`.

### `orders`

Authoritative selling-clinic order, explicit cash contribution and quote version.

| Field | SQL type / nullability / invariant |
|---|---|
| `business_id` | `@organizations NOT NULL` |
| `customer_id` | `@customers NOT NULL` |
| `external_reference` | `text NOT NULL` |
| `service_total_irr` | `bigint NOT NULL CHECK (service_total_irr > 0)` |
| `financed_principal_irr` | `bigint NOT NULL CHECK (financed_principal_irr > 0)` |
| `cash_contribution_irr` | `bigint NOT NULL DEFAULT 0 CHECK (cash_contribution_irr >= 0)` |
| `line_items` | `jsonb NOT NULL` |
| `status` | `text NOT NULL` |

Additional constraints: `UNIQUE (model_id,business_id,external_reference), CHECK (service_total_irr = financed_principal_irr + cash_contribution_irr)`.

### `checkouts`

Frozen quote, reservation and first-payment lifecycle.

| Field | SQL type / nullability / invariant |
|---|---|
| `order_id` | `@orders NOT NULL` |
| `credit_line_id` | `@credit_lines NOT NULL` |
| `principal_irr` | `bigint NOT NULL CHECK (principal_irr > 0)` |
| `commission_irr` | `bigint NOT NULL CHECK (commission_irr >= 0)` |
| `quote_hash` | `text NOT NULL` |
| `quote_snapshot` | `jsonb NOT NULL` |
| `status` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |

### `reservations`

Exactly one economic reservation per checkout, separate funding reservation.

| Field | SQL type / nullability / invariant |
|---|---|
| `checkout_id` | `@checkouts NOT NULL` |
| `credit_line_id` | `@credit_lines NOT NULL` |
| `principal_irr` | `bigint NOT NULL CHECK (principal_irr > 0)` |
| `funding_reserved_irr` | `bigint NOT NULL DEFAULT 0 CHECK (funding_reserved_irr >= 0)` |
| `status` | `text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED'))` |
| `expires_at` | `timestamptz NOT NULL` |

Additional constraints: `UNIQUE (model_id,checkout_id)`.

### `contracts`

Immutable legal-document snapshot and all signers/evidence.

| Field | SQL type / nullability / invariant |
|---|---|
| `application_id` | `@applications NOT NULL` |
| `checkout_id` | `@checkouts` |
| `creditor_id` | `@organizations NOT NULL` |
| `policy_id` | `@policies NOT NULL` |
| `contract_type` | `text NOT NULL` |
| `document_hash` | `text NOT NULL` |
| `status` | `text NOT NULL` |
| `signed_at` | `timestamptz` |
| `signature_evidence` | `jsonb NOT NULL DEFAULT '{}'` |
| `terms_snapshot` | `jsonb NOT NULL` |

### `purchases`

Confirmed originated obligation and independent service lifecycle.

| Field | SQL type / nullability / invariant |
|---|---|
| `checkout_id` | `@checkouts NOT NULL` |
| `customer_id` | `@customers NOT NULL` |
| `business_id` | `@organizations NOT NULL` |
| `credit_line_id` | `@credit_lines NOT NULL` |
| `contract_id` | `@contracts NOT NULL` |
| `originator_id` | `@organizations NOT NULL` |
| `current_owner_id` | `@organizations NOT NULL` |
| `principal_irr` | `bigint NOT NULL CHECK (principal_irr > 0)` |
| `commission_irr` | `bigint NOT NULL CHECK (commission_irr >= 0)` |
| `returned_principal_irr` | `bigint NOT NULL DEFAULT 0` |
| `status` | `text NOT NULL` |
| `service_status` | `text NOT NULL` |
| `confirmed_at` | `timestamptz NOT NULL` |
| `owner_epoch` | `integer NOT NULL DEFAULT 1` |
| `service_evidence` | `jsonb NOT NULL DEFAULT '{}'` |

Additional constraints: `UNIQUE (model_id,checkout_id), CHECK (returned_principal_irr BETWEEN 0 AND principal_irr)`.

### `installments`

Four original component amounts with cumulative paid/cancelled/refunded projections.

| Field | SQL type / nullability / invariant |
|---|---|
| `purchase_id` | `@purchases NOT NULL` |
| `sequence` | `smallint NOT NULL CHECK (sequence BETWEEN 1 AND 4)` |
| `due_at` | `timestamptz NOT NULL` |
| `due_local_date` | `text NOT NULL` |
| `principal_irr` | `bigint NOT NULL CHECK (principal_irr >= 0)` |
| `commission_irr` | `bigint NOT NULL CHECK (commission_irr >= 0)` |
| `penalty_irr` | `bigint NOT NULL DEFAULT 0 CHECK (penalty_irr >= 0)` |
| `principal_paid_irr` | `bigint NOT NULL DEFAULT 0` |
| `commission_paid_irr` | `bigint NOT NULL DEFAULT 0` |
| `penalty_paid_irr` | `bigint NOT NULL DEFAULT 0` |
| `principal_cancelled_irr` | `bigint NOT NULL DEFAULT 0` |
| `commission_cancelled_irr` | `bigint NOT NULL DEFAULT 0` |
| `principal_refunded_irr` | `bigint NOT NULL DEFAULT 0` |
| `commission_refunded_irr` | `bigint NOT NULL DEFAULT 0` |
| `payment_mode` | `text NOT NULL DEFAULT 'ONLINE'` |
| `status` | `text NOT NULL` |
| `schedule_version` | `integer NOT NULL DEFAULT 1` |

Additional constraints: `UNIQUE (model_id,purchase_id,sequence,schedule_version), CHECK (principal_paid_irr >= 0 AND commission_paid_irr >= 0 AND penalty_paid_irr >= 0), CHECK (principal_cancelled_irr >= 0 AND commission_cancelled_irr >= 0), CHECK (principal_paid_irr + principal_cancelled_irr <= principal_irr), CHECK (commission_paid_irr + commission_cancelled_irr <= commission_irr), CHECK (principal_refunded_irr BETWEEN 0 AND principal_paid_irr), CHECK (commission_refunded_irr BETWEEN 0 AND commission_paid_irr)`.

### `checks`

Sayad/security metadata with issuer, actual holder and presentation lock.

| Field | SQL type / nullability / invariant |
|---|---|
| `expected_installment_sequence` | `smallint NOT NULL CHECK (expected_installment_sequence BETWEEN 2 AND 4)` |
| `checkout_id` | `@checkouts NOT NULL` |
| `purchase_id` | `@purchases` |
| `installment_id` | `@installments` |
| `sayad_id_token` | `text NOT NULL` |
| `issuer_customer_id` | `@customers NOT NULL` |
| `beneficiary_id` | `@organizations NOT NULL` |
| `custodian_id` | `@organizations NOT NULL` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `maturity_date` | `date NOT NULL` |
| `status` | `text NOT NULL` |
| `evidence` | `jsonb NOT NULL DEFAULT '{}'` |

Additional constraints: `UNIQUE (model_id,sayad_id_token)`.

One non-released/non-voided check per checkout and intended installment sequence is enforced by a partial unique index. This sequence exists before purchase/ installment rows and is mapped atomically at first-payment confirmation. Replacements require prior release/void evidence.

### `check_events`

Append-only custody, acceptance, presentation, clearance and release history.

| Field | SQL type / nullability / invariant |
|---|---|
| `check_id` | `@checks NOT NULL` |
| `event_type` | `text NOT NULL` |
| `from_holder_id` | `@organizations` |
| `to_holder_id` | `@organizations` |
| `external_reference` | `text NOT NULL` |
| `effective_at` | `timestamptz NOT NULL` |
| `evidence_hash` | `text NOT NULL` |
| `actor_id` | `@users NOT NULL` |

Additional constraints: `UNIQUE (model_id,check_id,external_reference)`.

### `payment_intents`

Requested collection; callback never defines arbitrary receivable ownership.

| Field | SQL type / nullability / invariant |
|---|---|
| `customer_id` | `@customers NOT NULL` |
| `checkout_id` | `@checkouts` |
| `purchase_id` | `@purchases` |
| `application_id` | `@applications` |
| `creditor_id` | `@organizations NOT NULL` |
| `purpose` | `text NOT NULL` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `currency` | `char(3) NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR')` |
| `provider` | `text NOT NULL` |
| `provider_intent_ref` | `text NOT NULL` |
| `status` | `text NOT NULL` |
| `owner_epoch` | `integer` |
| `expires_at` | `timestamptz NOT NULL` |

Additional constraints: `UNIQUE (model_id,provider,provider_intent_ref)`.

### `payment_receipts`

Authenticated provider settlement fact, immutable economic receipt.

| Field | SQL type / nullability / invariant |
|---|---|
| `intent_id` | `@payment_intents NOT NULL` |
| `provider` | `text NOT NULL` |
| `provider_reference` | `text NOT NULL` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `received_at` | `timestamptz NOT NULL` |
| `status` | `text NOT NULL` |
| `reversal_of_id` | `@payment_receipts` |

Additional constraints: `UNIQUE (model_id,provider,provider_reference)`.

### `payment_allocations`

Receipt to installment component mapping, supports reversal and excess clearing.

| Field | SQL type / nullability / invariant |
|---|---|
| `receipt_id` | `@payment_receipts NOT NULL` |
| `installment_id` | `@installments NOT NULL` |
| `component` | `text NOT NULL CHECK (component IN ('PRINCIPAL','COMMISSION','PENALTY'))` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `reversed_at` | `timestamptz` |

Additional constraints: `UNIQUE (model_id,receipt_id,installment_id,component)`.

### `ledger_accounts`

Chart of accounts segregated by book, party, kind and restrictions.

| Field | SQL type / nullability / invariant |
|---|---|
| `book_party_id` | `@organizations NOT NULL` |
| `account_code` | `text NOT NULL` |
| `account_type` | `text NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE','MEMO'))` |
| `is_external_mirror` | `boolean NOT NULL DEFAULT false` |
| `restricted` | `boolean NOT NULL DEFAULT false` |

Additional constraints: `UNIQUE (model_id,book_party_id,account_code,is_external_mirror)`.

### `journals`

Balanced immutable financial event, independently balanced within one legal book.

| Field | SQL type / nullability / invariant |
|---|---|
| `book_party_id` | `@organizations NOT NULL` |
| `event_key` | `text NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED'))` |
| `posted_at` | `timestamptz` |
| `reversal_of_id` | `@journals` |
| `source_type` | `text NOT NULL` |
| `source_id` | `uuid NOT NULL` |

Additional constraints: `UNIQUE (model_id,book_party_id,event_key)`.

### `journal_lines`

Debit/credit integer rows; account book must match journal book.

| Field | SQL type / nullability / invariant |
|---|---|
| `journal_id` | `@journals NOT NULL` |
| `account_id` | `@ledger_accounts NOT NULL` |
| `debit_irr` | `bigint NOT NULL DEFAULT 0` |
| `credit_irr` | `bigint NOT NULL DEFAULT 0` |

Additional constraints: `CHECK (debit_irr >= 0 AND credit_irr >= 0 AND ((debit_irr = 0) <> (credit_irr = 0)))`.

### `settlements`

Clinic payout obligations or partner refund/commission reimbursement, never duplicate cash transfer.

| Field | SQL type / nullability / invariant |
|---|---|
| `purchase_id` | `@purchases` |
| `from_party_id` | `@organizations NOT NULL` |
| `to_party_id` | `@organizations NOT NULL` |
| `kind` | `text NOT NULL` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `due_at` | `timestamptz NOT NULL` |
| `status` | `text NOT NULL` |
| `external_reference` | `text` |
| `confirmed_at` | `timestamptz` |

Additional constraints: `UNIQUE (model_id,external_reference)`.

### `refunds`

Clinic authorized cumulative return and customer paid-component entitlement.

| Field | SQL type / nullability / invariant |
|---|---|
| `purchase_id` | `@purchases NOT NULL` |
| `requested_by` | `@users NOT NULL` |
| `approved_by` | `@users` |
| `cumulative_principal_irr` | `bigint NOT NULL CHECK (cumulative_principal_irr > 0)` |
| `principal_delta_irr` | `bigint NOT NULL CHECK (principal_delta_irr > 0)` |
| `commission_delta_irr` | `bigint NOT NULL CHECK (commission_delta_irr >= 0)` |
| `wallet_entitlement_irr` | `bigint NOT NULL CHECK (wallet_entitlement_irr >= 0)` |
| `reason` | `text NOT NULL` |
| `status` | `text NOT NULL` |
| `posted_at` | `timestamptz` |

Additional constraints: `CHECK (approved_by IS NULL OR approved_by <> requested_by)`.

### `refund_components`

Per-installment return deltas; distinguishes cancelling unpaid and refunding paid amounts.

| Field | SQL type / nullability / invariant |
|---|---|
| `refund_id` | `@refunds NOT NULL` |
| `installment_id` | `@installments NOT NULL` |
| `component` | `text NOT NULL CHECK (component IN ('PRINCIPAL','COMMISSION'))` |
| `cancelled_irr` | `bigint NOT NULL DEFAULT 0 CHECK (cancelled_irr >= 0)` |
| `refunded_irr` | `bigint NOT NULL DEFAULT 0 CHECK (refunded_irr >= 0)` |

Additional constraints: `UNIQUE (model_id,refund_id,installment_id,component)`.

### `wallets`

Refund-only customer liability projection and funded/held amounts.

| Field | SQL type / nullability / invariant |
|---|---|
| `customer_id` | `@customers NOT NULL` |
| `liability_irr` | `bigint NOT NULL DEFAULT 0` |
| `funded_irr` | `bigint NOT NULL DEFAULT 0` |
| `held_irr` | `bigint NOT NULL DEFAULT 0` |

Additional constraints: `UNIQUE (model_id,customer_id), CHECK (liability_irr >= 0 AND funded_irr BETWEEN 0 AND liability_irr AND held_irr BETWEEN 0 AND funded_irr)`.

### `wallet_entries`

Append-only entitlement, funding, hold/release and withdrawal events.

| Field | SQL type / nullability / invariant |
|---|---|
| `wallet_id` | `@wallets NOT NULL` |
| `refund_id` | `@refunds` |
| `entry_type` | `text NOT NULL` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `event_key` | `text NOT NULL` |
| `journal_id` | `@journals` |

Additional constraints: `UNIQUE (model_id,event_key)`.

### `withdrawals`

Confirmed same-owner bank payout with uncertainty retained.

| Field | SQL type / nullability / invariant |
|---|---|
| `wallet_id` | `@wallets NOT NULL` |
| `bank_account_id` | `@bank_accounts NOT NULL` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `status` | `text NOT NULL` |
| `provider_reference` | `text` |
| `confirmed_at` | `timestamptz` |

Additional constraints: `UNIQUE (model_id,provider_reference)`.

### `collection_cases`

Delinquency and legal handoff; economic recovery and legal debt tracked separately.

| Field | SQL type / nullability / invariant |
|---|---|
| `purchase_id` | `@purchases NOT NULL` |
| `creditor_id` | `@organizations NOT NULL` |
| `assigned_to` | `@users` |
| `stage` | `text NOT NULL` |
| `dpd` | `integer NOT NULL CHECK (dpd >= 0)` |
| `legal_authorized_at` | `timestamptz` |
| `evidence` | `jsonb NOT NULL DEFAULT '{}'` |

### `collection_actions`

Contact, check attempts and legal steps with results and timing.

| Field | SQL type / nullability / invariant |
|---|---|
| `case_id` | `@collection_cases NOT NULL` |
| `actor_id` | `@users NOT NULL` |
| `action_type` | `text NOT NULL` |
| `occurred_at` | `timestamptz NOT NULL` |
| `result_code` | `text NOT NULL` |
| `notes` | `text NOT NULL` |

### `guarantees`

Capped clinic security contract; all forms explicit, no implied full guarantee.

| Field | SQL type / nullability / invariant |
|---|---|
| `business_id` | `@organizations NOT NULL` |
| `beneficiary_id` | `@organizations NOT NULL` |
| `guarantee_type` | `text NOT NULL CHECK (guarantee_type IN ('CASH','INSTRUMENT','PROPERTY','LOSS_SHARE','REPURCHASE','RESERVE'))` |
| `coverage_bps` | `integer NOT NULL CHECK (coverage_bps BETWEEN 0 AND 10000)` |
| `cap_irr` | `bigint NOT NULL CHECK (cap_irr > 0)` |
| `used_irr` | `bigint NOT NULL DEFAULT 0 CHECK (used_irr >= 0)` |
| `reserved_claim_irr` | `bigint NOT NULL DEFAULT 0 CHECK (reserved_claim_irr >= 0)` |
| `expires_at` | `timestamptz NOT NULL` |
| `assignable` | `boolean NOT NULL DEFAULT false` |
| `contract_hash` | `text NOT NULL` |
| `terms` | `jsonb NOT NULL` |

Additional constraints: `CHECK (used_irr + reserved_claim_irr <= cap_irr)`.

### `guarantee_claims`

Claim eligibility, maker/checker and cumulative recovery allocation.

| Field | SQL type / nullability / invariant |
|---|---|
| `guarantee_id` | `@guarantees NOT NULL` |
| `case_id` | `@collection_cases NOT NULL` |
| `requested_irr` | `bigint NOT NULL CHECK (requested_irr > 0)` |
| `recovered_irr` | `bigint NOT NULL DEFAULT 0` |
| `status` | `text NOT NULL` |
| `proposed_by` | `@users NOT NULL` |
| `approved_by` | `@users` |
| `recovery_rights` | `jsonb NOT NULL DEFAULT '{}'` |

Additional constraints: `CHECK (recovered_irr BETWEEN 0 AND requested_irr), CHECK (approved_by IS NULL OR approved_by <> proposed_by)`.

### `facilities`

Model 1 lender commitment; Model 3 bridge funding pool can reference own-capital lender.

| Field | SQL type / nullability / invariant |
|---|---|
| `lender_id` | `@organizations NOT NULL` |
| `borrower_id` | `@organizations NOT NULL` |
| `commitment_irr` | `bigint NOT NULL CHECK (commitment_irr > 0)` |
| `drawn_irr` | `bigint NOT NULL DEFAULT 0` |
| `principal_outstanding_irr` | `bigint NOT NULL DEFAULT 0` |
| `status` | `text NOT NULL` |
| `contract_hash` | `text NOT NULL` |
| `covenants` | `jsonb NOT NULL DEFAULT '{}'` |

Additional constraints: `CHECK (drawn_irr BETWEEN 0 AND commitment_irr), CHECK (principal_outstanding_irr BETWEEN 0 AND drawn_irr)`.

### `facility_movements`

Confirmed draw and repayment evidence; not inferred from customer payment.

| Field | SQL type / nullability / invariant |
|---|---|
| `facility_id` | `@facilities NOT NULL` |
| `movement_type` | `text NOT NULL CHECK (movement_type IN ('DRAW','PRINCIPAL_PAYMENT','CHARGE_PAYMENT'))` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `external_reference` | `text NOT NULL` |
| `confirmed_at` | `timestamptz NOT NULL` |

Additional constraints: `UNIQUE (model_id,external_reference)`.

### `facility_dues`

Independent signed lender repayment schedule and charge components.

| Field | SQL type / nullability / invariant |
|---|---|
| `facility_id` | `@facilities NOT NULL` |
| `sequence` | `integer NOT NULL` |
| `due_at` | `timestamptz NOT NULL` |
| `principal_irr` | `bigint NOT NULL CHECK (principal_irr >= 0)` |
| `charge_irr` | `bigint NOT NULL DEFAULT 0 CHECK (charge_irr >= 0)` |
| `paid_irr` | `bigint NOT NULL DEFAULT 0 CHECK (paid_irr >= 0)` |
| `status` | `text NOT NULL` |

Additional constraints: `UNIQUE (model_id,facility_id,sequence)`.

### `sale_portfolios`

Model 3 bank review batch with independent lot decisions.

| Field | SQL type / nullability / invariant |
|---|---|
| `seller_id` | `@organizations NOT NULL` |
| `bank_id` | `@organizations NOT NULL` |
| `status` | `text NOT NULL` |
| `submitted_at` | `timestamptz` |
| `snapshot_hash` | `text NOT NULL` |

### `sale_lots`

One remaining purchase per lot, frozen face, price and recourse terms.

| Field | SQL type / nullability / invariant |
|---|---|
| `portfolio_id` | `@sale_portfolios NOT NULL` |
| `purchase_id` | `@purchases NOT NULL` |
| `status` | `text NOT NULL` |
| `recourse_mode` | `text NOT NULL CHECK (recourse_mode IN ('WITH_RECOURSE','WITHOUT_RECOURSE'))` |
| `face_principal_irr` | `bigint NOT NULL CHECK (face_principal_irr >= 0)` |
| `face_commission_irr` | `bigint NOT NULL CHECK (face_commission_irr >= 0)` |
| `discount_irr` | `bigint NOT NULL DEFAULT 0` |
| `fee_irr` | `bigint NOT NULL DEFAULT 0` |
| `holdback_irr` | `bigint NOT NULL DEFAULT 0` |
| `price_irr` | `bigint NOT NULL CHECK (price_irr > 0)` |
| `offer_expires_at` | `timestamptz NOT NULL` |
| `ownership_effective_at` | `timestamptz` |
| `cash_confirmed_at` | `timestamptz` |
| `terms` | `jsonb NOT NULL` |

Additional constraints: `CHECK (price_irr = face_principal_irr + face_commission_irr - discount_irr - fee_irr - holdback_irr)`.

### `ownership_history`

Non-overlapping legal ownership intervals, independent of accounting sale treatment.

| Field | SQL type / nullability / invariant |
|---|---|
| `purchase_id` | `@purchases NOT NULL` |
| `owner_id` | `@organizations NOT NULL` |
| `sale_lot_id` | `@sale_lots` |
| `valid_from` | `timestamptz NOT NULL` |
| `valid_to` | `timestamptz` |
| `evidence_hash` | `text NOT NULL` |

Additional constraints: `CHECK (valid_to IS NULL OR valid_to > valid_from)`.

### `servicing_mandates`

Owner appoints servicer, payment route, powers, expiry and bank delegation.

| Field | SQL type / nullability / invariant |
|---|---|
| `creditor_id` | `@organizations NOT NULL` |
| `servicer_id` | `@organizations NOT NULL` |
| `purchase_id` | `@purchases` |
| `valid_from` | `timestamptz NOT NULL` |
| `valid_until` | `timestamptz NOT NULL` |
| `payment_account_token` | `text NOT NULL` |
| `permissions` | `jsonb NOT NULL` |
| `contract_hash` | `text NOT NULL` |

Additional constraints: `CHECK (valid_until > valid_from)`.

### `recourse_claims`

Model 3 default recourse or evidenced warranty indemnity, no silent default recourse in non-recourse sales.

| Field | SQL type / nullability / invariant |
|---|---|
| `sale_lot_id` | `@sale_lots NOT NULL` |
| `claim_type` | `text NOT NULL CHECK (claim_type IN ('CUSTOMER_DEFAULT','WARRANTY_BREACH','SERVICE_RETURN'))` |
| `amount_irr` | `bigint NOT NULL CHECK (amount_irr > 0)` |
| `status` | `text NOT NULL` |
| `notice_at` | `timestamptz NOT NULL` |
| `cure_until` | `timestamptz NOT NULL` |
| `payment_reference` | `text` |
| `transfer_back_at` | `timestamptz` |
| `evidence` | `jsonb NOT NULL DEFAULT '{}'` |

### `bank_instructions`

Model 4 bank decisions/draws/amendments and model-specific bank commands.

| Field | SQL type / nullability / invariant |
|---|---|
| `bank_id` | `@organizations NOT NULL` |
| `application_id` | `@applications` |
| `purchase_id` | `@purchases` |
| `instruction_type` | `text NOT NULL` |
| `external_reference` | `text NOT NULL` |
| `status` | `text NOT NULL` |
| `expected_balance_irr` | `bigint` |
| `acknowledged_balance_irr` | `bigint` |
| `payload_hash` | `text NOT NULL` |
| `acknowledged_at` | `timestamptz` |

Additional constraints: `UNIQUE (model_id,bank_id,external_reference)`.

### `invoices`

Subscription, bank service and optional operational fees, outside customer principal.

| Field | SQL type / nullability / invariant |
|---|---|
| `payer_id` | `@organizations NOT NULL` |
| `payee_id` | `@organizations NOT NULL` |
| `purchase_id` | `@purchases` |
| `invoice_type` | `text NOT NULL` |
| `net_irr` | `bigint NOT NULL CHECK (net_irr >= 0)` |
| `tax_irr` | `bigint NOT NULL DEFAULT 0 CHECK (tax_irr >= 0)` |
| `reversed_irr` | `bigint NOT NULL DEFAULT 0` |
| `period_start` | `date NOT NULL` |
| `period_end` | `date NOT NULL` |
| `due_at` | `timestamptz NOT NULL` |
| `status` | `text NOT NULL` |

Additional constraints: `CHECK (reversed_irr BETWEEN 0 AND net_irr + tax_irr)`.

### `support_cases`

Customer disputes, appeals, hardship requests and assigned resolution evidence.

| Field | SQL type / nullability / invariant |
|---|---|
| `customer_id` | `@customers NOT NULL` |
| `purchase_id` | `@purchases` |
| `application_id` | `@applications` |
| `case_type` | `text NOT NULL` |
| `status` | `text NOT NULL` |
| `assigned_to` | `@users` |
| `summary` | `text NOT NULL` |
| `resolution` | `jsonb NOT NULL DEFAULT '{}'` |
| `due_at` | `timestamptz NOT NULL` |

### `notifications`

Deduplicated customer-visible notification and provider delivery state.

| Field | SQL type / nullability / invariant |
|---|---|
| `user_id` | `@users NOT NULL` |
| `channel` | `text NOT NULL` |
| `occurrence_key` | `text NOT NULL` |
| `template` | `text NOT NULL` |
| `payload` | `jsonb NOT NULL` |
| `status` | `text NOT NULL` |
| `send_at` | `timestamptz NOT NULL` |

Additional constraints: `UNIQUE (model_id,user_id,channel,occurrence_key)`.

### `reconciliation_runs`

Daily provider/account closing and immutable result summary.

| Field | SQL type / nullability / invariant |
|---|---|
| `account_token` | `text NOT NULL` |
| `business_date` | `date NOT NULL` |
| `opening_irr` | `bigint NOT NULL` |
| `inflow_irr` | `bigint NOT NULL` |
| `outflow_irr` | `bigint NOT NULL` |
| `closing_irr` | `bigint NOT NULL` |
| `status` | `text NOT NULL` |

Additional constraints: `UNIQUE (model_id,account_token,business_date)`.

### `reconciliation_items`

Unmatched transactions with assigned investigator and evidence-backed resolution.

| Field | SQL type / nullability / invariant |
|---|---|
| `run_id` | `@reconciliation_runs NOT NULL` |
| `provider_reference` | `text NOT NULL` |
| `exception_type` | `text NOT NULL` |
| `amount_irr` | `bigint NOT NULL` |
| `status` | `text NOT NULL` |
| `assigned_to` | `@users` |
| `resolution` | `jsonb NOT NULL DEFAULT '{}'` |

### `approvals`

Reusable maker/checker proof for finance, policy and legal actions.

| Field | SQL type / nullability / invariant |
|---|---|
| `resource_type` | `text NOT NULL` |
| `resource_id` | `uuid NOT NULL` |
| `action` | `text NOT NULL` |
| `payload_hash` | `text NOT NULL` |
| `proposed_by` | `@users NOT NULL` |
| `approved_by` | `@users` |
| `status` | `text NOT NULL` |

Additional constraints: `CHECK (approved_by IS NULL OR approved_by <> proposed_by)`.

### `idempotency_keys`

Command result replay and payload hash conflict protection.

| Field | SQL type / nullability / invariant |
|---|---|
| `actor_id` | `@users NOT NULL` |
| `route` | `text NOT NULL` |
| `key` | `text NOT NULL` |
| `request_hash` | `text NOT NULL` |
| `response_code` | `integer` |
| `response_body` | `jsonb` |
| `expires_at` | `timestamptz NOT NULL` |

Additional constraints: `UNIQUE (model_id,actor_id,route,key)`.

### `webhook_inbox`

Authenticated external event replay protection and asynchronous processing.

| Field | SQL type / nullability / invariant |
|---|---|
| `provider` | `text NOT NULL` |
| `event_key` | `text NOT NULL` |
| `payload_hash` | `text NOT NULL` |
| `payload` | `jsonb NOT NULL` |
| `status` | `text NOT NULL` |
| `processed_at` | `timestamptz` |

Additional constraints: `UNIQUE (model_id,provider,event_key)`.

### `outbox_events`

Transactional domain-event delivery with minimal scoped payload.

| Field | SQL type / nullability / invariant |
|---|---|
| `aggregate_type` | `text NOT NULL` |
| `aggregate_id` | `uuid NOT NULL` |
| `aggregate_version` | `bigint NOT NULL` |
| `event_type` | `text NOT NULL` |
| `payload` | `jsonb NOT NULL` |
| `published_at` | `timestamptz` |
| `correlation_id` | `uuid NOT NULL` |

Additional constraints: `UNIQUE (model_id,aggregate_type,aggregate_id,aggregate_version,event_type)`.

### `jobs`

Durable idempotent background commands and retry leases.

| Field | SQL type / nullability / invariant |
|---|---|
| `job_key` | `text NOT NULL` |
| `job_type` | `text NOT NULL` |
| `payload` | `jsonb NOT NULL` |
| `run_at` | `timestamptz NOT NULL` |
| `status` | `text NOT NULL` |
| `attempts` | `integer NOT NULL DEFAULT 0` |
| `lease_until` | `timestamptz` |
| `last_error_code` | `text` |

Additional constraints: `UNIQUE (model_id,job_key)`.

### `audit_events`

Append-only sensitive read/action/decision audit, with hash chain per scope.

| Field | SQL type / nullability / invariant |
|---|---|
| `actor_id` | `@users` |
| `action` | `text NOT NULL` |
| `resource_type` | `text NOT NULL` |
| `resource_id` | `uuid` |
| `before_hash` | `text` |
| `after_hash` | `text` |
| `reason` | `text` |
| `correlation_id` | `uuid NOT NULL` |
| `previous_hash` | `text` |
| `event_hash` | `text NOT NULL` |

Additional constraints: `UNIQUE (model_id,event_hash)`.

### `customer_securities`

Optional customer substitute collateral in Models 1/3; baseline check security remains in checks.

| Field | SQL type / nullability / invariant |
|---|---|
| `checkout_id` | `@checkouts NOT NULL` |
| `customer_id` | `@customers NOT NULL` |
| `beneficiary_id` | `@organizations NOT NULL` |
| `security_type` | `text NOT NULL CHECK (security_type IN ('CASH_COLLATERAL','BANK_GUARANTEE'))` |
| `covered_irr` | `bigint NOT NULL CHECK (covered_irr > 0)` |
| `expires_at` | `timestamptz NOT NULL` |
| `status` | `text NOT NULL` |
| `evidence` | `jsonb NOT NULL` |
| `contract_hash` | `text NOT NULL` |
## 4. Constraints, indexes and transactional invariants

The SQL enforces composite model FKs, provider-reference uniqueness, one open credit line/application per customer-creditor scope, a single live sale lot per purchase, non-overlapping half-open owner intervals, positive money, component bounds, maker/checker identity inequality, and journal immutability/balance. Application command handlers additionally enforce: exactly four active schedule installments; sums of principal/commission equal purchase totals; credit/program/clinic cap; receipt allocations <= receipt amount; original repayment allocation order; guarantee coverage/remaining security; model-specific creditor and legal authority; consents/evidence freshness; genuine legal transfer and bank confirmation. These cross-row/provider invariants require locked transactions and cannot be proven by a CHECK constraint alone.

Accounts must match journal legal book. Insert journal as DRAFT, insert all lines, then update to POSTED with `posted_at`; never insert a POSTED header before lines. A reversal is a new journal, debits/credits swapped, and original `reversal_of_id` linkage recorded on the new header. Reversal authority and one reversal per economic correction are handled by unique event key plus approvals.

DB RLS enforces model and permitted tenant IDs using transaction-local settings supplied by a verified session. The API's least-privilege repositories also enforce customer ownership, bank mandate, role and field visibility, especially on shared/null-tenant rows. The application runtime database role must not own tables or have BYPASSRLS; migration role is separate. Seed and migration run only against isolated prototype DBs. Do not advertise basic RLS as a complete customer authorization engine.

Indexes cover every FK, review queue, due installments, pending jobs/outbox/notifications, journal source and reconciliation references. History may be partitioned by creation month beyond 10 million rows; retain cross-partition economic uniqueness in a separate receipt/key registry before partitioning. No premature partitioning is required for pilot.

## 5. Exact balance definitions and queries

For each active installment: `principal_outstanding = principal_irr - principal_cancelled_irr - principal_paid_irr`; similarly commission; penalty outstanding is assessed minus paid/waived (waivers are explicit adjustment events; baseline zero). `principal_refunded_irr` is informative paid-return cash and is NOT subtracted again from outstanding. Sum all active installment principal outstanding for customer-line debt. Reconcile this to line projection each day; difference stops new utilization for that line.

Credit available=`max(0,limit-reserved-outstanding)`. Hold status makes spendable zero. Wallet withdrawable=`funded-held`; liability-funded is refund owed but not yet backed by cash. Guarantee remaining=`cap-used-reserved_claim`; a claim's requested amount also cannot exceed its coverage share of residual uncovered principal. Customer recovery and guarantee recovery reduce remaining creditor loss; only legal debt discharge or repayment updates customer debt.

A paid component return should be applied using cumulative component targets. Example full original purchase 400,000,000 principal and 48,000,000 commission, installment 1 paid. Full refund records refunded principal 100,000,000/commission 12,000,000 on installment 1, cancelled principal 100,000,000/commission 12,000,000 on each installment 2–4. Outstanding principal is zero; wallet liability increases 112,000,000; credit release is exactly 300,000,000. Repeating the command changes nothing.

Useful reporting views to implement: `v_credit_balance` (line plus derived debt/reservations); `v_customer_statement` (all components, creditor, due and receipts); `v_clinic_settlement` (gross/net/withheld/paid/pending); `v_aging` (DPD buckets on current balances); `v_daily_cash` (book/account/provider matched balance); `v_model_economics` (PayStar-only actual revenue/cost/loss); `v_current_owner` (open interval, validated against purchase owner); `v_refund_liability` (owed/funded/withdrawn); `v_guarantee_exposure` (coverage/cap/reservations); and model-specific facility or sale/recourse views. Views must honor caller scope, not expose raw unrestricted SQL to browser.

## 6. Seeds, migrations, retention and validation

[prototype_data.json](prototype_data.json) contains DB-table row fixtures plus deterministic mock scenarios, expected values and demo navigation. Seed in a transaction with all FK constraints deferred; insert tables in catalog order, then any dependent ownership/sale rows. For repeated reset, use a dedicated empty prototype database rather than truncating a shared environment. Seed UUIDs and provider references are stable so fixtures are reproducible. Money is string-encoded in JSON and parsed to bigint before INSERT. Timestamp clock is fixed until user advances it.

Initial migration creates tables, constraints, indexes, RLS and immutable-ledger triggers. Later migrations must preserve owner history and journal facts, backfill new required fields before enforcing NOT NULL and test against this fixture. Financial migrations receive finance review; export balances before and after and prove equality. Backup and restore must include object storage hashes/evidence manifests, not just SQL rows.

Retention and erasure follow PRD/TAD policy. Financial/ownership/check/consent evidence under retention cannot be hard-deleted through an admin screen. Delete/pseudonymize expired optional PII with audit and legal-hold checks. Restore must not replay external payments; outbox economic keys and provider receipt registry survive backups.

The root validation script verifies fixture references, monetary examples, model roles, four-installment sums, owner/beneficiary routing, sale price and mock scenario coverage. A real PostgreSQL migration and behavior test is still a required Claude build step; static validation alone cannot prove live SQL transactions or integration behavior.

## 7. Model-specific table activation

PayStar is originator permanently. Current owner and ownership history change only on verified assignment. Sale portfolio/lots, bank purchase-price receivable, check transfer events, servicing mandates and recourse claims are active. Recourse mode is immutable per accepted lot; ordinary default claim requires WITH_RECOURSE. Customer exposure sums assigned principal too.
