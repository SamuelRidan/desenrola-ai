import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Wallet, CreditCard, Plus, Pencil, Trash2, CheckCircle, TrendingUp,
  Calendar, FileText, AlertTriangle, Calculator, ChevronRight, X, StickyNote,
  CircleDollarSign, Percent, Users, User
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const USER_COLORS = [
  { bg: "bg-violet-500/15", text: "text-violet-600", border: "border-violet-500/25" },
  { bg: "bg-sky-500/15", text: "text-sky-600", border: "border-sky-500/25" },
  { bg: "bg-amber-500/15", text: "text-amber-600", border: "border-amber-500/25" },
  { bg: "bg-rose-500/15", text: "text-rose-600", border: "border-rose-500/25" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600", border: "border-emerald-500/25" },
  { bg: "bg-indigo-500/15", text: "text-indigo-600", border: "border-indigo-500/25" },
];

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

type PaymentRow = {
  id: string;
  statement_id: string;
  amount_paid: number;
  payment_date: string | null;
  notes: string | null;
  created_by: string | null;
  paid_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type StatementWithCard = {
  id: string;
  card_id: string;
  month: number;
  year: number;
  total_fatura: number;
  previous_balance: number;
  status: string;
  file_name: string | null;
  credit_cards: { name: string; interest_rate: number } | null;
};

export default function PaymentsPage() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [paymentDialog, setPaymentDialog] = useState<{
    open: boolean;
    statementId: string;
    totalFatura: number;
    monthLabel: string;
  }>({ open: false, statementId: "", totalFatura: 0, monthLabel: "" });
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState("");
  const [payPaidBy, setPayPaidBy] = useState<string>("");

  // Editing state
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Simulator state
  const [simMonths, setSimMonths] = useState(6);
  const [simRateOverride, setSimRateOverride] = useState<string>("");

  // ── Queries ──

  const { data: cards } = useQuery({
    queryKey: ["credit-cards"],
    queryFn: async () => {
      // Try with interest_rate first, fallback without it
      const { data, error } = await supabase
        .from("credit_cards")
        .select("*")
        .order("name");
      if (error) {
        console.warn("Error fetching cards:", error.message);
        return [];
      }
      return data ?? [];
    },
  });

  const { data: statements } = useQuery({
    queryKey: ["payment-statements", selectedCardId],
    queryFn: async () => {
      if (!selectedCardId) return [];
      // Try fetching with interest_rate, fallback to just name
      let result = await supabase
        .from("statements")
        .select("*, credit_cards(name, interest_rate)")
        .eq("card_id", selectedCardId)
        .eq("status", "completed")
        .order("year", { ascending: false })
        .order("month", { ascending: false });

      if (result.error) {
        // Fallback without interest_rate (column may not exist yet)
        console.warn("Fallback query without interest_rate:", result.error.message);
        result = await supabase
          .from("statements")
          .select("*, credit_cards(name)")
          .eq("card_id", selectedCardId)
          .eq("status", "completed")
          .order("year", { ascending: false })
          .order("month", { ascending: false });
      }

      return (result.data ?? []) as StatementWithCard[];
    },
    enabled: !!selectedCardId,
  });

  const statementIds = useMemo(
    () => (statements ?? []).map((s) => s.id),
    [statements]
  );

  const { data: payments } = useQuery({
    queryKey: ["invoice-payments", statementIds],
    queryFn: async () => {
      if (statementIds.length === 0) return [];
      const { data } = await supabase
        .from("invoice_payments")
        .select("*")
        .in("statement_id", statementIds)
        .order("payment_date", { ascending: false });
      return (data ?? []) as PaymentRow[];
    },
    enabled: statementIds.length > 0,
  });

  // Profiles for user dropdown
  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name");
      return data ?? [];
    },
  });

  const profileMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles ?? []) map[p.user_id] = p.full_name;
    return map;
  }, [profiles]);

  const userColorMap = useMemo(() => {
    const map: Record<string, typeof USER_COLORS[0]> = {};
    Object.keys(profileMap).forEach((uid, i) => {
      map[uid] = USER_COLORS[i % USER_COLORS.length];
    });
    return map;
  }, [profileMap]);

  // Transaction assignments for all statements of selected card
  const { data: assignments } = useQuery({
    queryKey: ["statement-assignments", statementIds],
    queryFn: async () => {
      if (statementIds.length === 0) return [];
      const { data } = await supabase
        .from("transaction_assignments")
        .select("user_id, share_amount, transaction_id, transactions!inner(statement_id, type, amount)")
        .in("transactions.statement_id", statementIds);
      return data ?? [];
    },
    enabled: statementIds.length > 0,
  });

  // Transactions for unassigned calculation
  const { data: allTransactions } = useQuery({
    queryKey: ["statement-transactions", statementIds],
    queryFn: async () => {
      if (statementIds.length === 0) return [];
      const { data } = await supabase
        .from("transactions")
        .select("id, statement_id, amount, type")
        .in("statement_id", statementIds);
      return data ?? [];
    },
    enabled: statementIds.length > 0,
  });

  // ── Mutations ──

  const createPayment = useMutation({
    mutationFn: async (payload: {
      statement_id: string;
      amount_paid: number;
      payment_date: string;
      notes: string;
      paid_by_user_id: string;
    }) => {
      const { error } = await supabase.from("invoice_payments").insert({
        ...payload,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-payments"] });
      toast.success("Pagamento registrado com sucesso!");
      setPaymentDialog({ open: false, statementId: "", totalFatura: 0, monthLabel: "" });
      setPayAmount("");
      setPayNotes("");
      setPayPaidBy("");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const updatePayment = useMutation({
    mutationFn: async ({
      id,
      amount_paid,
      notes,
    }: {
      id: string;
      amount_paid: number;
      notes: string | null;
    }) => {
      const { error } = await supabase
        .from("invoice_payments")
        .update({ amount_paid, notes })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-payments"] });
      toast.success("Pagamento atualizado!");
      setEditingPaymentId(null);
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const deletePayment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("invoice_payments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-payments"] });
      toast.success("Pagamento removido!");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  // ── Computed ──

  const selectedCard = useMemo(
    () => cards?.find((c) => c.id === selectedCardId),
    [cards, selectedCardId]
  );

  const paymentsByStatement = useMemo(() => {
    const map: Record<string, PaymentRow[]> = {};
    for (const p of payments ?? []) {
      if (!map[p.statement_id]) map[p.statement_id] = [];
      map[p.statement_id].push(p);
    }
    return map;
  }, [payments]);

  const statementSummaries = useMemo(() => {
    if (!statements) return [];
    return statements.map((s) => {
      const stmtPayments = paymentsByStatement[s.id] ?? [];
      const totalPaid = stmtPayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
      const totalFatura = Number(s.total_fatura) || 0;
      const openBalance = Math.max(0, totalFatura - totalPaid);
      const percentPaid = totalFatura > 0 ? Math.min(100, (totalPaid / totalFatura) * 100) : 0;
      const status: "paid" | "partial" | "open" =
        percentPaid >= 99.9 ? "paid" : totalPaid > 0 ? "partial" : "open";
      return {
        ...s,
        totalPaid,
        openBalance,
        percentPaid,
        status,
        payments: stmtPayments,
      };
    });
  }, [statements, paymentsByStatement]);

  const globalSummary = useMemo(() => {
    let totalFatura = 0;
    let totalPaid = 0;
    let totalOpen = 0;
    let paidCount = 0;
    let openCount = 0;
    for (const s of statementSummaries) {
      totalFatura += Number(s.total_fatura) || 0;
      totalPaid += s.totalPaid;
      totalOpen += s.openBalance;
      if (s.status === "paid") paidCount++;
      else openCount++;
    }
    return { totalFatura, totalPaid, totalOpen, paidCount, openCount, count: statementSummaries.length };
  }, [statementSummaries]);

  // Interest rate for simulator
  const cardInterestRate = selectedCard?.interest_rate ? Number(selectedCard.interest_rate) : 0;
  const effectiveRate = simRateOverride !== "" ? parseFloat(simRateOverride) || 0 : cardInterestRate;

  // Simulation
  const simulationData = useMemo(() => {
    const principal = globalSummary.totalOpen;
    if (principal <= 0 || effectiveRate <= 0) return [];
    const monthlyRate = effectiveRate / 100;
    const rows: { month: number; startBalance: number; interest: number; endBalance: number }[] = [];
    let balance = principal;
    for (let m = 1; m <= simMonths; m++) {
      const interest = balance * monthlyRate;
      const endBalance = balance + interest;
      rows.push({ month: m, startBalance: balance, interest, endBalance });
      balance = endBalance;
    }
    return rows;
  }, [globalSummary.totalOpen, effectiveRate, simMonths]);

  // ── Per-User Report Data ──

  // Assignments grouped by statement → user
  const assignmentsByStatement = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const a of assignments ?? []) {
      const stmtId = (a as any).transactions?.statement_id;
      if (!stmtId) continue;
      if (!map[stmtId]) map[stmtId] = {};
      const uid = a.user_id;
      map[stmtId][uid] = (map[stmtId][uid] || 0) + Number(a.share_amount);
    }
    return map;
  }, [assignments]);

  // Total charges (purchases + interest, excluding payments) per statement
  const chargesByStatement = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of allTransactions ?? []) {
      const type = t.type || "purchase";
      if (type === "payment") continue;
      const amt = Number(t.amount) || 0;
      if (amt > 0) {
        map[t.statement_id] = (map[t.statement_id] || 0) + amt;
      }
    }
    return map;
  }, [allTransactions]);

  // Payments grouped by statement → user (paid_by_user_id)
  const paymentsByStatementUser = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const p of payments ?? []) {
      const uid = p.paid_by_user_id;
      if (!uid) continue;
      if (!map[p.statement_id]) map[p.statement_id] = {};
      map[p.statement_id][uid] = (map[p.statement_id][uid] || 0) + Number(p.amount_paid);
    }
    return map;
  }, [payments]);

  // Per-statement user report
  const userReportByStatement = useMemo(() => {
    if (!statements) return [];
    return statementSummaries.map((s) => {
      const stmtAssignments = assignmentsByStatement[s.id] || {};
      const stmtPaymentsByUser = paymentsByStatementUser[s.id] || {};
      const totalCharges = chargesByStatement[s.id] || 0;
      const totalAssigned = Object.values(stmtAssignments).reduce((a, b) => a + b, 0);
      const unassignedAmount = Math.max(0, totalCharges - totalAssigned);

      // Collect all user IDs from both assignments and payments
      const allUserIds = new Set([...Object.keys(stmtAssignments), ...Object.keys(stmtPaymentsByUser)]);
      const users: { userId: string; name: string; assigned: number; paid: number; open: number; percentPaid: number }[] = [];
      for (const uid of allUserIds) {
        const assigned = stmtAssignments[uid] || 0;
        const paid = stmtPaymentsByUser[uid] || 0;
        const open = Math.max(0, assigned - paid);
        const percentPaid = assigned > 0 ? Math.min(100, (paid / assigned) * 100) : (paid > 0 ? 100 : 0);
        users.push({ userId: uid, name: profileMap[uid] || "Desconhecido", assigned, paid, open, percentPaid });
      }
      users.sort((a, b) => b.open - a.open);

      return {
        statementId: s.id,
        month: s.month,
        year: s.year,
        monthLabel: `${MONTHS[s.month - 1]} ${s.year}`,
        totalFatura: Number(s.total_fatura) || 0,
        totalCharges,
        totalAssigned,
        unassignedAmount,
        totalPaid: s.totalPaid,
        openBalance: s.openBalance,
        users,
      };
    });
  }, [statementSummaries, assignmentsByStatement, paymentsByStatementUser, chargesByStatement, profileMap]);

  // Global user summary (all months combined)
  const globalUserSummary = useMemo(() => {
    const userMap: Record<string, { name: string; assigned: number; paid: number; open: number }> = {};
    let totalUnassigned = 0;
    for (const report of userReportByStatement) {
      totalUnassigned += report.unassignedAmount;
      for (const u of report.users) {
        if (!userMap[u.userId]) userMap[u.userId] = { name: u.name, assigned: 0, paid: 0, open: 0 };
        userMap[u.userId].assigned += u.assigned;
        userMap[u.userId].paid += u.paid;
        userMap[u.userId].open += u.open;
      }
    }
    const users = Object.entries(userMap).map(([uid, info]) => ({ userId: uid, ...info, percentPaid: info.assigned > 0 ? Math.min(100, (info.paid / info.assigned) * 100) : 0 }));
    users.sort((a, b) => b.open - a.open);
    return { users, totalUnassigned };
  }, [userReportByStatement]);

  // ── Handlers ──

  const openPaymentDialog = useCallback(
    (statementId: string, totalFatura: number, monthLabel: string) => {
      setPaymentDialog({ open: true, statementId, totalFatura, monthLabel });
      setPayAmount("");
      setPayDate(new Date().toISOString().slice(0, 10));
      setPayNotes("");
      setPayPaidBy("");
    },
    []
  );

  const handleSubmitPayment = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const amount = parseFloat(payAmount.replace(",", "."));
      if (isNaN(amount) || amount <= 0) {
        toast.error("Informe um valor válido");
        return;
      }
      if (!payPaidBy) {
        toast.error("Selecione quem pagou");
        return;
      }
      createPayment.mutate({
        statement_id: paymentDialog.statementId,
        amount_paid: amount,
        payment_date: payDate,
        notes: payNotes.trim() || "",
        paid_by_user_id: payPaidBy,
      });
    },
    [payAmount, payDate, payNotes, payPaidBy, paymentDialog.statementId, createPayment]
  );

  const startEditing = useCallback((payment: PaymentRow) => {
    setEditingPaymentId(payment.id);
    setEditAmount(String(payment.amount_paid));
    setEditNotes(payment.notes || "");
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingPaymentId) return;
    const amount = parseFloat(editAmount.replace(",", "."));
    if (isNaN(amount) || amount <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    updatePayment.mutate({
      id: editingPaymentId,
      amount_paid: amount,
      notes: editNotes.trim() || null,
    });
  }, [editingPaymentId, editAmount, editNotes, updatePayment]);

  // ── Status Config ──

  const statusConfig = {
    paid: { label: "Quitado", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", icon: CheckCircle },
    partial: { label: "Parcial", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20", icon: CircleDollarSign },
    open: { label: "Em Aberto", cls: "bg-red-500/10 text-red-600 border-red-500/20", icon: AlertTriangle },
  };

  // ── Render ──

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-heading font-bold">Pagamentos de Faturas</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Gerencie pagamentos, acompanhe saldos e simule juros
        </p>
      </div>

      {/* Card Selector */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="w-full sm:w-80 space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cartão</Label>
          <Select value={selectedCardId} onValueChange={setSelectedCardId}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Selecione um cartão" />
            </SelectTrigger>
            <SelectContent>
              {cards?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-primary" />
                    {c.name} (•••• {c.last_four_digits})
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedCard && cardInterestRate > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20"
          >
            <Percent className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-700">
              Taxa de juros: <span className="font-bold">{cardInterestRate.toFixed(2)}% a.m.</span>
            </span>
          </motion.div>
        )}
      </div>

      {!selectedCardId ? (
        <Card className="shadow-card">
          <CardContent className="p-8 md:p-12 text-center">
            <Wallet className="w-14 h-14 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">Selecione um cartão para visualizar os pagamentos</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Escolha um cartão acima para acompanhar faturas e pagamentos
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Hero: Global Summary */}
          {statementSummaries.length > 0 && (
            <div className="space-y-3 md:space-y-4">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="shadow-elevated overflow-hidden border-0">
                  <div className="gradient-primary p-5 sm:p-6 md:p-8">
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
                          <div className="p-1.5 sm:p-2 rounded-full bg-white/15 backdrop-blur-sm">
                            <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                          </div>
                          <p className="text-white/80 text-xs sm:text-sm font-medium tracking-wide uppercase">
                            Saldo em Aberto
                          </p>
                        </div>
                        <p className="text-3xl sm:text-4xl md:text-5xl font-heading font-bold text-white tracking-tight">
                          R$ {formatBRL(globalSummary.totalOpen)}
                        </p>
                        <p className="text-white/60 text-xs sm:text-sm mt-1.5 sm:mt-2">
                          Total das faturas:{" "}
                          <span className="text-white/90 font-medium">R$ {formatBRL(globalSummary.totalFatura)}</span>
                          {" · "}Total pago:{" "}
                          <span className="text-white/90 font-medium">R$ {formatBRL(globalSummary.totalPaid)}</span>
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-4 border border-white/10 text-center">
                          <p className="text-white/70 text-[10px] sm:text-xs font-medium uppercase tracking-wide">
                            Quitadas
                          </p>
                          <p className="text-xl sm:text-2xl font-heading font-bold text-white mt-0.5">
                            {globalSummary.paidCount}
                          </p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-4 border border-white/10 text-center">
                          <p className="text-white/70 text-[10px] sm:text-xs font-medium uppercase tracking-wide">
                            Em Aberto
                          </p>
                          <p className="text-xl sm:text-2xl font-heading font-bold text-white mt-0.5">
                            {globalSummary.openCount}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>

              {/* ── Monthly History ── */}
              <div>
                <h2 className="text-base md:text-lg font-heading font-semibold mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  Histórico Mês a Mês
                </h2>

                <div className="space-y-3">
                  {statementSummaries.map((s, i) => {
                    const sc = statusConfig[s.status];
                    const StatusIcon = sc.icon;
                    const totalFatura = Number(s.total_fatura) || 0;

                    return (
                      <motion.div
                        key={s.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.04, 0.3) }}
                      >
                        <Card className="shadow-card overflow-hidden hover:shadow-elevated transition-shadow">
                          <CardContent className="p-0">
                            {/* Main row */}
                            <div className="p-4 md:p-5">
                              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                                {/* Month/Year */}
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <div className={`w-10 h-10 md:w-11 md:h-11 rounded-xl flex items-center justify-center shrink-0 ${
                                    s.status === "paid"
                                      ? "bg-emerald-500/10"
                                      : s.status === "partial"
                                      ? "bg-amber-500/10"
                                      : "bg-red-500/10"
                                  }`}>
                                    <StatusIcon className={`w-5 h-5 ${
                                      s.status === "paid"
                                        ? "text-emerald-600"
                                        : s.status === "partial"
                                        ? "text-amber-600"
                                        : "text-red-600"
                                    }`} />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-heading font-semibold text-sm md:text-base">
                                      {MONTHS[s.month - 1]} {s.year}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {s.credit_cards?.name || "Cartão"}
                                    </p>
                                  </div>
                                </div>

                                {/* Values */}
                                <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
                                  <div className="text-center sm:text-right">
                                    <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide">
                                      Total Fatura
                                    </p>
                                    <p className="font-heading font-bold text-sm md:text-base">
                                      R$ {formatBRL(totalFatura)}
                                    </p>
                                  </div>
                                  <div className="text-center sm:text-right">
                                    <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide">
                                      Pago
                                    </p>
                                    <p className="font-heading font-bold text-sm md:text-base text-emerald-600">
                                      R$ {formatBRL(s.totalPaid)}
                                    </p>
                                  </div>
                                  <div className="text-center sm:text-right">
                                    <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide">
                                      Saldo
                                    </p>
                                    <p className={`font-heading font-bold text-sm md:text-base ${
                                      s.openBalance > 0 ? "text-red-600" : "text-emerald-600"
                                    }`}>
                                      R$ {formatBRL(s.openBalance)}
                                    </p>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs font-medium ${sc.cls} shrink-0`}
                                  >
                                    {sc.label}
                                  </Badge>
                                </div>

                                {/* Action */}
                                {s.status !== "paid" && (
                                  <Button
                                    size="sm"
                                    className="shrink-0"
                                    onClick={() =>
                                      openPaymentDialog(
                                        s.id,
                                        totalFatura,
                                        `${MONTHS[s.month - 1]} ${s.year}`
                                      )
                                    }
                                  >
                                    <Plus className="w-4 h-4 mr-1" />
                                    <span className="hidden sm:inline">Registrar</span>
                                    <span className="sm:hidden">Pagar</span>
                                  </Button>
                                )}
                              </div>

                              {/* Progress Bar */}
                              <div className="mt-3">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] text-muted-foreground">
                                    {s.percentPaid.toFixed(0)}% pago
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    R$ {formatBRL(s.totalPaid)} / R$ {formatBRL(totalFatura)}
                                  </span>
                                </div>
                                <Progress
                                  value={s.percentPaid}
                                  className={`h-2 ${
                                    s.status === "paid"
                                      ? "[&>div]:bg-emerald-500"
                                      : s.status === "partial"
                                      ? "[&>div]:bg-amber-500"
                                      : "[&>div]:bg-red-400"
                                  }`}
                                />
                              </div>
                            </div>

                            {/* Payment entries */}
                            {s.payments.length > 0 && (
                              <div className="border-t border-border bg-muted/20">
                                <div className="px-4 py-2">
                                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    Pagamentos registrados ({s.payments.length})
                                  </p>
                                </div>
                                <div className="divide-y divide-border/50">
                                  {s.payments.map((p) => (
                                    <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                                      {editingPaymentId === p.id ? (
                                        // Editing mode
                                        <div className="flex-1 flex flex-col sm:flex-row gap-2">
                                          <Input
                                            value={editAmount}
                                            onChange={(e) => setEditAmount(e.target.value)}
                                            className="h-8 w-32 text-sm"
                                            placeholder="Valor"
                                            autoFocus
                                          />
                                          <Input
                                            value={editNotes}
                                            onChange={(e) => setEditNotes(e.target.value)}
                                            className="h-8 flex-1 text-sm"
                                            placeholder="Notas (opcional)"
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") handleSaveEdit();
                                              if (e.key === "Escape") setEditingPaymentId(null);
                                            }}
                                          />
                                          <div className="flex gap-1">
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-8 w-8 text-primary"
                                              onClick={handleSaveEdit}
                                            >
                                              <CheckCircle className="w-4 h-4" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-8 w-8 text-muted-foreground"
                                              onClick={() => setEditingPaymentId(null)}
                                            >
                                              <X className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        // View mode
                                        <>
                                          {p.paid_by_user_id && profileMap[p.paid_by_user_id] ? (
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${(userColorMap[p.paid_by_user_id] || USER_COLORS[0]).bg} ${(userColorMap[p.paid_by_user_id] || USER_COLORS[0]).text}`}>
                                              {getInitials(profileMap[p.paid_by_user_id])}
                                            </div>
                                          ) : (
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                          )}
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="font-heading font-semibold text-sm text-emerald-600">
                                                R$ {formatBRL(Number(p.amount_paid))}
                                              </span>
                                              {p.paid_by_user_id && profileMap[p.paid_by_user_id] && (
                                                <span className={`text-xs font-medium ${(userColorMap[p.paid_by_user_id] || USER_COLORS[0]).text}`}>
                                                  {profileMap[p.paid_by_user_id].split(" ")[0]}
                                                </span>
                                              )}
                                              {p.payment_date && (
                                                <span className="text-xs text-muted-foreground">
                                                  em {new Date(p.payment_date + "T00:00:00").toLocaleDateString("pt-BR")}
                                                </span>
                                              )}
                                            </div>
                                            {p.notes && (
                                              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                                <StickyNote className="w-3 h-3 shrink-0" />
                                                <span className="truncate">{p.notes}</span>
                                              </p>
                                            )}
                                          </div>
                                          <div className="flex gap-0.5">
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-7 w-7"
                                                onClick={() => startEditing(p)}
                                              >
                                                <Pencil className="w-3.5 h-3.5 text-primary" />
                                              </Button>
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-7 w-7"
                                                onClick={() => {
                                                  if (confirm("Remover este pagamento?"))
                                                    deletePayment.mutate(p.id);
                                                }}
                                              >
                                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                              </Button>
                                            </div>
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* ── Interest Simulator ── */}
              {globalSummary.totalOpen > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <Card className="shadow-card overflow-hidden">
                    <CardHeader className="pb-3">
                      <CardTitle className="font-heading text-base md:text-lg flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-amber-600" />
                        Simulador de Juros
                        {cardInterestRate > 0 && (
                          <Badge variant="outline" className="ml-1 text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 font-normal">
                            Taxa do cartão: {cardInterestRate.toFixed(2)}% a.m.
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {/* Controls */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Valor em Aberto</Label>
                          <div className="h-10 flex items-center px-3 rounded-md border border-border bg-muted/30 text-sm font-heading font-semibold">
                            R$ {formatBRL(globalSummary.totalOpen)}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">
                            Taxa de Juros Mensal (%)
                            {cardInterestRate > 0 && simRateOverride === "" && (
                              <span className="text-amber-600 ml-1">(auto)</span>
                            )}
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="99"
                            placeholder={cardInterestRate > 0 ? cardInterestRate.toFixed(2) : "Ex: 14.90"}
                            value={simRateOverride}
                            onChange={(e) => setSimRateOverride(e.target.value)}
                            className="h-10"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">
                            Projeção: {simMonths} {simMonths === 1 ? "mês" : "meses"}
                          </Label>
                          <Slider
                            value={[simMonths]}
                            onValueChange={([v]) => setSimMonths(v)}
                            min={1}
                            max={12}
                            step={1}
                            className="mt-3"
                          />
                        </div>
                      </div>

                      {effectiveRate <= 0 ? (
                        <div className="p-4 rounded-lg bg-muted/50 text-center">
                          <p className="text-sm text-muted-foreground">
                            Informe a taxa de juros mensal para visualizar a projeção
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* Warning alert */}
                          {simulationData.length > 0 && (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/15">
                              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-red-600">
                                  Em {simMonths} {simMonths === 1 ? "mês" : "meses"} o saldo chegará a{" "}
                                  <span className="font-bold">
                                    R$ {formatBRL(simulationData[simulationData.length - 1].endBalance)}
                                  </span>
                                </p>
                                <p className="text-[10px] text-red-500/80 mt-0.5">
                                  Juros acumulados: R${" "}
                                  {formatBRL(
                                    simulationData.reduce((sum, r) => sum + r.interest, 0)
                                  )}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Projection Table */}
                          <div className="overflow-x-auto -mx-6 px-6">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-border">
                                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Mês</th>
                                  <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Saldo Inicial</th>
                                  <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Juros ({effectiveRate.toFixed(2)}%)</th>
                                  <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Saldo Final</th>
                                </tr>
                              </thead>
                              <tbody>
                                {simulationData.map((row) => {
                                  const excessRatio = row.endBalance / globalSummary.totalOpen;
                                  const isHighlight = excessRatio >= 1.5;
                                  return (
                                    <motion.tr
                                      key={row.month}
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      transition={{ delay: row.month * 0.03 }}
                                      className={`border-b border-border/50 last:border-0 ${
                                        isHighlight ? "bg-red-500/5" : ""
                                      }`}
                                    >
                                      <td className="py-2 px-3 font-medium">{row.month}º</td>
                                      <td className="py-2 px-3 text-right text-muted-foreground">
                                        R$ {formatBRL(row.startBalance)}
                                      </td>
                                      <td className="py-2 px-3 text-right text-red-600 font-medium">
                                        + R$ {formatBRL(row.interest)}
                                      </td>
                                      <td className={`py-2 px-3 text-right font-heading font-bold ${
                                        isHighlight ? "text-red-600" : ""
                                      }`}>
                                        R$ {formatBRL(row.endBalance)}
                                      </td>
                                    </motion.tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Visual bar chart */}
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Evolução do Saldo
                            </p>
                            <div className="space-y-1.5">
                              {simulationData.map((row) => {
                                const maxBalance = simulationData[simulationData.length - 1].endBalance;
                                const widthPercent = maxBalance > 0 ? (row.endBalance / maxBalance) * 100 : 0;
                                const excessRatio = row.endBalance / globalSummary.totalOpen;
                                return (
                                  <div key={row.month} className="flex items-center gap-2">
                                    <span className="text-[10px] text-muted-foreground w-6 text-right shrink-0">
                                      {row.month}º
                                    </span>
                                    <div className="flex-1 h-5 bg-muted/30 rounded-full overflow-hidden relative">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${widthPercent}%` }}
                                        transition={{ delay: row.month * 0.05, duration: 0.4 }}
                                        className={`h-full rounded-full ${
                                          excessRatio >= 2
                                            ? "bg-gradient-to-r from-red-500 to-red-600"
                                            : excessRatio >= 1.5
                                            ? "bg-gradient-to-r from-amber-500 to-red-500"
                                            : "bg-gradient-to-r from-amber-400 to-amber-500"
                                        }`}
                                      />
                                    </div>
                                    <span className="text-[10px] font-medium w-24 text-right shrink-0">
                                      R$ {formatBRL(row.endBalance)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>
          )}

          {/* ── Per-User Balance Report ── */}
          {statementSummaries.length > 0 && (globalUserSummary.users.length > 0 || globalUserSummary.totalUnassigned > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <Card className="shadow-card overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="font-heading text-base md:text-lg flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    Saldo Aberto por Usuário
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">

                  {/* Global User Summary Table */}
                  {globalUserSummary.users.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        Resumo Global (todos os meses)
                      </p>
                      <div className="overflow-x-auto -mx-6 px-6">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Usuário</th>
                              <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Atribuído</th>
                              <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Pago</th>
                              <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Em Aberto</th>
                              {effectiveRate > 0 && (
                                <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Juros 1 mês</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {globalUserSummary.users.map((u) => {
                              const colors = userColorMap[u.userId] || USER_COLORS[0];
                              const interestNextMonth = effectiveRate > 0 ? u.open * (effectiveRate / 100) : 0;
                              return (
                                <tr key={u.userId} className="border-b border-border/50 last:border-0">
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-2">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold ${colors.bg} ${colors.text}`}>
                                        {getInitials(u.name)}
                                      </div>
                                      <span className="font-medium text-sm">{u.name}</span>
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-right text-muted-foreground">R$ {formatBRL(u.assigned)}</td>
                                  <td className="py-2 px-3 text-right text-emerald-600 font-medium">R$ {formatBRL(u.paid)}</td>
                                  <td className={`py-2 px-3 text-right font-heading font-bold ${u.open > 0 ? "text-red-600" : "text-emerald-600"}`}>
                                    {u.open > 0 ? `R$ ${formatBRL(u.open)}` : "✅ Quitado"}
                                  </td>
                                  {effectiveRate > 0 && (
                                    <td className="py-2 px-3 text-right text-red-500 text-xs">
                                      {u.open > 0 ? `+R$ ${formatBRL(interestNextMonth)}` : "—"}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                            {globalUserSummary.totalUnassigned > 0.01 && (
                              <tr className="border-b border-border/50 bg-amber-500/5">
                                <td className="py-2 px-3">
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold bg-amber-500/15 text-amber-600">
                                      <AlertTriangle className="w-3 h-3" />
                                    </div>
                                    <span className="font-medium text-sm text-amber-700">Sem Atribuição</span>
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-right text-amber-600 font-medium">R$ {formatBRL(globalUserSummary.totalUnassigned)}</td>
                                <td className="py-2 px-3 text-right text-muted-foreground">—</td>
                                <td className="py-2 px-3 text-right font-heading font-bold text-amber-600">R$ {formatBRL(globalUserSummary.totalUnassigned)}</td>
                                {effectiveRate > 0 && (
                                  <td className="py-2 px-3 text-right text-red-500 text-xs">
                                    +R$ {formatBRL(globalUserSummary.totalUnassigned * (effectiveRate / 100))}
                                  </td>
                                )}
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Month-by-Month Breakdown */}
                  <div className="space-y-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Detalhamento Mês a Mês
                    </p>

                    {userReportByStatement.map((report, ri) => (
                      <motion.div
                        key={report.statementId}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(ri * 0.05, 0.3) }}
                        className="rounded-xl border border-border overflow-hidden"
                      >
                        {/* Month header */}
                        <div className="p-3 md:p-4 bg-muted/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div>
                            <p className="font-heading font-semibold text-sm md:text-base">{report.monthLabel}</p>
                            <p className="text-xs text-muted-foreground">
                              Fatura: R$ {formatBRL(report.totalFatura)} · Atribuído: R$ {formatBRL(report.totalAssigned)} · Pago: R$ {formatBRL(report.totalPaid)}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-xs font-medium shrink-0 ${
                              report.openBalance <= 0
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : "bg-red-500/10 text-red-600 border-red-500/20"
                            }`}
                          >
                            {report.openBalance <= 0 ? "Quitado" : `R$ ${formatBRL(report.openBalance)} em aberto`}
                          </Badge>
                        </div>

                        {/* Unassigned alert */}
                        {report.unassignedAmount > 0.01 && (
                          <div className="mx-3 md:mx-4 mt-2 mb-1 flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-medium text-amber-700">
                                R$ {formatBRL(report.unassignedAmount)} em lançamentos sem atribuição
                              </p>
                              <p className="text-[10px] text-amber-600/70 mt-0.5">
                                Atribua na tela de Transações para rastrear por pessoa
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Per-user breakdown */}
                        {report.users.length > 0 ? (
                          <div className="p-3 md:p-4 space-y-2.5">
                            {report.users.map((u) => {
                              const colors = userColorMap[u.userId] || USER_COLORS[0];
                              const interestNextMonth = effectiveRate > 0 ? u.open * (effectiveRate / 100) : 0;
                              return (
                                <div key={u.userId} className={`rounded-lg border ${colors.border} ${colors.bg} p-3 relative overflow-hidden`}>
                                  <div className="flex items-center gap-2.5 sm:gap-3">
                                    <div className={`w-8 h-8 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-xs font-bold ring-2 ring-white/30`}>
                                      {getInitials(u.name)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm truncate">{u.name}</span>
                                        {u.percentPaid >= 99.9 && (
                                          <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-1.5 py-0">
                                            ✅ Quitado
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                        <span>Atrib: R$ {formatBRL(u.assigned)}</span>
                                        <span className="text-emerald-600">Pago: R$ {formatBRL(u.paid)}</span>
                                        {u.open > 0 && <span className="text-red-600 font-medium">Aberto: R$ {formatBRL(u.open)}</span>}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className={`font-heading font-bold text-sm md:text-base ${u.open > 0 ? colors.text : "text-emerald-600"}`}>
                                        {u.open > 0 ? `R$ ${formatBRL(u.open)}` : "R$ 0,00"}
                                      </p>
                                      {effectiveRate > 0 && u.open > 0 && (
                                        <p className="text-[10px] text-red-500">+R$ {formatBRL(interestNextMonth)} juros</p>
                                      )}
                                    </div>
                                  </div>
                                  {/* Progress bar */}
                                  <div className="mt-2">
                                    <Progress
                                      value={u.percentPaid}
                                      className={`h-1.5 ${
                                        u.percentPaid >= 99.9
                                          ? "[&>div]:bg-emerald-500"
                                          : u.percentPaid > 0
                                          ? "[&>div]:bg-amber-500"
                                          : "[&>div]:bg-red-400"
                                      }`}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-3 md:p-4 text-center">
                            <p className="text-xs text-muted-foreground">Nenhuma atribuição ou pagamento registrado</p>
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Empty state */}
          {statements && statements.length === 0 && (
            <Card className="shadow-card">
              <CardContent className="p-8 md:p-12 text-center">
                <FileText className="w-14 h-14 text-muted-foreground/40 mx-auto mb-4" />
                <p className="text-muted-foreground font-medium">
                  Nenhuma fatura importada para este cartão
                </p>
                <p className="text-sm text-muted-foreground/60 mt-1">
                  Importe faturas na página "Importar Fatura" para começar a gerenciar pagamentos
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── Payment Dialog ── */}
      <Dialog
        open={paymentDialog.open}
        onOpenChange={(open) =>
          setPaymentDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <CircleDollarSign className="w-5 h-5 text-primary" />
              Registrar Pagamento
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitPayment} className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Fatura</p>
              <p className="font-medium text-sm">{paymentDialog.monthLabel}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Valor da fatura: <span className="font-semibold">R$ {formatBRL(paymentDialog.totalFatura)}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Quem Pagou? *</Label>
              <Select value={payPaidBy} onValueChange={setPayPaidBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o usuário" />
                </SelectTrigger>
                <SelectContent>
                  {(profiles ?? []).map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${(userColorMap[p.user_id] || USER_COLORS[0]).bg} ${(userColorMap[p.user_id] || USER_COLORS[0]).text}`}>
                          {getInitials(p.full_name)}
                        </div>
                        {p.full_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor Pago (R$)</Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Data do Pagamento</Label>
              <Input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                placeholder="Ex: Pagamento parcial via PIX"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={2}
              />
            </div>
            <Button type="submit" className="w-full" disabled={createPayment.isPending}>
              {createPayment.isPending ? "Salvando..." : "Registrar Pagamento"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
