ALTER TABLE public.statements
  ADD COLUMN IF NOT EXISTS previous_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fatura numeric NOT NULL DEFAULT 0;