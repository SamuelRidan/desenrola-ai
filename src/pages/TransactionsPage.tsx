import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search, CheckCircle, Users, DollarSign, User, Plus, Trash2, CreditCard, AlertTriangle, Wallet, Scissors, Receipt } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import AssignTransactionDialog from "@/components/AssignTransactionDialog";
import AddTransactionDialog from "@/components/AddTransactionDialog";

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

export default function TransactionsPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedStatement, setSelectedStatement] = useState<string>("all");
  const [assignTx, setAssignTx] = useState<{ id: string; amount: number; description: string } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

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

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions", selectedStatement, search],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*, statements(month, year, credit_cards(name)), transaction_assignments(user_id, share_amount)")
        .order("date", { ascending: false });

      if (selectedStatement && selectedStatement !== "all") {
        query = query.eq("statement_id", selectedStatement);
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

  const profileMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles ?? []) {
      map[p.user_id] = p.full_name;
    }
    return map;
  }, [profiles]);

  // Stable color map per user id
  const userColorMap = useMemo(() => {
    const map: Record<string, typeof USER_COLORS[0]> = {};
    const userIds = Object.keys(profileMap);
    userIds.forEach((uid, i) => {
      map[uid] = USER_COLORS[i % USER_COLORS.length];
    });
    return map;
  }, [profileMap]);

  const summary = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;

    let purchases = 0;
    let payments = 0;
    let interest = 0;
    const byUser: Record<string, { name: string; total: number; txCount: number }> = {};
    let assignedTotal = 0;

    for (const t of transactions) {
      const amt = Number(t.amount) || 0;
      const type = t.type || "purchase";
      if (type === "payment") payments += amt;
      else if (type === "interest") interest += amt;
      else purchases += amt;

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

    const totalCharges = purchases + interest;
    const openBalance = totalCharges - payments;
    const unassignedTotal = totalCharges - assignedTotal;
    return { purchases, payments, interest, openBalance, totalCharges, byUser, unassignedTotal, assignedTotal, count: transactions.length };
  }, [transactions, profileMap]);

  const formatBRL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold">Transações</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {summary ? `${summary.count} lançamentos` : "Visualize e gerencie lançamentos"}
          </p>
        </div>
        {selectedStatement && selectedStatement !== "all" && role === "admin" && (
          <Button onClick={() => setShowAddDialog(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Adicionar Lançamento
          </Button>
        )}
      </div>

      {/* Summary Section - Hero + Cards */}
      {summary && (
        <div className="space-y-4">
          {/* Hero: Total da Fatura */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="shadow-elevated overflow-hidden border-0">
              <div className="gradient-primary p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-2 rounded-full bg-white/15 backdrop-blur-sm">
                        <Receipt className="w-5 h-5 text-white" />
                      </div>
                      <p className="text-white/80 text-sm font-medium tracking-wide uppercase">Total da Fatura</p>
                    </div>
                    <p className="text-4xl sm:text-5xl font-heading font-bold text-white tracking-tight">
                      R$ {formatBRL(summary.totalCharges)}
                    </p>
                    {summary.payments > 0 && (
                      <p className="text-white/60 text-sm mt-2">
                        Pagamentos realizados: <span className="text-white/90 font-medium">- R$ {formatBRL(summary.payments)}</span>
                      </p>
                    )}
                  </div>
                  {summary.openBalance > 0 && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                      <p className="text-white/70 text-xs font-medium uppercase tracking-wide">Saldo em Aberto</p>
                      <p className="text-2xl font-heading font-bold text-white mt-0.5">
                        R$ {formatBRL(summary.openBalance)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <Card className="shadow-card bg-primary/5 border-primary/20 h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-full bg-primary/10 p-2 shrink-0">
                    <CreditCard className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">Compras</p>
                    <p className="text-lg font-heading font-bold">
                      R$ {formatBRL(summary.purchases)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="shadow-card bg-green-500/5 border-green-500/20 h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-full bg-green-500/10 p-2 shrink-0">
                    <Wallet className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">Pagamentos</p>
                    <p className="text-lg font-heading font-bold text-green-600">
                      - R$ {formatBRL(summary.payments)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            {summary.interest > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <Card className="shadow-card bg-destructive/5 border-destructive/20 h-full">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="rounded-full bg-destructive/10 p-2 shrink-0">
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground truncate">Juros / Encargos</p>
                      <p className="text-lg font-heading font-bold text-destructive">
                        R$ {formatBRL(summary.interest)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
            {summary.unassignedTotal > 0.01 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card className="shadow-card border-dashed border-warning/40 h-full">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="rounded-full bg-warning/10 p-2 shrink-0">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground truncate">Não atribuído</p>
                      <p className="text-lg font-heading font-bold text-warning">
                        R$ {formatBRL(summary.unassignedTotal)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>

          {/* Per-user breakdown — emphasized */}
          {Object.keys(summary.byUser).length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <Card className="shadow-card">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-muted-foreground">Valor por Pessoa</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(summary.byUser).map(([uid, info], idx) => {
                      const colors = userColorMap[uid] || USER_COLORS[0];
                      const percent = summary.totalCharges > 0 ? (info.total / summary.totalCharges) * 100 : 0;
                      return (
                        <motion.div
                          key={uid}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3 + idx * 0.05 }}
                          className={`relative rounded-xl border ${colors.border} ${colors.bg} p-4 overflow-hidden`}
                        >
                          {/* Progress bar background */}
                          <div
                            className={`absolute bottom-0 left-0 h-1 ${colors.bg} opacity-60`}
                            style={{ width: `${Math.min(percent, 100)}%`, background: `hsl(var(--primary) / 0.3)` }}
                          />
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-sm font-bold ring-2 ${colors.ring}`}>
                              {getInitials(info.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{info.name}</p>
                              <p className="text-xs text-muted-foreground">{info.txCount} lançamento{info.txCount !== 1 ? "s" : ""}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-xl font-heading font-bold ${colors.text}`}>
                                R$ {formatBRL(info.total)}
                              </p>
                              <p className="text-xs text-muted-foreground">{percent.toFixed(0)}% do total</p>
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
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por descrição..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={selectedStatement} onValueChange={setSelectedStatement}>
          <SelectTrigger className="w-full sm:w-72">
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

      {/* Transactions Table */}
      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Data</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Descrição</th>
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
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">Carregando...</td>
                  </tr>
                ) : transactions && transactions.length > 0 ? (
                  transactions.map((t: any, i: number) => {
                    const hasAssignment = t.transaction_assignments && t.transaction_assignments.length > 0;
                    return (
                      <motion.tr
                        key={t.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.01, 0.5) }}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group"
                      >
                        <td className="p-3 whitespace-nowrap text-muted-foreground">
                          {new Date(t.date).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="p-3">
                          <div>
                            <span className="font-medium">{t.description}</span>
                            {t.alias && (
                              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">{t.alias}</Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {(() => {
                            const type = t.type || "purchase";
                            const config: Record<string, { label: string; cls: string }> = {
                              purchase: { label: "Compra", cls: "bg-primary/10 text-primary border-primary/20" },
                              payment: { label: "Pagamento", cls: "bg-green-500/10 text-green-700 border-green-500/20" },
                              interest: { label: "Juros", cls: "bg-destructive/10 text-destructive border-destructive/20" },
                            };
                            const c = config[type] || config.purchase;
                            return <Badge variant="outline" className={`text-xs font-normal ${c.cls}`}>{c.label}</Badge>;
                          })()}
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
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors group/assign cursor-pointer border border-dashed border-muted-foreground/30 hover:border-primary/40 rounded-full px-2.5 py-1"
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
                            {!t.is_reviewed && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => markReviewed.mutate(t.id)}
                                title="Marcar como revisada"
                              >
                                <CheckCircle className="w-3.5 h-3.5 text-success" />
                              </Button>
                            )}
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
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
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

      <AssignTransactionDialog
        open={!!assignTx}
        onOpenChange={(open) => { if (!open) setAssignTx(null); }}
        transaction={assignTx}
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
