import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search, CheckCircle, Users, DollarSign, User, Plus, Trash2, CreditCard, TrendingDown, AlertTriangle, Wallet } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import AssignTransactionDialog from "@/components/AssignTransactionDialog";
import AddTransactionDialog from "@/components/AddTransactionDialog";

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
      // Delete assignments first, then transaction
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

  const summary = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    
    let purchases = 0;
    let payments = 0;
    let interest = 0;
    const byUser: Record<string, { name: string; total: number }> = {};
    let assignedTotal = 0;

    for (const t of transactions) {
      const amt = Number(t.amount);
      const type = (t as any).type || "purchase";
      if (type === "payment") payments += amt;
      else if (type === "interest") interest += amt;
      else purchases += amt;

      const assigns = (t as any).transaction_assignments;
      if (assigns && assigns.length > 0 && type === "purchase") {
        for (const a of assigns) {
          const uid = a.user_id;
          const name = profileMap[uid] || "Sem nome";
          if (!byUser[uid]) byUser[uid] = { name, total: 0 };
          byUser[uid].total += Number(a.share_amount);
          assignedTotal += Number(a.share_amount);
        }
      }
    }

    const openBalance = purchases + interest - payments;
    const unassignedTotal = purchases - assignedTotal;
    return { purchases, payments, interest, openBalance, byUser, unassignedTotal, count: transactions.length };
  }, [transactions, profileMap]);

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

      {/* Summary Cards */}
      {summary && (
        <div className="space-y-3">
          {/* Financial Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card className="shadow-card bg-primary/5 border-primary/20">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2 shrink-0">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Compras</p>
                  <p className="text-lg font-heading font-bold">
                    R$ {summary.purchases.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-card bg-green-500/5 border-green-500/20">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-green-500/10 p-2 shrink-0">
                  <Wallet className="w-5 h-5 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Pagamentos</p>
                  <p className="text-lg font-heading font-bold text-green-600">
                    - R$ {summary.payments.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
            {summary.interest > 0 && (
              <Card className="shadow-card bg-destructive/5 border-destructive/20">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-full bg-destructive/10 p-2 shrink-0">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">Juros / Encargos</p>
                    <p className="text-lg font-heading font-bold text-destructive">
                      R$ {summary.interest.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card className={`shadow-card ${summary.openBalance > 0 ? "bg-orange-500/5 border-orange-500/20" : "bg-green-500/5 border-green-500/20"}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`rounded-full p-2 shrink-0 ${summary.openBalance > 0 ? "bg-orange-500/10" : "bg-green-500/10"}`}>
                  <DollarSign className={`w-5 h-5 ${summary.openBalance > 0 ? "text-orange-600" : "text-green-600"}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Saldo em Aberto</p>
                  <p className={`text-lg font-heading font-bold ${summary.openBalance > 0 ? "text-orange-600" : "text-green-600"}`}>
                    R$ {summary.openBalance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
            {summary.unassignedTotal > 0.01 && (
              <Card className="shadow-card border-dashed">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-full bg-muted p-2 shrink-0">
                    <Users className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">Não atribuído</p>
                    <p className="text-lg font-heading font-bold">
                      R$ {summary.unassignedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          {/* Per-user breakdown */}
          {Object.keys(summary.byUser).length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(summary.byUser).map(([uid, info]) => (
                <Card key={uid} className="shadow-card">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="rounded-full bg-accent/50 p-2 shrink-0">
                      <User className="w-4 h-4 text-accent-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground truncate">{info.name}</p>
                      <p className="text-lg font-heading font-bold">
                        R$ {info.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
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
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Categoria</th>
                  <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">Atribuído a</th>
                  <th className="text-right p-3 font-medium text-muted-foreground whitespace-nowrap">Valor</th>
                  <th className="text-center p-3 font-medium text-muted-foreground whitespace-nowrap w-24">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">Carregando...</td>
                  </tr>
                ) : transactions && transactions.length > 0 ? (
                  transactions.map((t: any, i: number) => (
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
                        {t.category ? (
                          <Badge variant="outline" className="text-xs font-normal">{t.category}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {t.transaction_assignments && t.transaction_assignments.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {t.transaction_assignments.map((a: any, idx: number) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {profileMap[a.user_id] || "—"}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-heading font-semibold whitespace-nowrap">
                        R$ {Number(t.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
                            title="Atribuir / Dividir"
                          >
                            <Users className="w-3.5 h-3.5 text-primary" />
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
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
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
