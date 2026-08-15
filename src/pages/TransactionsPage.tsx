import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Search, CheckCircle, Users, DollarSign, User, Plus, CreditCard, AlertTriangle, Wallet, Scissors, Receipt, X, UserPlus, Calendar, Layers, UserCircle, Trash2, CalendarClock, History, Tag, ClipboardList, Download, Pencil } from "lucide-react";

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_NAMES_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import AssignTransactionDialog from "@/components/AssignTransactionDialog";
import AddTransactionDialog from "@/components/AddTransactionDialog";
import BulkAssignDialog from "@/components/BulkAssignDialog";
import InstallmentModal, { parseInstallment } from "@/components/InstallmentModal";
import RecoverAliasModal, { canRecoverHistory } from "@/components/RecoverAliasModal";

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
  const { role, user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedStatement, setSelectedStatement] = useState<string>("");
  const [selectedCardHolder, setSelectedCardHolder] = useState<string>("all");
  const [selectedAssignedUser, setSelectedAssignedUser] = useState<string>("all");
  const [assignTx, setAssignTx] = useState<{ id: string; amount: number; description: string } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null);
  const [showInstallments, setShowInstallments] = useState(false);
  const [recoverAliasTx, setRecoverAliasTx] = useState<{ id: string; description: string; statement_id: string; amount: number } | null>(null);
  const [selectedFillFilter, setSelectedFillFilter] = useState<"all" | "no-alias" | "no-assignment">("all");
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
  const [amountValue, setAmountValue] = useState("");

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

  // Group statements by month/year (desc), for the two-level selector
  const monthGroups = useMemo(() => {
    if (!statements) return [] as { key: string; month: number; year: number; statements: any[] }[];
    const map = new Map<string, { key: string; month: number; year: number; statements: any[] }>();
    for (const s of statements as any[]) {
      const key = `${s.year}-${String(s.month).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, { key, month: s.month, year: s.year, statements: [] });
      map.get(key)!.statements.push(s);
    }
    const groups = Array.from(map.values());
    groups.sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));
    groups.forEach((g) => g.statements.sort((a: any, b: any) => (a.credit_cards?.name || "").localeCompare(b.credit_cards?.name || "")));
    return groups;
  }, [statements]);

  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  // Auto-select: prefer the current calendar month, else the most recent month
  useEffect(() => {
    if (!selectedStatement && monthGroups.length > 0) {
      const target = monthGroups.find((g) => g.key === currentMonthKey) || monthGroups[0];
      setSelectedStatement(target.statements[0].id);
    }
  }, [monthGroups, selectedStatement, currentMonthKey]);

  const effectiveStatement = selectedStatement || "all";

  // Month key of the currently selected statement ("all" when viewing everything)
  const selectedStmtObj = statements?.find((s: any) => s.id === selectedStatement);
  const selectedMonthKey = selectedStmtObj
    ? `${selectedStmtObj.year}-${String(selectedStmtObj.month).padStart(2, "0")}`
    : "all";

  const handleSelectMonth = (key: string) => {
    if (key === "all") {
      setSelectedStatement("all");
      return;
    }
    const group = monthGroups.find((g) => g.key === key);
    if (!group) return;
    // Keep the same card when switching months, if it exists in the target month
    const currentCardName = selectedStmtObj?.credit_cards?.name;
    const sameCard = group.statements.find((s: any) => s.credit_cards?.name === currentCardName);
    setSelectedStatement((sameCard || group.statements[0]).id);
  };

  const { data: rawTransactions, isLoading } = useQuery({
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

  // Extract unique card holders from raw transactions
  const cardHolders = useMemo(() => {
    if (!rawTransactions) return [];
    const holders = new Set<string>();
    for (const t of rawTransactions) {
      if (t.card_holder) holders.add(t.card_holder);
    }
    return Array.from(holders).sort();
  }, [rawTransactions]);

  // Reset filters when statement changes
  useEffect(() => {
    setSelectedCardHolder("all");
    setSelectedAssignedUser("all");
  }, [selectedStatement]);

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

  const deleteTransaction = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("transaction_assignments").delete().eq("transaction_id", id);
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Lançamento excluído");
      setDeletingTxId(null);
    },
    onError: () => toast.error("Erro ao excluir lançamento"),
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

  const updateAmount = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const { error } = await supabase.from("transactions").update({ amount }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setEditingAmountId(null);
      toast.success("Valor atualizado");
    },
    onError: () => toast.error("Erro ao atualizar valor"),
  });

  const handleAmountSave = useCallback((id: string) => {
    const parsed = parseFloat(amountValue.replace(/\./g, "").replace(",", "."));
    if (isNaN(parsed)) {
      toast.error("Valor inválido");
      return;
    }
    updateAmount.mutate({ id, amount: parsed });
  }, [amountValue, updateAmount]);

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

  // Extract unique assigned users from raw transactions
  const assignedUsers = useMemo(() => {
    if (!rawTransactions || !profileMap) return [];
    const users = new Set<string>();
    for (const t of rawTransactions) {
      if (t.transaction_assignments && t.transaction_assignments.length > 0) {
        for (const a of t.transaction_assignments) {
          users.add(a.user_id);
        }
      }
    }
    return Array.from(users).map(uid => ({
      id: uid,
      name: profileMap[uid] || "Desconhecido",
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rawTransactions, profileMap]);

  // Apply filters and sorting
  const transactions = useMemo(() => {
    if (!rawTransactions) return rawTransactions;
    
    let filtered = rawTransactions;
    
    // Filter by Card Holder
    if (selectedCardHolder !== "all") {
      filtered = filtered.filter((t: any) => t.card_holder === selectedCardHolder);
    }
    
    // Filter by Assigned User 
    if (selectedAssignedUser === "unassigned") {
      filtered = filtered.filter((t: any) => !t.transaction_assignments || t.transaction_assignments.length === 0);
    } else if (selectedAssignedUser !== "all") {
      filtered = filtered.filter((t: any) => 
        t.transaction_assignments && t.transaction_assignments.some((a: any) => a.user_id === selectedAssignedUser)
      );
    }

    // Filter by fill status
    if (selectedFillFilter === "no-alias") {
      filtered = filtered.filter((t: any) => {
        const type = t.type || "purchase";
        return type !== "payment" && Number(t.amount) > 0 && !t.alias;
      });
    } else if (selectedFillFilter === "no-assignment") {
      filtered = filtered.filter((t: any) => {
        const type = t.type || "purchase";
        return type !== "payment" && Number(t.amount) > 0 && (!t.transaction_assignments || t.transaction_assignments.length === 0);
      });
    }

    // Sort by card_holder (Responsável) and then assigned user (Atribuído a)
    return [...filtered].sort((a: any, b: any) => {
      // 1. Sort by card_holder
      const holderA = a.card_holder || "ZZZZ"; 
      const holderB = b.card_holder || "ZZZZ";
      const holderDiff = holderA.localeCompare(holderB);
      if (holderDiff !== 0) return holderDiff;

      // 2. Sort by assigned user
      const idA = a.transaction_assignments && a.transaction_assignments.length > 0 ? a.transaction_assignments[0].user_id : "ZZZZ";
      const idB = b.transaction_assignments && b.transaction_assignments.length > 0 ? b.transaction_assignments[0].user_id : "ZZZZ";
      const assignedA = profileMap[idA] || idA;
      const assignedB = profileMap[idB] || idB;
      return assignedA.localeCompare(assignedB);
    });
  }, [rawTransactions, selectedCardHolder, selectedAssignedUser, selectedFillFilter, profileMap]);

  // Selectable transactions (only purchases with positive amounts)
  const selectableTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((t: any) => {
      const type = t.type || "purchase";
      return type !== "payment" && Number(t.amount) > 0;
    });
  }, [transactions]);

  // Progress stats — count items needing attention (based on rawTransactions, ignoring filters)
  const progressStats = useMemo(() => {
    if (!rawTransactions) return { total: 0, withAlias: 0, withAssignment: 0, noAlias: 0, noAssignment: 0 };
    const actionable = rawTransactions.filter((t: any) => {
      const type = t.type || "purchase";
      return type !== "payment" && Number(t.amount) > 0;
    });
    const total = actionable.length;
    const withAlias = actionable.filter((t: any) => !!t.alias).length;
    const withAssignment = actionable.filter((t: any) => t.transaction_assignments && t.transaction_assignments.length > 0).length;
    return {
      total,
      withAlias,
      withAssignment,
      noAlias: total - withAlias,
      noAssignment: total - withAssignment,
    };
  }, [rawTransactions]);

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

  // Count installment transactions for badge
  const installmentCount = useMemo(() => {
    if (!rawTransactions) return 0;
    return rawTransactions.filter((t: any) => {
      if ((t.type || "purchase") === "payment") return false;
      const parsed = parseInstallment(t.description || "");
      if (!parsed) return false;
      // We count all active installments for the month
      return parsed.total > 1 && parsed.current <= parsed.total && parsed.current >= 1;
    }).length;
  }, [rawTransactions]);

  // Export to Excel function
  const exportToExcel = useCallback(() => {
    if (!transactions || transactions.length === 0) {
      toast.error("Nenhuma transação para exportar");
      return;
    }

    // Get statement info for filename
    const selectedStmt = statements?.find((s: any) => s.id === effectiveStatement);
    const stmtLabel = selectedStmt
      ? `${selectedStmt.credit_cards?.name || "Cartao"}_${MONTH_NAMES_FULL[(selectedStmt.month || 1) - 1]}_${selectedStmt.year}`
      : "Todas_Faturas";

    // Sheet 1: Lançamentos
    const launchRows = transactions.map((t: any) => {
      const type = t.type || "purchase";
      const amt = Number(t.amount) || 0;
      const typeLabel = type === "payment" ? "Pagamento" : type === "interest" ? "Juros" : amt < 0 ? "Estorno" : "Compra";
      const assigns = t.transaction_assignments || [];
      const assignedNames = assigns.map((a: any) => profileMap[a.user_id] || "Desconhecido").join(", ");
      const assignedAmounts = assigns.map((a: any) => Number(a.share_amount) || 0);
      const totalAssigned = assignedAmounts.reduce((s: number, v: number) => s + v, 0);

      return {
        "Data": new Date(t.date + "T00:00:00").toLocaleDateString("pt-BR"),
        "Descrição": t.description || "",
        "Apelido": t.alias || "",
        "Responsável Cartão": t.card_holder || "",
        "Tipo": typeLabel,
        "Categoria": t.category || "",
        "Atribuído a": assignedNames,
        "Valor (R$)": amt,
        "Valor Atribuído (R$)": totalAssigned > 0 ? totalAssigned : "",
      };
    });

    // Sheet 2: Preenchimento
    const fillRows = transactions
      .filter((t: any) => {
        const type = t.type || "purchase";
        return type !== "payment" && Number(t.amount) > 0;
      })
      .map((t: any) => {
        const hasAlias = !!t.alias;
        const hasAssignment = t.transaction_assignments && t.transaction_assignments.length > 0;
        const assigns = t.transaction_assignments || [];
        const assignedNames = assigns.map((a: any) => profileMap[a.user_id] || "Desconhecido").join(", ");

        return {
          "Descrição": t.description || "",
          "Apelido": t.alias || "⚠ SEM APELIDO",
          "Responsável Cartão": t.card_holder || "",
          "Atribuído a": hasAssignment ? assignedNames : "⚠ SEM ATRIBUIÇÃO",
          "Valor (R$)": Number(t.amount) || 0,
          "Status Apelido": hasAlias ? "✅ Preenchido" : "❌ Pendente",
          "Status Atribuição": hasAssignment ? "✅ Preenchido" : "❌ Pendente",
        };
      });

    const wb = XLSX.utils.book_new();

    // Sheet 1
    const ws1 = XLSX.utils.json_to_sheet(launchRows);
    ws1["!cols"] = [
      { wch: 12 }, // Data
      { wch: 40 }, // Descrição
      { wch: 30 }, // Apelido
      { wch: 20 }, // Responsável Cartão
      { wch: 12 }, // Tipo
      { wch: 15 }, // Categoria
      { wch: 30 }, // Atribuído a
      { wch: 15 }, // Valor
      { wch: 18 }, // Valor Atribuído
    ];
    XLSX.utils.book_append_sheet(wb, ws1, "Lançamentos");

    // Sheet 2
    if (fillRows.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(fillRows);
      ws2["!cols"] = [
        { wch: 40 }, // Descrição
        { wch: 30 }, // Apelido
        { wch: 20 }, // Responsável Cartão
        { wch: 30 }, // Atribuído a
        { wch: 15 }, // Valor
        { wch: 18 }, // Status Apelido
        { wch: 18 }, // Status Atribuição
      ];
      XLSX.utils.book_append_sheet(wb, ws2, "Preenchimento");
    }

    const filename = `Transacoes_${stmtLabel}.xlsx`.replace(/\s+/g, "_");
    XLSX.writeFile(wb, filename);
    toast.success(`Exportado: ${filename}`);
  }, [transactions, statements, effectiveStatement, profileMap]);

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
      if (assigns && assigns.length > 0 && type !== "payment") {
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
              <p className="font-medium text-sm leading-tight break-words pr-1">{t.description}</p>
              {t.card_holder && (
                <div className="flex items-center gap-1 mt-0.5">
                  <UserCircle className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] text-muted-foreground font-medium truncate">{t.card_holder}</span>
                </div>
              )}
              
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
                  <div className="flex items-center gap-1 group/alias-mobile flex-wrap">
                    <span className="text-xs text-muted-foreground break-words">{t.alias ? t.alias : <span className="opacity-40 italic">Sem apelido</span>}</span>
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
                  {new Date(t.date + "T00:00:00").toLocaleDateString("pt-BR")}
                </span>
                {getTypeBadge(type, Number(t.amount))}
                {t.category && (
                  <Badge variant="outline" className="text-[10px] font-normal">{t.category}</Badge>
                )}
              </div>
            </div>
            {editingAmountId === t.id ? (
              <div className="flex items-center gap-1 min-w-[120px]">
                <span className="text-xs text-muted-foreground">R$</span>
                <Input
                  value={amountValue}
                  onChange={(e) => setAmountValue(e.target.value)}
                  className="h-7 text-sm w-24 px-2 text-right font-bold"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAmountSave(t.id);
                    if (e.key === "Escape") setEditingAmountId(null);
                  }}
                />
                <Button size="icon" variant="ghost" className="h-6 w-6 text-primary shrink-0" onClick={() => handleAmountSave(t.id)}>
                  <CheckCircle className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground shrink-0" onClick={() => setEditingAmountId(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <p className={`text-base font-heading font-bold whitespace-nowrap ${type === "payment" || Number(t.amount) < 0 ? "text-green-600" : type === "interest" ? "text-destructive" : ""}`}>
                  {type === "payment" ? "- " : ""}{Number(t.amount) < 0 ? "- " : ""}R$ {Math.abs(Number(t.amount)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                {role === "admin" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 opacity-40 hover:opacity-100"
                    onClick={() => { setEditingAmountId(t.id); setAmountValue(Math.abs(Number(t.amount)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })); }}
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </Button>
                )}
              </div>
            )}
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

        <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-border/50">
          {canRecoverHistory(t.description || "") && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[11px] border-amber-300 bg-amber-50/80 hover:bg-amber-100 text-amber-800 flex items-center justify-center gap-1.5 font-semibold rounded-lg shadow-sm"
              onClick={() => setRecoverAliasTx({ id: t.id, description: t.description, statement_id: t.statement_id, amount: Number(t.amount) })}
            >
              <History className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              Recuperar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs flex items-center justify-center gap-1.5"
            onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
          >
            <User className="w-3.5 h-3.5 text-primary shrink-0" />
            Atribuir
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs flex items-center justify-center gap-1.5"
            onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
          >
            <Scissors className="w-3.5 h-3.5 text-primary shrink-0" />
            Dividir
          </Button>
          {role === "admin" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 flex items-center justify-center gap-1.5"
              onClick={() => setDeletingTxId(t.id)}
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              Excluir
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
        <div className="flex items-center gap-2">
          {transactions && transactions.length > 0 && (
            <Button onClick={exportToExcel} size="sm" variant="outline" className="border-emerald-400 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
              <Download className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Exportar Excel</span>
              <span className="sm:hidden">Excel</span>
            </Button>
          )}
          {installmentCount > 0 && (
            <Button onClick={() => setShowInstallments(true)} size="sm" variant="outline" className="relative">
              <CalendarClock className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Parcelas</span>
              <span className="sm:hidden">Parc.</span>
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">
                {installmentCount}
              </span>
            </Button>
          )}
          {selectedStatement && selectedStatement !== "all" && role === "admin" && (
            <Button onClick={() => setShowAddDialog(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Adicionar Lançamento</span>
              <span className="sm:hidden">Adicionar</span>
            </Button>
          )}
        </div>
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

      {/* Statement Selector: month chips + cards of the selected month */}
      {statements && statements.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">Selecione a fatura</p>
          </div>

          {/* Level 1: months */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            <button
              onClick={() => handleSelectMonth("all")}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all duration-200 ${
                selectedMonthKey === "all"
                  ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/40"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Todas
            </button>
            {monthGroups.map((g) => {
              const isSelected = selectedMonthKey === g.key;
              const isCurrentMonth = g.key === currentMonthKey;
              return (
                <button
                  key={g.key}
                  onClick={() => handleSelectMonth(g.key)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all duration-200 ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
                      : isCurrentMonth
                        ? "border-primary/40 bg-primary/5 text-foreground hover:bg-primary/10"
                        : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/40"
                  }`}
                >
                  {MONTH_NAMES_FULL[(g.month || 1) - 1]} {g.year}
                  {isCurrentMonth && (
                    <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5 ${
                      isSelected ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"
                    }`}>
                      Atual
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Level 2: cards within the selected month */}
          {selectedMonthKey !== "all" && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
              {(monthGroups.find((g) => g.key === selectedMonthKey)?.statements || []).map((s: any) => {
                const isSelected = selectedStatement === s.id;
                return (
                  <motion.button
                    key={s.id}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setSelectedStatement(s.id)}
                    className={`relative flex-shrink-0 inline-flex items-center gap-2 rounded-xl border-2 px-3.5 py-2 text-left transition-all duration-200 ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-md ring-1 ring-primary/20"
                        : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/40"
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected ? "gradient-primary" : "bg-muted"
                    }`}>
                      <CreditCard className={`w-3.5 h-3.5 ${isSelected ? "text-white" : "text-muted-foreground"}`} />
                    </div>
                    <span className={`text-sm font-bold truncate ${isSelected ? "text-primary" : "text-foreground"}`}>
                      {s.credit_cards?.name}
                    </span>
                    {isSelected && (
                      <motion.div
                        layoutId="statement-indicator"
                        className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary"
                      />
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Card Holder Filter */}
      {cardHolders.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <UserCircle className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">Responsável pelo Cartão</p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedCardHolder("all")}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all duration-200 ${
                selectedCardHolder === "all"
                  ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/40"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Todos
            </motion.button>
            {cardHolders.map((holder, idx) => {
              const colors = USER_COLORS[idx % USER_COLORS.length];
              const isSelected = selectedCardHolder === holder;
              const holderCount = rawTransactions?.filter((t: any) => t.card_holder === holder).length || 0;
              return (
                <motion.button
                  key={holder}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(idx * 0.03, 0.15) }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedCardHolder(isSelected ? "all" : holder)}
                  className={`flex-shrink-0 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all duration-200 ${
                    isSelected
                      ? `${colors.border} ${colors.bg} ${colors.text} shadow-sm ring-1 ${colors.ring}`
                      : "border-border bg-card text-foreground hover:border-muted-foreground/30 hover:bg-muted/40"
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isSelected ? `${colors.bg} ${colors.text}` : "bg-muted text-muted-foreground"
                  }`}>
                    {getInitials(holder)}
                  </span>
                  <span className="whitespace-nowrap">
                    {holder.split(" ").slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    isSelected ? `${colors.bg} ${colors.text}` : "bg-muted text-muted-foreground"
                  }`}>
                    {holderCount}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* Assigned User Filter */}
      {(assignedUsers.length > 0 || rawTransactions?.some((t: any) => !t.transaction_assignments || t.transaction_assignments.length === 0)) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">Atribuído a</p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedAssignedUser("all")}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all duration-200 ${
                selectedAssignedUser === "all"
                  ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/40"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Todos
            </motion.button>
            
            {/* Unassigned Option */}
            {rawTransactions?.some((t: any) => !t.transaction_assignments || t.transaction_assignments.length === 0) && (
              <motion.button
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedAssignedUser(selectedAssignedUser === "unassigned" ? "all" : "unassigned")}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all duration-200 ${
                  selectedAssignedUser === "unassigned"
                    ? "border-warning bg-warning/10 text-warning shadow-sm ring-1 ring-warning/20"
                    : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/40"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Sem atribuição
              </motion.button>
            )}

            {assignedUsers.map((user, idx) => {
              const colors = userColorMap[user.id] || USER_COLORS[idx % USER_COLORS.length];
              const isSelected = selectedAssignedUser === user.id;
              const userCount = rawTransactions?.filter((t: any) => t.transaction_assignments?.some((a: any) => a.user_id === user.id)).length || 0;
              return (
                <motion.button
                  key={user.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(idx * 0.03, 0.15) }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedAssignedUser(isSelected ? "all" : user.id)}
                  className={`flex-shrink-0 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all duration-200 ${
                    isSelected
                      ? `${colors.border} ${colors.bg} ${colors.text} shadow-sm ring-1 ${colors.ring}`
                      : "border-border bg-card text-foreground hover:border-muted-foreground/30 hover:bg-muted/40"
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isSelected ? `${colors.bg} ${colors.text}` : "bg-muted text-muted-foreground"
                  }`}>
                    {getInitials(user.name)}
                  </span>
                  <span className="whitespace-nowrap">
                    {user.name.split(" ").slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    isSelected ? `${colors.bg} ${colors.text}` : "bg-muted text-muted-foreground"
                  }`}>
                    {userCount}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search Filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Buscar por descrição..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-10 md:h-9" />
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
      <div className="md:hidden space-y-2.5 pb-36">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : transactions && transactions.length > 0 ? (
          transactions.map((t: any, i: number) => renderMobileCard(t, i))
        ) : (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {selectedStatement === "all"
              ? "Selecione uma fatura para ver os lançamentos"
              : selectedFillFilter !== "all" 
                ? "Todos os lançamentos já estão preenchidos para este filtro! 🎉"
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
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Responsável pelo Cartão</th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Tipo</th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Categoria</th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Atribuído a</th>
                  <th className="text-right p-3 font-medium text-muted-foreground whitespace-nowrap">Valor</th>
                  <th className="text-center p-3 font-medium text-muted-foreground whitespace-nowrap w-44">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-muted-foreground">Carregando...</td>
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
                          {new Date(t.date + "T00:00:00").toLocaleDateString("pt-BR")}
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
                          {t.card_holder ? (
                            <div className="flex items-center gap-1.5">
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                (() => {
                                  const holderIdx = cardHolders.indexOf(t.card_holder);
                                  const colors = USER_COLORS[holderIdx >= 0 ? holderIdx % USER_COLORS.length : 0];
                                  return `${colors.bg} ${colors.text}`;
                                })()
                              }`}>
                                {getInitials(t.card_holder)}
                              </span>
                              <span className="text-xs font-medium truncate max-w-[120px]">
                                {t.card_holder.split(" ").slice(0, 2).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
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
                          {editingAmountId === t.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-muted-foreground">R$</span>
                              <Input
                                value={amountValue}
                                onChange={(e) => setAmountValue(e.target.value)}
                                className="h-7 text-sm w-28 px-2 text-right font-bold"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleAmountSave(t.id);
                                  if (e.key === "Escape") setEditingAmountId(null);
                                }}
                              />
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-primary shrink-0" onClick={() => handleAmountSave(t.id)}>
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground shrink-0" onClick={() => setEditingAmountId(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1 group/amount">
                              <span>{t.type === "payment" ? "- " : ""}R$ {Number(t.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                              {role === "admin" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 opacity-0 group-hover/amount:opacity-100 transition-opacity"
                                  onClick={() => { setEditingAmountId(t.id); setAmountValue(Math.abs(Number(t.amount)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })); }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            {canRecoverHistory(t.description || "") && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 border-amber-300 text-amber-850 bg-amber-50/80 hover:bg-amber-100 hover:text-amber-900 flex items-center gap-1 font-semibold text-xs shadow-sm rounded-md shrink-0"
                                onClick={() => setRecoverAliasTx({ id: t.id, description: t.description, statement_id: t.statement_id, amount: Number(t.amount) })}
                                title="Buscar lançamento similar nas faturas dos últimos 5 meses"
                              >
                                <History className="w-3.5 h-3.5 text-amber-600" />
                                Recuperar Histórico
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
                              title="Atribuir usuário"
                            >
                              <User className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
                              title="Dividir despesa"
                            >
                              <Scissors className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            {role === "admin" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive/60 hover:text-destructive hover:bg-destructive/10 shrink-0"
                                onClick={() => setDeletingTxId(t.id)}
                                title="Excluir lançamento"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-muted-foreground">
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
            className="fixed bottom-6 left-0 w-full px-4 z-50 flex justify-center pointer-events-none"
          >
            <div className="pointer-events-auto flex items-center justify-between w-full max-w-[400px] gap-2 bg-primary text-primary-foreground rounded-2xl p-2 shadow-2xl border border-primary/20">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold shrink-0">
                  {selectedTxIds.size}
                </div>
                <span className="hidden sm:inline text-sm font-medium whitespace-nowrap">
                  {selectedTxIds.size === 1 ? "selecionada" : "selecionadas"}
                </span>
              </div>
              
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs font-semibold px-3 shrink-0"
                  onClick={() => setShowBulkAssign(true)}
                >
                  <UserPlus className="w-3.5 h-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Atribuir Responsável</span>
                  <span className="sm:hidden ml-1.5">Atribuir</span>
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-primary-foreground hover:bg-white/20 shrink-0"
                  onClick={deselectAll}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
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
      <InstallmentModal
        open={showInstallments}
        onOpenChange={setShowInstallments}
        transactions={rawTransactions || []}
        profileMap={profileMap}
        statementMonth={statements?.find((s: any) => s.id === effectiveStatement)?.month}
        statementYear={statements?.find((s: any) => s.id === effectiveStatement)?.year}
        userRole={role}
        currentUserId={currentUser?.id}
      />

      {selectedStatement && selectedStatement !== "all" && (
        <AddTransactionDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          statementId={selectedStatement}
        />
      )}

      <RecoverAliasModal
        open={!!recoverAliasTx}
        onOpenChange={(open) => { if (!open) setRecoverAliasTx(null); }}
        transaction={recoverAliasTx}
        profileMap={profileMap}
      />

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {deletingTxId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setDeletingTxId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-destructive/10">
                  <Trash2 className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-lg">Excluir lançamento</h3>
                  <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Tem certeza que deseja excluir este lançamento? As atribuições associadas também serão removidas.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeletingTxId(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteTransaction.mutate(deletingTxId)}
                  disabled={deleteTransaction.isPending}
                >
                  {deleteTransaction.isPending ? "Excluindo..." : "Excluir"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile: Sticky Progress Bar */}
      {rawTransactions && rawTransactions.length > 0 && progressStats.total > 0 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* Progress bar */}
            {(() => {
              const unassignedPct = progressStats.total > 0
                ? Math.round((progressStats.noAssignment / progressStats.total) * 100)
                : 0;
              return (
                <>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                    <span className="font-medium">
                      {progressStats.noAssignment} de {progressStats.total} não atribuídos
                    </span>
                    <span className="font-semibold text-foreground">
                      {unassignedPct}% sem atribuição
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        unassignedPct === 0
                          ? "bg-emerald-500"
                          : unassignedPct > 50
                            ? "bg-rose-500"
                            : "bg-amber-500"
                      }`}
                      style={{ width: `${unassignedPct}%` }}
                    />
                  </div>
                </>
              );
            })()}

            {/* Quick filter chips */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedFillFilter(selectedFillFilter === "no-alias" ? "all" : "no-alias")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all ${
                  selectedFillFilter === "no-alias"
                    ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm"
                    : "border-border bg-muted/40 text-muted-foreground active:bg-muted"
                }`}
              >
                <Tag className="w-3.5 h-3.5 shrink-0" />
                <span>Sem apelido</span>
                <span className={`min-w-[20px] h-5 rounded-full text-[10px] font-bold flex items-center justify-center px-1.5 ${
                  progressStats.noAlias > 0 
                    ? selectedFillFilter === "no-alias" ? "bg-amber-200 text-amber-900" : "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}>
                  {progressStats.noAlias}
                </span>
              </button>
              <button
                onClick={() => setSelectedFillFilter(selectedFillFilter === "no-assignment" ? "all" : "no-assignment")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all ${
                  selectedFillFilter === "no-assignment"
                    ? "border-violet-400 bg-violet-50 text-violet-800 shadow-sm"
                    : "border-border bg-muted/40 text-muted-foreground active:bg-muted"
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                <span>Sem atribuição</span>
                <span className={`min-w-[20px] h-5 rounded-full text-[10px] font-bold flex items-center justify-center px-1.5 ${
                  progressStats.noAssignment > 0
                    ? selectedFillFilter === "no-assignment" ? "bg-violet-200 text-violet-900" : "bg-violet-100 text-violet-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}>
                  {progressStats.noAssignment}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
