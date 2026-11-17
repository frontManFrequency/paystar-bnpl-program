-- PayStar prototypes v1.0; PostgreSQL 16+. Run once per isolated prototype database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  name text NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('PAYSTAR','CLINIC','BANK','INVESTOR')),
  legal_identifier_token text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  payout_account_token text,
  slug text,
  UNIQUE (id,model_id),
  UNIQUE (model_id, legal_identifier_token), UNIQUE (model_id, slug)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  display_name text NOT NULL,
  mobile_token text NOT NULL,
  national_id_hash text,
  national_id_encrypted text,
  status text NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (id,model_id),
  UNIQUE (model_id,mobile_token), UNIQUE (model_id,national_id_hash)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id uuid NOT NULL,
  organization_id uuid,
  role text NOT NULL CHECK (role IN ('super-admin','paystar-admin','business-admin','customer','bank')),
  scopes jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (id,model_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id uuid NOT NULL,
  session_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  mfa_verified boolean NOT NULL DEFAULT false,
  UNIQUE (id,model_id),
  UNIQUE (model_id,session_hash)
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id uuid NOT NULL,
  identity_details jsonb NOT NULL DEFAULT '{}',
  verified_monthly_income_irr bigint NOT NULL DEFAULT 0 CHECK (verified_monthly_income_irr >= 0),
  external_monthly_obligations_irr bigint NOT NULL DEFAULT 0 CHECK (external_monthly_obligations_irr >= 0),
  kyc_status text NOT NULL DEFAULT 'UNVERIFIED',
  kyc_verified_at timestamptz,
  UNIQUE (id,model_id),
  UNIQUE (model_id,user_id)
);

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  owner_user_id uuid,
  owner_organization_id uuid,
  provider_token text NOT NULL,
  iban_encrypted text NOT NULL,
  bank_name text NOT NULL,
  card_last4 char(4),
  owner_match boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  cooling_until timestamptz,
  UNIQUE (id,model_id),
  CHECK ((owner_user_id IS NULL) <> (owner_organization_id IS NULL)), UNIQUE (model_id,provider_token)
);

CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  business_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  source text NOT NULL DEFAULT 'CLINIC_LINK',
  UNIQUE (id,model_id),
  UNIQUE (model_id,token_hash)
);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  customer_id uuid NOT NULL,
  purpose text NOT NULL,
  text_version text NOT NULL,
  text_hash text NOT NULL,
  given_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  proof jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id)
);

CREATE TABLE policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  name text NOT NULL,
  policy_version integer NOT NULL,
  configuration jsonb NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  effective_at timestamptz,
  agreement_hash text,
  proposed_by uuid NOT NULL,
  approved_by uuid,
  UNIQUE (id,model_id),
  UNIQUE (model_id,name,policy_version), CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);

CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  customer_id uuid NOT NULL,
  referral_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  status text NOT NULL,
  resume_stage text,
  recommended_limit_irr bigint NOT NULL DEFAULT 0 CHECK (recommended_limit_irr >= 0),
  approved_limit_irr bigint CHECK (approved_limit_irr >= 0),
  inviter_only boolean NOT NULL DEFAULT false,
  correction_due_at timestamptz,
  reapply_at timestamptz,
  expires_at timestamptz NOT NULL,
  previous_application_id uuid,
  UNIQUE (id,model_id)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  application_id uuid,
  customer_id uuid,
  category text NOT NULL,
  object_key text NOT NULL,
  content_hash text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  scan_status text NOT NULL DEFAULT 'PENDING',
  retention_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  UNIQUE (id,model_id)
);

CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  application_id uuid NOT NULL,
  provider_reference text NOT NULL,
  risk_band text NOT NULL CHECK (risk_band IN ('A','B','C','D','UNKNOWN')),
  existing_obligations_irr bigint NOT NULL DEFAULT 0,
  report_hash text NOT NULL,
  assessed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  features jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id),
  UNIQUE (model_id,provider_reference)
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  application_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  stage text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('APPROVE','REJECT','CORRECTION')),
  reason_code text NOT NULL,
  customer_message text NOT NULL,
  field_errors jsonb NOT NULL DEFAULT '[]',
  approved_limit_irr bigint,
  UNIQUE (id,model_id)
);

CREATE TABLE credit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  customer_id uuid NOT NULL,
  application_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  allowed_business_id uuid,
  limit_irr bigint NOT NULL CHECK (limit_irr BETWEEN 0 AND 400000000),
  outstanding_principal_irr bigint NOT NULL DEFAULT 0 CHECK (outstanding_principal_irr >= 0),
  reserved_principal_irr bigint NOT NULL DEFAULT 0 CHECK (reserved_principal_irr >= 0),
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  hold_reason text,
  UNIQUE (id,model_id),
  UNIQUE (model_id,application_id)
);

CREATE TABLE exposure_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  limit_irr bigint NOT NULL CHECK (limit_irr >= 0),
  outstanding_irr bigint NOT NULL DEFAULT 0,
  reserved_irr bigint NOT NULL DEFAULT 0,
  UNIQUE (id,model_id),
  UNIQUE (model_id,scope_type,scope_key), CHECK (outstanding_irr >= 0 AND reserved_irr >= 0)
);

CREATE TABLE catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  business_id uuid NOT NULL,
  external_sku text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  price_irr bigint NOT NULL CHECK (price_irr > 0),
  available boolean NOT NULL DEFAULT true,
  image_url text,
  checkout_url text NOT NULL,
  source_updated_at timestamptz NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,business_id,external_sku)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  business_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  external_reference text NOT NULL,
  service_total_irr bigint NOT NULL CHECK (service_total_irr > 0),
  financed_principal_irr bigint NOT NULL CHECK (financed_principal_irr > 0),
  cash_contribution_irr bigint NOT NULL DEFAULT 0 CHECK (cash_contribution_irr >= 0),
  line_items jsonb NOT NULL,
  status text NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,business_id,external_reference), CHECK (service_total_irr = financed_principal_irr + cash_contribution_irr)
);

CREATE TABLE checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  order_id uuid NOT NULL,
  credit_line_id uuid NOT NULL,
  principal_irr bigint NOT NULL CHECK (principal_irr > 0),
  commission_irr bigint NOT NULL CHECK (commission_irr >= 0),
  quote_hash text NOT NULL,
  quote_snapshot jsonb NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (id,model_id)
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  checkout_id uuid NOT NULL,
  credit_line_id uuid NOT NULL,
  principal_irr bigint NOT NULL CHECK (principal_irr > 0),
  funding_reserved_irr bigint NOT NULL DEFAULT 0 CHECK (funding_reserved_irr >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,checkout_id)
);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  application_id uuid NOT NULL,
  checkout_id uuid,
  creditor_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  contract_type text NOT NULL,
  document_hash text NOT NULL,
  status text NOT NULL,
  signed_at timestamptz,
  signature_evidence jsonb NOT NULL DEFAULT '{}',
  terms_snapshot jsonb NOT NULL,
  UNIQUE (id,model_id)
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  checkout_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  business_id uuid NOT NULL,
  credit_line_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  originator_id uuid NOT NULL,
  current_owner_id uuid NOT NULL,
  principal_irr bigint NOT NULL CHECK (principal_irr > 0),
  commission_irr bigint NOT NULL CHECK (commission_irr >= 0),
  returned_principal_irr bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  service_status text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  owner_epoch integer NOT NULL DEFAULT 1,
  service_evidence jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id),
  UNIQUE (model_id,checkout_id), CHECK (returned_principal_irr BETWEEN 0 AND principal_irr)
);

CREATE TABLE installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  purchase_id uuid NOT NULL,
  sequence smallint NOT NULL CHECK (sequence BETWEEN 1 AND 4),
  due_at timestamptz NOT NULL,
  due_local_date text NOT NULL,
  principal_irr bigint NOT NULL CHECK (principal_irr >= 0),
  commission_irr bigint NOT NULL CHECK (commission_irr >= 0),
  penalty_irr bigint NOT NULL DEFAULT 0 CHECK (penalty_irr >= 0),
  principal_paid_irr bigint NOT NULL DEFAULT 0,
  commission_paid_irr bigint NOT NULL DEFAULT 0,
  penalty_paid_irr bigint NOT NULL DEFAULT 0,
  principal_cancelled_irr bigint NOT NULL DEFAULT 0,
  commission_cancelled_irr bigint NOT NULL DEFAULT 0,
  principal_refunded_irr bigint NOT NULL DEFAULT 0,
  commission_refunded_irr bigint NOT NULL DEFAULT 0,
  payment_mode text NOT NULL DEFAULT 'ONLINE',
  status text NOT NULL,
  schedule_version integer NOT NULL DEFAULT 1,
  UNIQUE (id,model_id),
  UNIQUE (model_id,purchase_id,sequence,schedule_version),
CHECK (principal_paid_irr >= 0 AND commission_paid_irr >= 0 AND penalty_paid_irr >= 0),
CHECK (principal_cancelled_irr >= 0 AND commission_cancelled_irr >= 0),
CHECK (principal_paid_irr + principal_cancelled_irr <= principal_irr),
CHECK (commission_paid_irr + commission_cancelled_irr <= commission_irr),
CHECK (principal_refunded_irr BETWEEN 0 AND principal_paid_irr),
CHECK (commission_refunded_irr BETWEEN 0 AND commission_paid_irr)
);

CREATE TABLE checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  checkout_id uuid NOT NULL,
  expected_installment_sequence smallint NOT NULL CHECK (expected_installment_sequence BETWEEN 2 AND 4),
  purchase_id uuid,
  installment_id uuid,
  sayad_id_token text NOT NULL,
  issuer_customer_id uuid NOT NULL,
  beneficiary_id uuid NOT NULL,
  custodian_id uuid NOT NULL,
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  maturity_date date NOT NULL,
  status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id),
  UNIQUE (model_id,sayad_id_token)
);

CREATE TABLE check_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  check_id uuid NOT NULL,
  event_type text NOT NULL,
  from_holder_id uuid,
  to_holder_id uuid,
  external_reference text NOT NULL,
  effective_at timestamptz NOT NULL,
  evidence_hash text NOT NULL,
  actor_id uuid NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,check_id,external_reference)
);

CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  customer_id uuid NOT NULL,
  checkout_id uuid,
  purchase_id uuid,
  application_id uuid,
  creditor_id uuid NOT NULL,
  purpose text NOT NULL,
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  currency char(3) NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  provider text NOT NULL,
  provider_intent_ref text NOT NULL,
  status text NOT NULL,
  owner_epoch integer,
  expires_at timestamptz NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,provider,provider_intent_ref)
);

CREATE TABLE payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  intent_id uuid NOT NULL,
  provider text NOT NULL,
  provider_reference text NOT NULL,
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  received_at timestamptz NOT NULL,
  status text NOT NULL,
  reversal_of_id uuid,
  UNIQUE (id,model_id),
  UNIQUE (model_id,provider,provider_reference)
);

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  receipt_id uuid NOT NULL,
  installment_id uuid NOT NULL,
  component text NOT NULL CHECK (component IN ('PRINCIPAL','COMMISSION','PENALTY')),
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  reversed_at timestamptz,
  UNIQUE (id,model_id),
  UNIQUE (model_id,receipt_id,installment_id,component)
);

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  book_party_id uuid NOT NULL,
  account_code text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE','MEMO')),
  is_external_mirror boolean NOT NULL DEFAULT false,
  restricted boolean NOT NULL DEFAULT false,
  UNIQUE (id,model_id),
  UNIQUE (model_id,book_party_id,account_code,is_external_mirror)
);

CREATE TABLE journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  book_party_id uuid NOT NULL,
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  posted_at timestamptz,
  reversal_of_id uuid,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,book_party_id,event_key)
);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  journal_id uuid NOT NULL,
  account_id uuid NOT NULL,
  debit_irr bigint NOT NULL DEFAULT 0,
  credit_irr bigint NOT NULL DEFAULT 0,
  UNIQUE (id,model_id),
  CHECK (debit_irr >= 0 AND credit_irr >= 0 AND ((debit_irr = 0) <> (credit_irr = 0)))
);

CREATE TABLE settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  purchase_id uuid,
  from_party_id uuid NOT NULL,
  to_party_id uuid NOT NULL,
  kind text NOT NULL,
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  due_at timestamptz NOT NULL,
  status text NOT NULL,
  external_reference text,
  confirmed_at timestamptz,
  UNIQUE (id,model_id),
  UNIQUE (model_id,external_reference)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  purchase_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  approved_by uuid,
  cumulative_principal_irr bigint NOT NULL CHECK (cumulative_principal_irr > 0),
  principal_delta_irr bigint NOT NULL CHECK (principal_delta_irr > 0),
  commission_delta_irr bigint NOT NULL CHECK (commission_delta_irr >= 0),
  wallet_entitlement_irr bigint NOT NULL CHECK (wallet_entitlement_irr >= 0),
  reason text NOT NULL,
  status text NOT NULL,
  posted_at timestamptz,
  UNIQUE (id,model_id),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE refund_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  refund_id uuid NOT NULL,
  installment_id uuid NOT NULL,
  component text NOT NULL CHECK (component IN ('PRINCIPAL','COMMISSION')),
  cancelled_irr bigint NOT NULL DEFAULT 0 CHECK (cancelled_irr >= 0),
  refunded_irr bigint NOT NULL DEFAULT 0 CHECK (refunded_irr >= 0),
  UNIQUE (id,model_id),
  UNIQUE (model_id,refund_id,installment_id,component)
);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  customer_id uuid NOT NULL,
  liability_irr bigint NOT NULL DEFAULT 0,
  funded_irr bigint NOT NULL DEFAULT 0,
  held_irr bigint NOT NULL DEFAULT 0,
  UNIQUE (id,model_id),
  UNIQUE (model_id,customer_id), CHECK (liability_irr >= 0 AND funded_irr BETWEEN 0 AND liability_irr AND held_irr BETWEEN 0 AND funded_irr)
);

CREATE TABLE wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  wallet_id uuid NOT NULL,
  refund_id uuid,
  entry_type text NOT NULL,
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  event_key text NOT NULL,
  journal_id uuid,
  UNIQUE (id,model_id),
  UNIQUE (model_id,event_key)
);

CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  wallet_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  status text NOT NULL,
  provider_reference text,
  confirmed_at timestamptz,
  UNIQUE (id,model_id),
  UNIQUE (model_id,provider_reference)
);

CREATE TABLE collection_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  purchase_id uuid NOT NULL,
  creditor_id uuid NOT NULL,
  assigned_to uuid,
  stage text NOT NULL,
  dpd integer NOT NULL CHECK (dpd >= 0),
  legal_authorized_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id)
);

CREATE TABLE collection_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  case_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  result_code text NOT NULL,
  notes text NOT NULL,
  UNIQUE (id,model_id)
);

CREATE TABLE guarantees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  business_id uuid NOT NULL,
  beneficiary_id uuid NOT NULL,
  guarantee_type text NOT NULL CHECK (guarantee_type IN ('CASH','INSTRUMENT','PROPERTY','LOSS_SHARE','REPURCHASE','RESERVE')),
  coverage_bps integer NOT NULL CHECK (coverage_bps BETWEEN 0 AND 10000),
  cap_irr bigint NOT NULL CHECK (cap_irr > 0),
  used_irr bigint NOT NULL DEFAULT 0 CHECK (used_irr >= 0),
  reserved_claim_irr bigint NOT NULL DEFAULT 0 CHECK (reserved_claim_irr >= 0),
  expires_at timestamptz NOT NULL,
  assignable boolean NOT NULL DEFAULT false,
  contract_hash text NOT NULL,
  terms jsonb NOT NULL,
  UNIQUE (id,model_id),
  CHECK (used_irr + reserved_claim_irr <= cap_irr)
);

CREATE TABLE guarantee_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  guarantee_id uuid NOT NULL,
  case_id uuid NOT NULL,
  requested_irr bigint NOT NULL CHECK (requested_irr > 0),
  recovered_irr bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  proposed_by uuid NOT NULL,
  approved_by uuid,
  recovery_rights jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id),
  CHECK (recovered_irr BETWEEN 0 AND requested_irr), CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);

CREATE TABLE facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  lender_id uuid NOT NULL,
  borrower_id uuid NOT NULL,
  commitment_irr bigint NOT NULL CHECK (commitment_irr > 0),
  drawn_irr bigint NOT NULL DEFAULT 0,
  principal_outstanding_irr bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  contract_hash text NOT NULL,
  covenants jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id),
  CHECK (drawn_irr BETWEEN 0 AND commitment_irr), CHECK (principal_outstanding_irr BETWEEN 0 AND drawn_irr)
);

CREATE TABLE facility_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  facility_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('DRAW','PRINCIPAL_PAYMENT','CHARGE_PAYMENT')),
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  external_reference text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,external_reference)
);

CREATE TABLE facility_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  facility_id uuid NOT NULL,
  sequence integer NOT NULL,
  due_at timestamptz NOT NULL,
  principal_irr bigint NOT NULL CHECK (principal_irr >= 0),
  charge_irr bigint NOT NULL DEFAULT 0 CHECK (charge_irr >= 0),
  paid_irr bigint NOT NULL DEFAULT 0 CHECK (paid_irr >= 0),
  status text NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,facility_id,sequence)
);

CREATE TABLE sale_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  seller_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  status text NOT NULL,
  submitted_at timestamptz,
  snapshot_hash text NOT NULL,
  UNIQUE (id,model_id)
);

CREATE TABLE sale_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  portfolio_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  status text NOT NULL,
  recourse_mode text NOT NULL CHECK (recourse_mode IN ('WITH_RECOURSE','WITHOUT_RECOURSE')),
  face_principal_irr bigint NOT NULL CHECK (face_principal_irr >= 0),
  face_commission_irr bigint NOT NULL CHECK (face_commission_irr >= 0),
  discount_irr bigint NOT NULL DEFAULT 0,
  fee_irr bigint NOT NULL DEFAULT 0,
  holdback_irr bigint NOT NULL DEFAULT 0,
  price_irr bigint NOT NULL CHECK (price_irr > 0),
  offer_expires_at timestamptz NOT NULL,
  ownership_effective_at timestamptz,
  cash_confirmed_at timestamptz,
  terms jsonb NOT NULL,
  UNIQUE (id,model_id),
  CHECK (price_irr = face_principal_irr + face_commission_irr - discount_irr - fee_irr - holdback_irr)
);

CREATE TABLE ownership_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  purchase_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  sale_lot_id uuid,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  evidence_hash text NOT NULL,
  UNIQUE (id,model_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE servicing_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  creditor_id uuid NOT NULL,
  servicer_id uuid NOT NULL,
  purchase_id uuid,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  payment_account_token text NOT NULL,
  permissions jsonb NOT NULL,
  contract_hash text NOT NULL,
  UNIQUE (id,model_id),
  CHECK (valid_until > valid_from)
);

CREATE TABLE recourse_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  sale_lot_id uuid NOT NULL,
  claim_type text NOT NULL CHECK (claim_type IN ('CUSTOMER_DEFAULT','WARRANTY_BREACH','SERVICE_RETURN')),
  amount_irr bigint NOT NULL CHECK (amount_irr > 0),
  status text NOT NULL,
  notice_at timestamptz NOT NULL,
  cure_until timestamptz NOT NULL,
  payment_reference text,
  transfer_back_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id)
);

CREATE TABLE bank_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  bank_id uuid NOT NULL,
  application_id uuid,
  purchase_id uuid,
  instruction_type text NOT NULL,
  external_reference text NOT NULL,
  status text NOT NULL,
  expected_balance_irr bigint,
  acknowledged_balance_irr bigint,
  payload_hash text NOT NULL,
  acknowledged_at timestamptz,
  UNIQUE (id,model_id),
  UNIQUE (model_id,bank_id,external_reference)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  payer_id uuid NOT NULL,
  payee_id uuid NOT NULL,
  purchase_id uuid,
  invoice_type text NOT NULL,
  net_irr bigint NOT NULL CHECK (net_irr >= 0),
  tax_irr bigint NOT NULL DEFAULT 0 CHECK (tax_irr >= 0),
  reversed_irr bigint NOT NULL DEFAULT 0,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL,
  UNIQUE (id,model_id),
  CHECK (reversed_irr BETWEEN 0 AND net_irr + tax_irr)
);

CREATE TABLE support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  customer_id uuid NOT NULL,
  purchase_id uuid,
  application_id uuid,
  case_type text NOT NULL,
  status text NOT NULL,
  assigned_to uuid,
  summary text NOT NULL,
  resolution jsonb NOT NULL DEFAULT '{}',
  due_at timestamptz NOT NULL,
  UNIQUE (id,model_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id uuid NOT NULL,
  channel text NOT NULL,
  occurrence_key text NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  send_at timestamptz NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,user_id,channel,occurrence_key)
);

CREATE TABLE reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  account_token text NOT NULL,
  business_date date NOT NULL,
  opening_irr bigint NOT NULL,
  inflow_irr bigint NOT NULL,
  outflow_irr bigint NOT NULL,
  closing_irr bigint NOT NULL,
  status text NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,account_token,business_date)
);

CREATE TABLE reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  run_id uuid NOT NULL,
  provider_reference text NOT NULL,
  exception_type text NOT NULL,
  amount_irr bigint NOT NULL,
  status text NOT NULL,
  assigned_to uuid,
  resolution jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id,model_id)
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  action text NOT NULL,
  payload_hash text NOT NULL,
  proposed_by uuid NOT NULL,
  approved_by uuid,
  status text NOT NULL,
  UNIQUE (id,model_id),
  CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  actor_id uuid NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_code integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,actor_id,route,key)
);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  provider text NOT NULL,
  event_key text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  processed_at timestamptz,
  UNIQUE (id,model_id),
  UNIQUE (model_id,provider,event_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  correlation_id uuid NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,aggregate_type,aggregate_id,aggregate_version,event_type)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  job_key text NOT NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  run_at timestamptz NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  last_error_code text,
  UNIQUE (id,model_id),
  UNIQUE (model_id,job_key)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  before_hash text,
  after_hash text,
  reason text,
  correlation_id uuid NOT NULL,
  previous_hash text,
  event_hash text NOT NULL,
  UNIQUE (id,model_id),
  UNIQUE (model_id,event_hash)
);

CREATE TABLE customer_securities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id smallint NOT NULL CHECK (model_id BETWEEN 1 AND 4),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  checkout_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  beneficiary_id uuid NOT NULL,
  security_type text NOT NULL CHECK (security_type IN ('CASH_COLLATERAL','BANK_GUARANTEE')),
  covered_irr bigint NOT NULL CHECK (covered_irr > 0),
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  evidence jsonb NOT NULL,
  contract_hash text NOT NULL,
  UNIQUE (id,model_id)
);

ALTER TABLE memberships ADD FOREIGN KEY (user_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_memberships_user_id ON memberships(model_id,user_id);

ALTER TABLE memberships ADD FOREIGN KEY (organization_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_memberships_organization_id ON memberships(model_id,organization_id);

ALTER TABLE sessions ADD FOREIGN KEY (user_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_sessions_user_id ON sessions(model_id,user_id);

ALTER TABLE customers ADD FOREIGN KEY (user_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_customers_user_id ON customers(model_id,user_id);

ALTER TABLE bank_accounts ADD FOREIGN KEY (owner_user_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_bank_accounts_owner_user_id ON bank_accounts(model_id,owner_user_id);

ALTER TABLE bank_accounts ADD FOREIGN KEY (owner_organization_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_bank_accounts_owner_organization_id ON bank_accounts(model_id,owner_organization_id);

ALTER TABLE referrals ADD FOREIGN KEY (business_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_referrals_business_id ON referrals(model_id,business_id);

ALTER TABLE consents ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_consents_customer_id ON consents(model_id,customer_id);

ALTER TABLE policies ADD FOREIGN KEY (proposed_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_policies_proposed_by ON policies(model_id,proposed_by);

ALTER TABLE policies ADD FOREIGN KEY (approved_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_policies_approved_by ON policies(model_id,approved_by);

ALTER TABLE applications ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_applications_customer_id ON applications(model_id,customer_id);

ALTER TABLE applications ADD FOREIGN KEY (referral_id,model_id) REFERENCES referrals(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_applications_referral_id ON applications(model_id,referral_id);

ALTER TABLE applications ADD FOREIGN KEY (creditor_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_applications_creditor_id ON applications(model_id,creditor_id);

ALTER TABLE applications ADD FOREIGN KEY (policy_id,model_id) REFERENCES policies(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_applications_policy_id ON applications(model_id,policy_id);

ALTER TABLE applications ADD FOREIGN KEY (previous_application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_applications_previous_application_id ON applications(model_id,previous_application_id);

ALTER TABLE documents ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_documents_application_id ON documents(model_id,application_id);

ALTER TABLE documents ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_documents_customer_id ON documents(model_id,customer_id);

ALTER TABLE assessments ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_assessments_application_id ON assessments(model_id,application_id);

ALTER TABLE decisions ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_decisions_application_id ON decisions(model_id,application_id);

ALTER TABLE decisions ADD FOREIGN KEY (actor_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_decisions_actor_id ON decisions(model_id,actor_id);

ALTER TABLE credit_lines ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_credit_lines_customer_id ON credit_lines(model_id,customer_id);

ALTER TABLE credit_lines ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_credit_lines_application_id ON credit_lines(model_id,application_id);

ALTER TABLE credit_lines ADD FOREIGN KEY (creditor_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_credit_lines_creditor_id ON credit_lines(model_id,creditor_id);

ALTER TABLE credit_lines ADD FOREIGN KEY (allowed_business_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_credit_lines_allowed_business_id ON credit_lines(model_id,allowed_business_id);

ALTER TABLE catalog_items ADD FOREIGN KEY (business_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_catalog_items_business_id ON catalog_items(model_id,business_id);

ALTER TABLE orders ADD FOREIGN KEY (business_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_orders_business_id ON orders(model_id,business_id);

ALTER TABLE orders ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_orders_customer_id ON orders(model_id,customer_id);

ALTER TABLE checkouts ADD FOREIGN KEY (order_id,model_id) REFERENCES orders(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checkouts_order_id ON checkouts(model_id,order_id);

ALTER TABLE checkouts ADD FOREIGN KEY (credit_line_id,model_id) REFERENCES credit_lines(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checkouts_credit_line_id ON checkouts(model_id,credit_line_id);

ALTER TABLE reservations ADD FOREIGN KEY (checkout_id,model_id) REFERENCES checkouts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_reservations_checkout_id ON reservations(model_id,checkout_id);

ALTER TABLE reservations ADD FOREIGN KEY (credit_line_id,model_id) REFERENCES credit_lines(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_reservations_credit_line_id ON reservations(model_id,credit_line_id);

ALTER TABLE contracts ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_contracts_application_id ON contracts(model_id,application_id);

ALTER TABLE contracts ADD FOREIGN KEY (checkout_id,model_id) REFERENCES checkouts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_contracts_checkout_id ON contracts(model_id,checkout_id);

ALTER TABLE contracts ADD FOREIGN KEY (creditor_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_contracts_creditor_id ON contracts(model_id,creditor_id);

ALTER TABLE contracts ADD FOREIGN KEY (policy_id,model_id) REFERENCES policies(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_contracts_policy_id ON contracts(model_id,policy_id);

ALTER TABLE purchases ADD FOREIGN KEY (checkout_id,model_id) REFERENCES checkouts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_purchases_checkout_id ON purchases(model_id,checkout_id);

ALTER TABLE purchases ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_purchases_customer_id ON purchases(model_id,customer_id);

ALTER TABLE purchases ADD FOREIGN KEY (business_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_purchases_business_id ON purchases(model_id,business_id);

ALTER TABLE purchases ADD FOREIGN KEY (credit_line_id,model_id) REFERENCES credit_lines(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_purchases_credit_line_id ON purchases(model_id,credit_line_id);

ALTER TABLE purchases ADD FOREIGN KEY (contract_id,model_id) REFERENCES contracts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_purchases_contract_id ON purchases(model_id,contract_id);

ALTER TABLE purchases ADD FOREIGN KEY (originator_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_purchases_originator_id ON purchases(model_id,originator_id);

ALTER TABLE purchases ADD FOREIGN KEY (current_owner_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_purchases_current_owner_id ON purchases(model_id,current_owner_id);

ALTER TABLE installments ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_installments_purchase_id ON installments(model_id,purchase_id);

ALTER TABLE checks ADD FOREIGN KEY (checkout_id,model_id) REFERENCES checkouts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checks_checkout_id ON checks(model_id,checkout_id);

ALTER TABLE checks ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checks_purchase_id ON checks(model_id,purchase_id);

ALTER TABLE checks ADD FOREIGN KEY (installment_id,model_id) REFERENCES installments(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checks_installment_id ON checks(model_id,installment_id);

ALTER TABLE checks ADD FOREIGN KEY (issuer_customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checks_issuer_customer_id ON checks(model_id,issuer_customer_id);

ALTER TABLE checks ADD FOREIGN KEY (beneficiary_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checks_beneficiary_id ON checks(model_id,beneficiary_id);

ALTER TABLE checks ADD FOREIGN KEY (custodian_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_checks_custodian_id ON checks(model_id,custodian_id);

ALTER TABLE check_events ADD FOREIGN KEY (check_id,model_id) REFERENCES checks(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_check_events_check_id ON check_events(model_id,check_id);

ALTER TABLE check_events ADD FOREIGN KEY (from_holder_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_check_events_from_holder_id ON check_events(model_id,from_holder_id);

ALTER TABLE check_events ADD FOREIGN KEY (to_holder_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_check_events_to_holder_id ON check_events(model_id,to_holder_id);

ALTER TABLE check_events ADD FOREIGN KEY (actor_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_check_events_actor_id ON check_events(model_id,actor_id);

ALTER TABLE payment_intents ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_intents_customer_id ON payment_intents(model_id,customer_id);

ALTER TABLE payment_intents ADD FOREIGN KEY (checkout_id,model_id) REFERENCES checkouts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_intents_checkout_id ON payment_intents(model_id,checkout_id);

ALTER TABLE payment_intents ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_intents_purchase_id ON payment_intents(model_id,purchase_id);

ALTER TABLE payment_intents ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_intents_application_id ON payment_intents(model_id,application_id);

ALTER TABLE payment_intents ADD FOREIGN KEY (creditor_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_intents_creditor_id ON payment_intents(model_id,creditor_id);

ALTER TABLE payment_receipts ADD FOREIGN KEY (intent_id,model_id) REFERENCES payment_intents(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_receipts_intent_id ON payment_receipts(model_id,intent_id);

ALTER TABLE payment_receipts ADD FOREIGN KEY (reversal_of_id,model_id) REFERENCES payment_receipts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_receipts_reversal_of_id ON payment_receipts(model_id,reversal_of_id);

ALTER TABLE payment_allocations ADD FOREIGN KEY (receipt_id,model_id) REFERENCES payment_receipts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_allocations_receipt_id ON payment_allocations(model_id,receipt_id);

ALTER TABLE payment_allocations ADD FOREIGN KEY (installment_id,model_id) REFERENCES installments(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_payment_allocations_installment_id ON payment_allocations(model_id,installment_id);

ALTER TABLE ledger_accounts ADD FOREIGN KEY (book_party_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_ledger_accounts_book_party_id ON ledger_accounts(model_id,book_party_id);

ALTER TABLE journals ADD FOREIGN KEY (book_party_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_journals_book_party_id ON journals(model_id,book_party_id);

ALTER TABLE journals ADD FOREIGN KEY (reversal_of_id,model_id) REFERENCES journals(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_journals_reversal_of_id ON journals(model_id,reversal_of_id);

ALTER TABLE journal_lines ADD FOREIGN KEY (journal_id,model_id) REFERENCES journals(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_journal_lines_journal_id ON journal_lines(model_id,journal_id);

ALTER TABLE journal_lines ADD FOREIGN KEY (account_id,model_id) REFERENCES ledger_accounts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_journal_lines_account_id ON journal_lines(model_id,account_id);

ALTER TABLE settlements ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_settlements_purchase_id ON settlements(model_id,purchase_id);

ALTER TABLE settlements ADD FOREIGN KEY (from_party_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_settlements_from_party_id ON settlements(model_id,from_party_id);

ALTER TABLE settlements ADD FOREIGN KEY (to_party_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_settlements_to_party_id ON settlements(model_id,to_party_id);

ALTER TABLE refunds ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_refunds_purchase_id ON refunds(model_id,purchase_id);

ALTER TABLE refunds ADD FOREIGN KEY (requested_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_refunds_requested_by ON refunds(model_id,requested_by);

ALTER TABLE refunds ADD FOREIGN KEY (approved_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_refunds_approved_by ON refunds(model_id,approved_by);

ALTER TABLE refund_components ADD FOREIGN KEY (refund_id,model_id) REFERENCES refunds(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_refund_components_refund_id ON refund_components(model_id,refund_id);

ALTER TABLE refund_components ADD FOREIGN KEY (installment_id,model_id) REFERENCES installments(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_refund_components_installment_id ON refund_components(model_id,installment_id);

ALTER TABLE wallets ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_wallets_customer_id ON wallets(model_id,customer_id);

ALTER TABLE wallet_entries ADD FOREIGN KEY (wallet_id,model_id) REFERENCES wallets(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_wallet_entries_wallet_id ON wallet_entries(model_id,wallet_id);

ALTER TABLE wallet_entries ADD FOREIGN KEY (refund_id,model_id) REFERENCES refunds(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_wallet_entries_refund_id ON wallet_entries(model_id,refund_id);

ALTER TABLE wallet_entries ADD FOREIGN KEY (journal_id,model_id) REFERENCES journals(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_wallet_entries_journal_id ON wallet_entries(model_id,journal_id);

ALTER TABLE withdrawals ADD FOREIGN KEY (wallet_id,model_id) REFERENCES wallets(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_withdrawals_wallet_id ON withdrawals(model_id,wallet_id);

ALTER TABLE withdrawals ADD FOREIGN KEY (bank_account_id,model_id) REFERENCES bank_accounts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_withdrawals_bank_account_id ON withdrawals(model_id,bank_account_id);

ALTER TABLE collection_cases ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_collection_cases_purchase_id ON collection_cases(model_id,purchase_id);

ALTER TABLE collection_cases ADD FOREIGN KEY (creditor_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_collection_cases_creditor_id ON collection_cases(model_id,creditor_id);

ALTER TABLE collection_cases ADD FOREIGN KEY (assigned_to,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_collection_cases_assigned_to ON collection_cases(model_id,assigned_to);

ALTER TABLE collection_actions ADD FOREIGN KEY (case_id,model_id) REFERENCES collection_cases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_collection_actions_case_id ON collection_actions(model_id,case_id);

ALTER TABLE collection_actions ADD FOREIGN KEY (actor_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_collection_actions_actor_id ON collection_actions(model_id,actor_id);

ALTER TABLE guarantees ADD FOREIGN KEY (business_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_guarantees_business_id ON guarantees(model_id,business_id);

ALTER TABLE guarantees ADD FOREIGN KEY (beneficiary_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_guarantees_beneficiary_id ON guarantees(model_id,beneficiary_id);

ALTER TABLE guarantee_claims ADD FOREIGN KEY (guarantee_id,model_id) REFERENCES guarantees(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_guarantee_claims_guarantee_id ON guarantee_claims(model_id,guarantee_id);

ALTER TABLE guarantee_claims ADD FOREIGN KEY (case_id,model_id) REFERENCES collection_cases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_guarantee_claims_case_id ON guarantee_claims(model_id,case_id);

ALTER TABLE guarantee_claims ADD FOREIGN KEY (proposed_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_guarantee_claims_proposed_by ON guarantee_claims(model_id,proposed_by);

ALTER TABLE guarantee_claims ADD FOREIGN KEY (approved_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_guarantee_claims_approved_by ON guarantee_claims(model_id,approved_by);

ALTER TABLE facilities ADD FOREIGN KEY (lender_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_facilities_lender_id ON facilities(model_id,lender_id);

ALTER TABLE facilities ADD FOREIGN KEY (borrower_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_facilities_borrower_id ON facilities(model_id,borrower_id);

ALTER TABLE facility_movements ADD FOREIGN KEY (facility_id,model_id) REFERENCES facilities(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_facility_movements_facility_id ON facility_movements(model_id,facility_id);

ALTER TABLE facility_dues ADD FOREIGN KEY (facility_id,model_id) REFERENCES facilities(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_facility_dues_facility_id ON facility_dues(model_id,facility_id);

ALTER TABLE sale_portfolios ADD FOREIGN KEY (seller_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_sale_portfolios_seller_id ON sale_portfolios(model_id,seller_id);

ALTER TABLE sale_portfolios ADD FOREIGN KEY (bank_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_sale_portfolios_bank_id ON sale_portfolios(model_id,bank_id);

ALTER TABLE sale_lots ADD FOREIGN KEY (portfolio_id,model_id) REFERENCES sale_portfolios(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_sale_lots_portfolio_id ON sale_lots(model_id,portfolio_id);

ALTER TABLE sale_lots ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_sale_lots_purchase_id ON sale_lots(model_id,purchase_id);

ALTER TABLE ownership_history ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_ownership_history_purchase_id ON ownership_history(model_id,purchase_id);

ALTER TABLE ownership_history ADD FOREIGN KEY (owner_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_ownership_history_owner_id ON ownership_history(model_id,owner_id);

ALTER TABLE ownership_history ADD FOREIGN KEY (sale_lot_id,model_id) REFERENCES sale_lots(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_ownership_history_sale_lot_id ON ownership_history(model_id,sale_lot_id);

ALTER TABLE servicing_mandates ADD FOREIGN KEY (creditor_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_servicing_mandates_creditor_id ON servicing_mandates(model_id,creditor_id);

ALTER TABLE servicing_mandates ADD FOREIGN KEY (servicer_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_servicing_mandates_servicer_id ON servicing_mandates(model_id,servicer_id);

ALTER TABLE servicing_mandates ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_servicing_mandates_purchase_id ON servicing_mandates(model_id,purchase_id);

ALTER TABLE recourse_claims ADD FOREIGN KEY (sale_lot_id,model_id) REFERENCES sale_lots(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_recourse_claims_sale_lot_id ON recourse_claims(model_id,sale_lot_id);

ALTER TABLE bank_instructions ADD FOREIGN KEY (bank_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_bank_instructions_bank_id ON bank_instructions(model_id,bank_id);

ALTER TABLE bank_instructions ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_bank_instructions_application_id ON bank_instructions(model_id,application_id);

ALTER TABLE bank_instructions ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_bank_instructions_purchase_id ON bank_instructions(model_id,purchase_id);

ALTER TABLE invoices ADD FOREIGN KEY (payer_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_invoices_payer_id ON invoices(model_id,payer_id);

ALTER TABLE invoices ADD FOREIGN KEY (payee_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_invoices_payee_id ON invoices(model_id,payee_id);

ALTER TABLE invoices ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_invoices_purchase_id ON invoices(model_id,purchase_id);

ALTER TABLE support_cases ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_support_cases_customer_id ON support_cases(model_id,customer_id);

ALTER TABLE support_cases ADD FOREIGN KEY (purchase_id,model_id) REFERENCES purchases(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_support_cases_purchase_id ON support_cases(model_id,purchase_id);

ALTER TABLE support_cases ADD FOREIGN KEY (application_id,model_id) REFERENCES applications(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_support_cases_application_id ON support_cases(model_id,application_id);

ALTER TABLE support_cases ADD FOREIGN KEY (assigned_to,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_support_cases_assigned_to ON support_cases(model_id,assigned_to);

ALTER TABLE notifications ADD FOREIGN KEY (user_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_notifications_user_id ON notifications(model_id,user_id);

ALTER TABLE reconciliation_items ADD FOREIGN KEY (run_id,model_id) REFERENCES reconciliation_runs(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_reconciliation_items_run_id ON reconciliation_items(model_id,run_id);

ALTER TABLE reconciliation_items ADD FOREIGN KEY (assigned_to,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_reconciliation_items_assigned_to ON reconciliation_items(model_id,assigned_to);

ALTER TABLE approvals ADD FOREIGN KEY (proposed_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_approvals_proposed_by ON approvals(model_id,proposed_by);

ALTER TABLE approvals ADD FOREIGN KEY (approved_by,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_approvals_approved_by ON approvals(model_id,approved_by);

ALTER TABLE idempotency_keys ADD FOREIGN KEY (actor_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_idempotency_keys_actor_id ON idempotency_keys(model_id,actor_id);

ALTER TABLE audit_events ADD FOREIGN KEY (actor_id,model_id) REFERENCES users(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_audit_events_actor_id ON audit_events(model_id,actor_id);

ALTER TABLE customer_securities ADD FOREIGN KEY (checkout_id,model_id) REFERENCES checkouts(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_customer_securities_checkout_id ON customer_securities(model_id,checkout_id);

ALTER TABLE customer_securities ADD FOREIGN KEY (customer_id,model_id) REFERENCES customers(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_customer_securities_customer_id ON customer_securities(model_id,customer_id);

ALTER TABLE customer_securities ADD FOREIGN KEY (beneficiary_id,model_id) REFERENCES organizations(id,model_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX ix_customer_securities_beneficiary_id ON customer_securities(model_id,beneficiary_id);

CREATE UNIQUE INDEX one_active_check_per_checkout_sequence ON checks(model_id,checkout_id,expected_installment_sequence) WHERE status NOT IN ('RELEASED','VOIDED');

CREATE UNIQUE INDEX one_open_line ON credit_lines(model_id,customer_id,creditor_id) WHERE status IN ('ACTIVE','HELD','APPROVED_PENDING_CONTRACT');

CREATE UNIQUE INDEX one_open_application ON applications(model_id,customer_id,creditor_id) WHERE status NOT IN ('REJECTED','CANCELLED','EXPIRED','ACTIVE');

CREATE UNIQUE INDEX one_live_sale ON sale_lots(model_id,purchase_id) WHERE status NOT IN ('REJECTED','CANCELLED','REPURCHASED','RETURNED');

ALTER TABLE ownership_history ADD CONSTRAINT owner_intervals_no_overlap EXCLUDE USING gist (model_id WITH =, purchase_id WITH =, tstzrange(valid_from,valid_to,'[)') WITH &&) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX due_installments ON installments(model_id,due_at) WHERE status NOT IN ('PAID','CANCELLED','SUPERSEDED');

CREATE INDEX queue_jobs ON jobs(model_id,status,run_at);

CREATE INDEX queue_outbox ON outbox_events(model_id,created_at) WHERE published_at IS NULL;

CREATE INDEX application_review_queue ON applications(model_id,status,created_at);

CREATE INDEX notification_queue ON notifications(model_id,status,send_at);

CREATE INDEX journal_source ON journals(model_id,source_type,source_id);


-- Application DB role must not own tables or have BYPASSRLS. Set app.model_id and
-- app.tenant_ids transaction-locally from verified session, not request parameters.
-- Null tenant rows are platform/shared rows; customer ownership and bank/role scopes
-- MUST additionally be enforced in repositories. RLS is a defense layer, not a complete RBAC engine.


ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON organizations USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON users USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON memberships USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON sessions USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON customers USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON bank_accounts USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON referrals USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON consents USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON policies USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON applications USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON documents USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON assessments USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON decisions USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE credit_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON credit_lines USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE exposure_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON exposure_buckets USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON catalog_items USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON orders USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON checkouts USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON reservations USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON contracts USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON purchases USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON installments USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON checks USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE check_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON check_events USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON payment_intents USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON payment_receipts USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON payment_allocations USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON ledger_accounts USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE journals ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON journals USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON journal_lines USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON settlements USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON refunds USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE refund_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON refund_components USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON wallets USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE wallet_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON wallet_entries USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON withdrawals USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE collection_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON collection_cases USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE collection_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON collection_actions USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE guarantees ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON guarantees USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE guarantee_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON guarantee_claims USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON facilities USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE facility_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON facility_movements USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE facility_dues ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON facility_dues USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE sale_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON sale_portfolios USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE sale_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON sale_lots USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE ownership_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON ownership_history USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE servicing_mandates ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON servicing_mandates USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE recourse_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON recourse_claims USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE bank_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON bank_instructions USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON invoices USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE support_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON support_cases USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON notifications USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON reconciliation_runs USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE reconciliation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON reconciliation_items USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON approvals USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON idempotency_keys USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE webhook_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON webhook_inbox USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON outbox_events USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON jobs USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON audit_events USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);

ALTER TABLE customer_securities ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_tenant_scope ON customer_securities USING (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
) WITH CHECK (
 model_id = NULLIF(current_setting('app.model_id',true),'')::smallint
 AND (tenant_id IS NULL OR tenant_id::text IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(current_setting('app.tenant_ids',true),''),'[]')::jsonb)))
);


CREATE FUNCTION protect_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'POSTED' THEN RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE'; END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION protect_posted_journal();
CREATE FUNCTION protect_posted_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE jid uuid; mid smallint; st text;
BEGIN
 IF TG_OP <> 'INSERT' THEN
   SELECT status INTO st FROM journals WHERE id=OLD.journal_id AND model_id=OLD.model_id FOR UPDATE;
   IF st='POSTED' THEN RAISE EXCEPTION 'POSTED_LINE_IMMUTABLE'; END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN
   SELECT status INTO st FROM journals WHERE id=NEW.journal_id AND model_id=NEW.model_id FOR UPDATE;
   IF st='POSTED' THEN RAISE EXCEPTION 'POSTED_LINE_IMMUTABLE'; END IF;
   RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER line_immutable BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION protect_posted_line();
CREATE FUNCTION check_posted_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n bigint; wrong bigint;
BEGIN
 IF NEW.status='POSTED' THEN
   SELECT COALESCE(sum(debit_irr),0),COALESCE(sum(credit_irr),0),count(*) INTO d,c,n
   FROM journal_lines WHERE journal_id=NEW.id AND model_id=NEW.model_id;
   SELECT count(*) INTO wrong FROM journal_lines l JOIN ledger_accounts a ON a.id=l.account_id AND a.model_id=l.model_id
   WHERE l.journal_id=NEW.id AND l.model_id=NEW.model_id AND a.book_party_id<>NEW.book_party_id;
   IF d<>c OR n<2 OR wrong>0 OR NEW.posted_at IS NULL THEN RAISE EXCEPTION 'UNBALANCED_OR_INVALID_JOURNAL'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_balance BEFORE INSERT OR UPDATE ON journals FOR EACH ROW EXECUTE FUNCTION check_posted_journal_balance();
CREATE FUNCTION append_only_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY_RECORD'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER decision_append_only BEFORE UPDATE OR DELETE ON decisions FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER check_event_append_only BEFORE UPDATE OR DELETE ON check_events FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER wallet_entry_append_only BEFORE UPDATE OR DELETE ON wallet_entries FOR EACH ROW EXECUTE FUNCTION append_only_row();
COMMIT;
