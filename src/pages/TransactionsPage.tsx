import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search, CheckCircle, Users, DollarSign, User, Plus, Trash2, CreditCard, AlertTriangle, Wallet, Scissors, Receipt, X, UserPlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import AssignTransactionDialog from "@/components/AssignTransactionDialog";
import AddTransactionDialog from "@/components/AddTransactionDialog";
import BulkAssignDialog from "@/components/BulkAssignDialog";

const USER_COLORS = [
  { bg: "bg-violet-500/15", text: "text-violet-600", border: "border-violet-500/25", ring: "ring-violet-500/20" },
  { bg: "bg-sky-500/15", text: "text-sky-600", border: "border-sky-500/25", ring: "ring-sky-500/20" },
  { bg: "bg-amber-500/15", text: "text-amber-600", border: "border-amber-500/25", ring: "ring-amber-500/20" },
  { bg: "bg-rose-500/15", text: "text-rose-600", border: "border-rose-500/25", ring: "ring-rose-500/20" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600", border: "border-emerald-500/25", ring: "ring-emerald-500/20" },
  { bg: "bg-indigo-500/15", text: "text-indigo-600", border: "border-indigo-500/25", ring: "ring-indigo-500/20" },
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getTypeBadge(type: string, amount: number) {
  const isRefund = amount < 0;
  const config: Record<string, { label: string; cls: string }> = {
    purchase: { label: isRefund ? "Estorno" : "Compra", cls: isRefund ? "bg-blue-500/10 text-blue-700 border-blue-500/20" : "bg-primary/10 text-primary border-primary/20" },
    payment: { label: "Pagamento", cls: "bg-green-500/10 text-green-700 border-green-500/20" },
    interest: { label: "Juros", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  };
  const c = config[type] || config.purchase;
  return <Badge variant="outline" className={`text-xs font-normal ${c.cls}`}>{c.label}</Badge>;
}

export default function TransactionsPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedStatement, setSelectedStatement] = useState<string>("");
  const [assignTx, setAssignTx] = useState<{ id: string; amount: number; description: string } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState("");

  const { data: statements } = useQuery({
    queryKey: ["statements-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("statements")
        .select("*, credit_cards(name)")
        .eq("status", "completed")
        .order("year", { ascending: false });
      return data ?? [];
    },
  });

  // Auto-select latest statement
  useEffect(() => {
    if (!selectedStatement && statements && statements.length > 0) {
      const sorted = [...statements].sort((a: any, b: any) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setSelectedStatement(sorted[0].id);
    }
  }, [statements, selectedStatement]);

  const effectiveStatement = selectedStatement || "all";

  const { data: transactions, isLoading } = useQuery({
     queryKey: ["transactions", effectiveStatement, search],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*, statements(month, year, credit_cards(name)), transaction_assignments(user_id, share_amount)")
        .order("date", { ascending: false });

      if (effectiveStatement && effectiveStatement !== "all") {
        query = query.eq("statement_id", effectiveStatement);
      }
      if (search.trim()) {
        query = query.ilike("description", `%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name");
      return data ?? [];
    },
  });

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transactions").update({ is_reviewed: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transação revisada");
    },
  });

  const deleteTx = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("transaction_assignments").delete().eq("transaction_id", id);
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Lançamento removido");
    },
    onError: () => toast.error("Erro ao remover lançamento"),
  });

  const deleteBulkTx = useMutation({
    mutationFn: async (ids: string[]) => {
      await supabase.from("transaction_assignments").delete().in("transaction_id", ids);
      const { error } = await supabase.from("transactions").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Lançamentos removidos");
      deselectAll();
    },
    onError: () => toast.error("Erro ao remover lançamentos"),
  });

  const updateAlias = useMutation({
    mutationFn: async ({ id, alias }: { id: string; alias: string | null }) => {
      const { error } = await supabase.from("transactions").update({ alias }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setEditingAliasId(null);
      toast.success("Apelido atualizado");
    },
    onError: () => toast.error("Erro ao atualizar apelido"),
  });

  const profileMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles ?? []) {
      map[p.user_id] = p.full_name;
    }
    return map;
  }, [profiles]);

  const userColorMap = useMemo(() => {
    const map: Record<string, typeof USER_COLORS[0]> = {};
    const userIds = Object.keys(profileMap);
    userIds.forEach((uid, i) => {
      map[uid] = USER_COLORS[i % USER_COLORS.length];
    });
    return map;
  }, [profileMap]);

  // Selectable transactions (only purchases with positive amounts)
  const selectableTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((t: any) => {
      const type = t.type || "purchase";
      return type !== "payment" && Number(t.amount) > 0;
    });
  }, [transactions]);

  const toggleTxSelection = useCallback((txId: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) {
        next.delete(txId);
      } else {
        next.add(txId);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    const ids = selectableTransactions.map((t: any) => t.id);
    setSelectedTxIds(new Set(ids));
  }, [selectableTransactions]);

  const deselectAll = useCallback(() => {
    setSelectedTxIds(new Set());
  }, []);

  const selectedTxData = useMemo(() => {
    if (!transactions) return [];
    return transactions
      .filter((t: any) => selectedTxIds.has(t.id))
      .map((t: any) => ({
        id: t.id,
        amount: Number(t.amount),
        description: t.alias || t.description,
      }));
  }, [transactions, selectedTxIds]);

  // Clear selection when statement changes
  useEffect(() => {
    setSelectedTxIds(new Set());
  }, [selectedStatement]);



  const summary = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;

    let purchasesPositive = 0;
    let purchasesNegative = 0;
    let payments = 0;
    let interest = 0;
    const byUser: Record<string, { name: string; total: number; txCount: number }> = {};
    let assignedTotal = 0;

    for (const t of transactions) {
      const amt = Number(t.amount) || 0;
      const type = t.type || "purchase";
      if (type === "payment") {
        payments += Math.abs(amt);
      } else if (type === "interest") {
        interest += amt; // net interest (includes any negative interest entries)
      } else {
        // type === "purchase" — includes refunds (negative amounts)
        if (amt < 0) purchasesNegative += Math.abs(amt);
        else purchasesPositive += amt;
      }

      const assigns = t.transaction_assignments;
      if (assigns && assigns.length > 0 && type !== "payment" && amt > 0) {
        for (const a of assigns) {
          const uid = a.user_id;
          const share = Number(a.share_amount) || 0;
          const name = profileMap[uid] || "Sem nome";
          if (!byUser[uid]) byUser[uid] = { name, total: 0, txCount: 0 };
          byUser[uid].total += share;
          byUser[uid].txCount += 1;
          assignedTotal += share;
        }
      }
    }

    const purchases = purchasesPositive - purchasesNegative; // net purchases
    const refunds = purchasesNegative;

    // Get previous_balance and total_fatura from selected statement
    const selectedStmt = statements?.find((s: any) => s.id === effectiveStatement);
    const previousBalance = selectedStmt ? Number(selectedStmt.previous_balance) || 0 : 0;
    const totalFaturaDoc = selectedStmt ? Number(selectedStmt.total_fatura) || 0 : 0;

    const totalCharges = purchases + interest;
    // Formula: Saldo Anterior + Compras (líquido) + Juros = Valor a Pagar
    const calculatedBalance = previousBalance + totalCharges;
    const openBalance = totalFaturaDoc > 0 ? totalFaturaDoc : calculatedBalance;
    const unassignedTotal = totalCharges - assignedTotal;
    return { purchases, purchasesPositive, payments, interest, refunds, openBalance, totalCharges, byUser, unassignedTotal, assignedTotal, count: transactions.length, previousBalance, totalFaturaDoc };
  }, [transactions, profileMap, statements, effectiveStatement]);

  const formatBRL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Render a single mobile transaction card
  const renderMobileCard = (t: any, i: number) => {
    const hasAssignment = t.transaction_assignments && t.transaction_assignments.length > 0;
    const type = t.type || "purchase";
    const isSelectable = type !== "payment" && Number(t.amount) > 0;
    const isSelected = selectedTxIds.has(t.id);
    return (
      <motion.div
        key={t.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(i * 0.02, 0.4) }}
        className={`bg-card border rounded-xl p-4 space-y-3 active:bg-muted/40 transition-colors ${
          isSelected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border"
        }`}
      >
        {/* Row 1: Checkbox + Description + Amount */}
        <div className="flex items-start gap-3">
          {isSelectable && (
            <div className="pt-0.5 shrink-0">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleTxSelection(t.id)}
                className="h-5 w-5"
              />
            </div>
          )}
          <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-tight truncate">{t.description}</p>
              
              <div className="mt-1">
                {editingAliasId === t.id ? (
                  <div className="flex items-center gap-1">
                     <Input
                        value={aliasValue}
                        onChange={(e) => setAliasValue(e.target.value)}
                        className="h-7 text-xs w-full px-2"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter") updateAlias.mutate({ id: t.id, alias: aliasValue.trim() || null });
                            if (e.key === "Escape") setEditingAliasId(null);
                        }}
                     />
                     <Button size="icon" variant="ghost" className="h-6 w-6 text-primary shrink-0" onClick={() => updateAlias.mutate({ id: t.id, alias: aliasValue.trim() || null })}>
                        <CheckCircle className="h-4 w-4" />
                     </Button>
                     <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground shrink-0" onClick={() => setEditingAliasId(null)}>
                        <X className="h-4 w-4" />
                     </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 group/alias-mobile">
                    <span className="text-xs text-muted-foreground truncate">{t.alias ? t.alias : <span className="opacity-40 italic">Sem apelido</span>}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 ml-1 shrink-0 bg-muted/30"
                      onClick={() => { setEditingAliasId(t.id); setAliasValue(t.alias || ""); }}
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="text-xs text-muted-foreground">
                  {new Date(t.date).toLocaleDateString("pt-BR")}
                </span>
                {getTypeBadge(type, Number(t.amount))}
                {t.category && (
                  <Badge variant="outline" className="text-[10px] font-normal">{t.category}</Badge>
                )}
              </div>
            </div>
            <p className={`text-base font-heading font-bold whitespace-nowrap ${type === "payment" || Number(t.amount) < 0 ? "text-green-600" : type === "interest" ? "text-destructive" : ""}`}>
              {type === "payment" ? "- " : ""}{Number(t.amount) < 0 ? "- " : ""}R$ {Math.abs(Number(t.amount)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Row 2: Assignments */}
        {hasAssignment ? (
          <div className="flex flex-wrap gap-1.5">
            {t.transaction_assignments.map((a: any, idx: number) => {
              const name = profileMap[a.user_id] || "—";
              const colors = userColorMap[a.user_id] || USER_COLORS[0];
              return (
                <div
                  key={idx}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${colors.bg} ${colors.border} border`}
                >
                  <span className={`w-5 h-5 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-[10px] font-bold`}>
                    {getInitials(name)}
                  </span>
                  <span className="font-medium">{name.split(" ")[0]}</span>
                  <span className={`${colors.text} font-semibold`}>
                    R$ {Number(a.share_amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              );
            })}
          </div>
        ) : type !== "payment" ? (
          <button
            onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground border border-dashed border-muted-foreground/30 rounded-full px-3 py-1.5 active:bg-muted/50"
          >
            <User className="w-3.5 h-3.5" />
            <span>Atribuir usuário</span>
          </button>
        ) : null}

        {/* Row 3: Actions */}
        <div className="flex items-center gap-1 pt-1 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs flex-1"
            onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
          >
            <User className="w-3.5 h-3.5 mr-1.5 text-primary" />
            Atribuir
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs flex-1"
            onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
          >
            <Scissors className="w-3.5 h-3.5 mr-1.5 text-primary" />
            Dividir
          </Button>

          {role === "admin" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-xs"
              onClick={() => {
                if (confirm("Remover este lançamento?")) deleteTx.mutate(t.id);
              }}
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </motion.div>
    );
  };

  const allSelectableSelected = selectableTransactions.length > 0 && selectableTransactions.every((t: any) => selectedTxIds.has(t.id));
  const someSelected = selectedTxIds.size > 0;

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold">Transações</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {summary ? `${summary.count} lançamentos` : "Visualize e gerencie lançamentos"}
          </p>
        </div>
        {selectedStatement && selectedStatement !== "all" && role === "admin" && (
          <Button onClick={() => setShowAddDialog(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Adicionar Lançamento</span>
            <span className="sm:hidden">Adicionar</span>
          </Button>
        )}
      </div>

      {/* Summary Section - Hero + Cards */}
      {summary && (
        <div className="space-y-3 md:space-y-4">
          {/* Hero: Total da Fatura */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="shadow-elevated overflow-hidden border-0">
              <div className="gradient-primary p-5 sm:p-6 md:p-8">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
                      <div className="p-1.5 sm:p-2 rounded-full bg-white/15 backdrop-blur-sm">
                        <Receipt className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                      </div>
                      <p className="text-white/80 text-xs sm:text-sm font-medium tracking-wide uppercase">Valor a Pagar</p>
                    </div>
                    <p className="text-3xl sm:text-4xl md:text-5xl font-heading font-bold text-white tracking-tight">
                      R$ {formatBRL(summary.openBalance > 0 ? summary.openBalance : 0)}
                    </p>
                     <p className="text-white/60 text-xs sm:text-sm mt-1.5 sm:mt-2">
                       {summary.previousBalance > 0 && (
                         <>Saldo anterior: <span className="text-white/90 font-medium">R$ {formatBRL(summary.previousBalance)}</span> · </>
                       )}
                       Total da fatura: <span className="text-white/90 font-medium">R$ {formatBRL(summary.totalCharges)}</span>
                       {summary.payments > 0 && (
                         <> · Pagamentos: <span className="text-white/90 font-medium">- R$ {formatBRL(summary.payments)}</span></>
                       )}
                     </p>
                  </div>
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-4 border border-white/10">
                    <p className="text-white/70 text-[10px] sm:text-xs font-medium uppercase tracking-wide">Total Fatura (Compras + Juros)</p>
                    <p className="text-xl sm:text-2xl font-heading font-bold text-white mt-0.5">
                      R$ {formatBRL(summary.totalCharges)}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Secondary stats — scrollable horizontally on mobile */}
          <div className="flex gap-2.5 md:gap-3 overflow-x-auto pb-1 md:pb-0 md:grid md:grid-cols-4 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="min-w-[140px] md:min-w-0 flex-shrink-0 md:flex-shrink">
              <Card className="shadow-card bg-primary/5 border-primary/20 h-full">
                <CardContent className="p-3 md:p-4 flex items-center gap-2.5 md:gap-3">
                  <div className="rounded-full bg-primary/10 p-1.5 md:p-2 shrink-0">
                    <CreditCard className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] md:text-xs text-muted-foreground truncate">Compras (líquido)</p>
                    <p className="text-sm md:text-lg font-heading font-bold">
                      R$ {formatBRL(summary.purchases)}
                    </p>
                    {summary.refunds > 0 && (
                      <p className="text-[9px] md:text-[10px] text-muted-foreground">
                        Bruto: R$ {formatBRL(summary.purchasesPositive)} · Estornos: -R$ {formatBRL(summary.refunds)}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {summary.interest > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="min-w-[140px] md:min-w-0 flex-shrink-0 md:flex-shrink">
                <Card className="shadow-card bg-destructive/5 border-destructive/20 h-full">
                  <CardContent className="p-3 md:p-4 flex items-center gap-2.5 md:gap-3">
                    <div className="rounded-full bg-destructive/10 p-1.5 md:p-2 shrink-0">
                      <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-destructive" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] md:text-xs text-muted-foreground truncate">Juros / Encargos</p>
                      <p className="text-sm md:text-lg font-heading font-bold text-destructive">
                        R$ {formatBRL(summary.interest)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
            {summary.unassignedTotal > 0.01 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="min-w-[140px] md:min-w-0 flex-shrink-0 md:flex-shrink">
                <Card className="shadow-card border-dashed border-warning/40 h-full">
                  <CardContent className="p-3 md:p-4 flex items-center gap-2.5 md:gap-3">
                    <div className="rounded-full bg-warning/10 p-1.5 md:p-2 shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 md:w-4 md:h-4 text-warning" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] md:text-xs text-muted-foreground truncate">Não atribuído</p>
                      <p className="text-sm md:text-lg font-heading font-bold text-warning">
                        R$ {formatBRL(summary.unassignedTotal)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>

          {/* Per-user breakdown */}
          {Object.keys(summary.byUser).length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <Card className="shadow-card">
                <CardContent className="p-3 md:p-4">
                  <div className="flex items-center gap-2 mb-3 md:mb-4">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-muted-foreground">Valor por Pessoa</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-3">
                    {Object.entries(summary.byUser).map(([uid, info], idx) => {
                      const colors = userColorMap[uid] || USER_COLORS[0];
                      const percent = summary.totalCharges > 0 ? (info.total / summary.totalCharges) * 100 : 0;
                      return (
                        <motion.div
                          key={uid}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3 + idx * 0.05 }}
                          className={`relative rounded-xl border ${colors.border} ${colors.bg} p-3 md:p-4 overflow-hidden`}
                        >
                          <div
                            className={`absolute bottom-0 left-0 h-1 opacity-60`}
                            style={{ width: `${Math.min(percent, 100)}%`, background: `hsl(var(--primary) / 0.3)` }}
                          />
                          <div className="flex items-center gap-2.5 md:gap-3">
                            <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-xs md:text-sm font-bold ring-2 ${colors.ring}`}>
                              {getInitials(info.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{info.name}</p>
                              <p className="text-xs text-muted-foreground">{info.txCount} lançamento{info.txCount !== 1 ? "s" : ""}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-lg md:text-xl font-heading font-bold ${colors.text}`}>
                                R$ {formatBRL(info.total)}
                              </p>
                              <p className="text-[10px] md:text-xs text-muted-foreground">{percent.toFixed(0)}% do total</p>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por descrição..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-10 md:h-9" />
        </div>
        <Select value={selectedStatement} onValueChange={setSelectedStatement}>
          <SelectTrigger className="w-full sm:w-72 h-10 md:h-9">
            <SelectValue placeholder="Todas as faturas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as faturas</SelectItem>
            {statements?.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>
                {s.credit_cards?.name} — {String(s.month).padStart(2, "0")}/{s.year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Selection controls */}
      {transactions && transactions.length > 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={allSelectableSelected ? deselectAll : selectAllVisible}
          >
            <Checkbox
              checked={allSelectableSelected}
              className="mr-1.5 h-3.5 w-3.5"
              onCheckedChange={allSelectableSelected ? deselectAll : selectAllVisible}
            />
            {allSelectableSelected ? "Desmarcar todas" : "Selecionar todas"}
          </Button>
          {someSelected && (
            <span className="text-xs text-muted-foreground">
              {selectedTxIds.size} {selectedTxIds.size === 1 ? "selecionada" : "selecionadas"}
            </span>
          )}
        </div>
      )}

      {/* Mobile: Card-based transaction list */}
      <div className="md:hidden space-y-2.5">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : transactions && transactions.length > 0 ? (
          transactions.map((t: any, i: number) => renderMobileCard(t, i))
        ) : (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {selectedStatement === "all"
              ? "Selecione uma fatura para ver os lançamentos"
              : "Nenhuma transação encontrada"}
          </div>
        )}
      </div>

      {/* Desktop: Table */}
      <Card className="shadow-card overflow-hidden hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="p-3 w-10">
                    <Checkbox
                      checked={allSelectableSelected && selectableTransactions.length > 0}
                      onCheckedChange={allSelectableSelected ? deselectAll : selectAllVisible}
                    />
                  </th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Data</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Descrição</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Apelido</th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Tipo</th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Categoria</th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Atribuído a</th>
                  <th className="text-right p-3 font-medium text-muted-foreground whitespace-nowrap">Valor</th>
                  <th className="text-center p-3 font-medium text-muted-foreground whitespace-nowrap w-28">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">Carregando...</td>
                  </tr>
                ) : transactions && transactions.length > 0 ? (
                  transactions.map((t: any, i: number) => {
                    const hasAssignment = t.transaction_assignments && t.transaction_assignments.length > 0;
                    const type = t.type || "purchase";
                    const isSelectable = type !== "payment" && Number(t.amount) > 0;
                    const isSelected = selectedTxIds.has(t.id);
                    return (
                      <motion.tr
                        key={t.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.01, 0.5) }}
                        className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors group ${
                          isSelected ? "bg-primary/5" : ""
                        }`}
                      >
                        <td className="p-3 w-10">
                          {isSelectable && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleTxSelection(t.id)}
                            />
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap text-muted-foreground">
                          {new Date(t.date).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="p-3">
                          <span className="font-medium">{t.description}</span>
                        </td>
                        <td className="p-3 max-w-[150px]">
                          {editingAliasId === t.id ? (
                            <div className="flex items-center gap-1">
                               <Input
                                  value={aliasValue}
                                  onChange={(e) => setAliasValue(e.target.value)}
                                  className="h-7 text-xs w-full px-2"
                                  autoFocus
                                  onKeyDown={(e) => {
                                      if (e.key === "Enter") updateAlias.mutate({ id: t.id, alias: aliasValue.trim() || null });
                                      if (e.key === "Escape") setEditingAliasId(null);
                                  }}
                               />
                               <Button size="icon" variant="ghost" className="h-6 w-6 text-primary shrink-0" onClick={() => updateAlias.mutate({ id: t.id, alias: aliasValue.trim() || null })}>
                                  <CheckCircle className="h-4 w-4" />
                               </Button>
                               <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground shrink-0" onClick={() => setEditingAliasId(null)}>
                                  <X className="h-4 w-4" />
                               </Button>
                            </div>
                          ) : (
                            <div className="flex items-center group/alias min-h-[28px]">
                              <span className="text-muted-foreground truncate">{t.alias ? t.alias : <span className="opacity-40 italic">Sem apelido</span>}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 ml-2 opacity-0 group-hover/alias:opacity-100 transition-opacity shrink-0"
                                onClick={() => { setEditingAliasId(t.id); setAliasValue(t.alias || ""); }}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {getTypeBadge(t.type || "purchase", Number(t.amount))}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {t.category ? (
                            <Badge variant="outline" className="text-xs font-normal">{t.category}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {hasAssignment ? (
                            <div className="flex flex-wrap gap-1.5">
                              {t.transaction_assignments.map((a: any, idx: number) => {
                                const name = profileMap[a.user_id] || "—";
                                const colors = userColorMap[a.user_id] || USER_COLORS[0];
                                return (
                                  <div
                                    key={idx}
                                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${colors.bg} ${colors.border} border`}
                                  >
                                    <span className={`w-5 h-5 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-[10px] font-bold`}>
                                      {getInitials(name)}
                                    </span>
                                    <span className="font-medium">{name.split(" ")[0]}</span>
                                    <span className={`${colors.text} font-semibold`}>
                                      R$ {Number(a.share_amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            t.type !== "payment" ? (
                              <button
                                onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer border border-dashed border-muted-foreground/30 hover:border-primary/40 rounded-full px-2.5 py-1"
                              >
                                <User className="w-3 h-3" />
                                <span>Atribuir</span>
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )
                          )}
                        </td>
                        <td className={`p-3 text-right font-heading font-semibold whitespace-nowrap ${t.type === "payment" ? "text-green-600" : t.type === "interest" ? "text-destructive" : ""}`}>
                          {t.type === "payment" ? "- " : ""}R$ {Number(t.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
                              title="Atribuir usuário"
                            >
                              <User className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
                              title="Dividir despesa"
                            >
                              <Scissors className="w-3.5 h-3.5 text-primary" />
                            </Button>

                            {role === "admin" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  if (confirm("Remover este lançamento?")) deleteTx.mutate(t.id);
                                }}
                                title="Remover"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      {selectedStatement === "all"
                        ? "Selecione uma fatura para ver os lançamentos"
                        : "Nenhuma transação encontrada"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Floating action bar for bulk selection */}
      <AnimatePresence>
        {someSelected && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-3 bg-primary text-primary-foreground rounded-2xl px-5 py-3 shadow-2xl border border-primary/20">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
                  {selectedTxIds.size}
                </div>
                <span className="text-sm font-medium whitespace-nowrap">
                  {selectedTxIds.size === 1 ? "transação selecionada" : "transações selecionadas"}
                </span>
              </div>
              <div className="w-px h-6 bg-white/20" />
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-xs font-semibold"
                onClick={() => setShowBulkAssign(true)}
              >
                <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                Atribuir Responsável
              </Button>
              {role === "admin" && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 text-xs font-semibold"
                  onClick={() => {
                    if (confirm(`Remover ${selectedTxIds.size} lançamento(s)?`)) {
                      deleteBulkTx.mutate(Array.from(selectedTxIds));
                    }
                  }}
                  disabled={deleteBulkTx.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Excluir
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-white/20"
                onClick={deselectAll}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AssignTransactionDialog
        open={!!assignTx}
        onOpenChange={(open) => { if (!open) setAssignTx(null); }}
        transaction={assignTx}
      />

      <BulkAssignDialog
        open={showBulkAssign}
        onOpenChange={setShowBulkAssign}
        transactions={selectedTxData}
        onComplete={deselectAll}
      />

      {selectedStatement && selectedStatement !== "all" && (
        <AddTransactionDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          statementId={selectedStatement}
        />
      )}
    </div>
  );
}
