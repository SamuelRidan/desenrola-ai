import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseInstallment } from "@/components/InstallmentModal";
import {
  groupTransactionInstallments,
  buildPayoffProjection,
  computePayoffSummary,
  type RawInstallmentItem,
  type GroupedDebt,
  type MonthProjection,
  type PayoffSummary,
  type CapRow,
  currentMonthStr,
} from "@/lib/debt-math";

export interface PayoffDataResult {
  isLoading: boolean;
  rawItems: RawInstallmentItem[];
  groupedDebts: GroupedDebt[];
  projection: MonthProjection[];
  summary: PayoffSummary;
  caps: CapRow[];
  refMonthStr: string;
  updateCap: (month: string, cardId: string, capAmount: number) => Promise<void>;
  updateAlias: (rawDescription: string, alias: string) => Promise<void>;
}

export function usePayoffData(selectedUserId?: string): PayoffDataResult {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = role === "admin";

  const targetUserId = !isAdmin ? user?.id : selectedUserId === "all" ? undefined : selectedUserId;

  // 1. Query transaction assignments + transactions + statements + credit_cards
  const { data: assignments = [], isLoading: isLoadingTx } = useQuery({
    queryKey: ["payoff-assignments", user?.id, targetUserId],
    queryFn: async () => {
      if (!user) return [];

      let query = supabase
        .from("transaction_assignments")
        .select(`
          id,
          share_amount,
          user_id,
          transactions (
            id,
            description,
            date,
            amount,
            alias,
            type,
            statement_id,
            statements (
              id,
              month,
              year,
              card_id,
              credit_cards (
                id,
                name
              )
            )
          )
        `);

      if (targetUserId) {
        query = query.eq("user_id", targetUserId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // 2. Query monthly_caps
  const { data: caps = [], isLoading: isLoadingCaps } = useQuery({
    queryKey: ["monthly-caps", user?.id, targetUserId],
    queryFn: async () => {
      if (!user) return [];

      let query = supabase.from("monthly_cap").select("card_id, month, cap_amount");
      if (targetUserId) {
        query = query.eq("user_id", targetUserId);
      }

      const { data, error } = await query;
      if (error) return [];
      return (data as CapRow[]) ?? [];
    },
    enabled: !!user,
  });

  // 3. Process raw transactions into RawInstallmentItems
  const rawItems = useMemo(() => {
    const items: RawInstallmentItem[] = [];

    for (const a of assignments as any[]) {
      const tx = a.transactions;
      if (!tx) continue;
      const type = tx.type || "purchase";
      if (type === "payment" || type === "interest") continue;

      const desc = tx.description || "";
      // Exclude card fees, IOF, annuity, bank charges, etc.
      if (/IOF|ANUIDADE|TARIFA|ENCARGO|ROTATIVO|PROTECAO|MORA|PAGTO|PAGAMENTO/i.test(desc)) continue;

      const parsed = parseInstallment(desc);
      if (!parsed) continue;

      const amount = Number(a.share_amount) || Number(tx.amount) || 0;
      if (amount <= 0) continue;

      const stmt = tx.statements;
      if (!stmt) continue;

      const card = stmt.credit_cards;

      items.push({
        txId: tx.id,
        description: desc,
        cleanDescription: parsed.cleanDesc,
        alias: tx.alias || null,
        currentInstallment: parsed.current,
        totalInstallments: parsed.total,
        amount,
        cardName: card?.name || "Cartão",
        cardId: stmt.card_id,
        statementMonth: stmt.month,
        statementYear: stmt.year,
      });
    }

    return items;
  }, [assignments]);

  // 4. Group debts & calculate projection & summary
  const groupedDebts = useMemo(() => {
    return groupTransactionInstallments(rawItems);
  }, [rawItems]);

  const refMonthStr = useMemo(() => currentMonthStr(), []);

  const projection = useMemo(() => {
    return buildPayoffProjection(groupedDebts, caps, refMonthStr);
  }, [groupedDebts, caps, refMonthStr]);

  const summary = useMemo(() => {
    return computePayoffSummary(groupedDebts, refMonthStr);
  }, [groupedDebts, refMonthStr]);

  // 5. Mutation for updating monthly_cap
  const updateCapMutation = useMutation({
    mutationFn: async ({ month, cardId, capAmount }: { month: string; cardId: string; capAmount: number }) => {
      if (!user) return;
      const effectiveUserId = targetUserId || user.id;

      const { error } = await supabase.from("monthly_cap").upsert({
        user_id: effectiveUserId,
        card_id: cardId,
        month,
        cap_amount: capAmount,
      }, { onConflict: "user_id,card_id,month" });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-caps"] });
    },
  });

  // 6. Mutation for updating alias across transactions
  const updateAliasMutation = useMutation({
    mutationFn: async ({ rawDescription, alias }: { rawDescription: string; alias: string }) => {
      // Update all transactions matching description
      const { error } = await supabase
        .from("transactions")
        .update({ alias: alias.trim() || null })
        .ilike("description", `%${rawDescription}%`);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payoff-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  return {
    isLoading: isLoadingTx || isLoadingCaps,
    rawItems,
    groupedDebts,
    projection,
    summary,
    caps,
    refMonthStr,
    updateCap: async (month, cardId, capAmount) => {
      await updateCapMutation.mutateAsync({ month, cardId, capAmount });
    },
    updateAlias: async (rawDescription, alias) => {
      await updateAliasMutation.mutateAsync({ rawDescription, alias });
    },
  };
}
