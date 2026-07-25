-- Migration: add_debt_payoff_tables
-- Creates debts, installments, and monthly_cap tables for the Plano de Quitação feature.

-- ============================================================
-- 1. DEBTS — cada parcelamento que estou quitando
-- ============================================================
CREATE TABLE public.debts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id       UUID NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  raw_description TEXT NOT NULL,
  alias         TEXT,
  total_amount  NUMERIC(12,2) NOT NULL,
  installments_total INT NOT NULL CHECK (installments_total >= 1),
  installments_paid  INT NOT NULL DEFAULT 0 CHECK (installments_paid >= 0),
  first_due_month    DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid_off')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own debts"
  ON public.debts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own debts"
  ON public.debts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own debts"
  ON public.debts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own debts"
  ON public.debts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_debts_updated_at
  BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. INSTALLMENTS — cada parcela individual
-- ============================================================
CREATE TABLE public.installments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id    UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  number     INT NOT NULL CHECK (number >= 1),
  due_month  DATE NOT NULL,
  amount     NUMERIC(12,2) NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at    DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (debt_id, number)
);
ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own installments"
  ON public.installments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.debts WHERE debts.id = installments.debt_id AND debts.user_id = auth.uid()
  ));
CREATE POLICY "Users can insert own installments"
  ON public.installments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.debts WHERE debts.id = installments.debt_id AND debts.user_id = auth.uid()
  ));
CREATE POLICY "Users can update own installments"
  ON public.installments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.debts WHERE debts.id = installments.debt_id AND debts.user_id = auth.uid()
  ));
CREATE POLICY "Users can delete own installments"
  ON public.installments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.debts WHERE debts.id = installments.debt_id AND debts.user_id = auth.uid()
  ));

-- ============================================================
-- 3. MONTHLY_CAP — teto de gasto novo por cartão/mês
-- ============================================================
CREATE TABLE public.monthly_cap (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id    UUID NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  month      DATE NOT NULL,
  cap_amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, card_id, month)
);
ALTER TABLE public.monthly_cap ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own caps"
  ON public.monthly_cap FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own caps"
  ON public.monthly_cap FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own caps"
  ON public.monthly_cap FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own caps"
  ON public.monthly_cap FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_monthly_cap_updated_at
  BEFORE UPDATE ON public.monthly_cap
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
