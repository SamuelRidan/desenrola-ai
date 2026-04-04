ALTER TABLE public.transactions 
ADD COLUMN type text NOT NULL DEFAULT 'purchase' 
CHECK (type IN ('purchase', 'payment', 'interest'));