-- Add card_holder column to transactions table
-- This stores the name of the responsible person (card holder) identified during import
-- Example: "SAMUEL SOUZA RIDAN", "RENATA R R RIDAN", etc.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_holder TEXT;
