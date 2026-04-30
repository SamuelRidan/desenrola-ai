-- Add interest_rate column to credit_cards
ALTER TABLE public.credit_cards
  ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(6,4) DEFAULT 0;

-- Create invoice_payments table for tracking monthly bill payments
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID REFERENCES public.statements(id) ON DELETE CASCADE NOT NULL,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view payments" ON public.invoice_payments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert payments" ON public.invoice_payments
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update payments" ON public.invoice_payments
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete payments" ON public.invoice_payments
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_invoice_payments_updated_at
  BEFORE UPDATE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
