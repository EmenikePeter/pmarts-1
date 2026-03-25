-- Align transaction release policy with backend routing rules.
-- Auto-release types: physical_product, instant, donation
-- Admin-approval types: digital_product, service, custom, other

UPDATE transaction_rules
SET confirmation_method = 'auto', updated_at = NOW()
WHERE type IN ('physical_product', 'instant', 'donation');

UPDATE transaction_rules
SET confirmation_method = 'manual', updated_at = NOW()
WHERE type IN ('digital_product', 'service', 'custom', 'other');

UPDATE transaction_rules
SET confirmation_method = 'receipt_upload', updated_at = NOW()
WHERE type = 'currency_exchange';
