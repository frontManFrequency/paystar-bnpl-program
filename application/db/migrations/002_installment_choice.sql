-- Customer-chosen credit amount and installment count (2, 3, 4 or 6). Idempotent: runs on every startup.
-- Commission stays a flat 12% of the financed principal whatever the count (product decision, 2026-11-17).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS requested_limit_irr bigint;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS installment_count smallint NOT NULL DEFAULT 4;
ALTER TABLE credit_lines ADD COLUMN IF NOT EXISTS installment_count smallint NOT NULL DEFAULT 4;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_requested_limit_range;
ALTER TABLE applications ADD CONSTRAINT applications_requested_limit_range
  CHECK (requested_limit_irr IS NULL OR (requested_limit_irr BETWEEN 10000000 AND 400000000 AND requested_limit_irr % 10000000 = 0));
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_installment_count_allowed;
ALTER TABLE applications ADD CONSTRAINT applications_installment_count_allowed CHECK (installment_count IN (2, 3, 4, 6));
ALTER TABLE credit_lines DROP CONSTRAINT IF EXISTS credit_lines_installment_count_allowed;
ALTER TABLE credit_lines ADD CONSTRAINT credit_lines_installment_count_allowed CHECK (installment_count IN (2, 3, 4, 6));

-- Installment and check sequence ranges widen from 1..4 / 2..4 to 1..6 / 2..6.
ALTER TABLE installments DROP CONSTRAINT IF EXISTS installments_sequence_check;
ALTER TABLE installments DROP CONSTRAINT IF EXISTS installments_sequence_range;
ALTER TABLE installments ADD CONSTRAINT installments_sequence_range CHECK (sequence BETWEEN 1 AND 6);
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_expected_installment_sequence_check;
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_expected_installment_sequence_range;
ALTER TABLE checks ADD CONSTRAINT checks_expected_installment_sequence_range CHECK (expected_installment_sequence BETWEEN 2 AND 6);
