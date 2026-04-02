import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, CheckCircle, Users, DollarSign, User } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import AssignTransactionDialog from "@/components/AssignTransactionDialog";

export default function TransactionsPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedStatement, setSelectedStatement] = useState<string>("all");
  const [assignTx, setAssignTx] = useState<{ id: string; amount: number; description: string } | null>(null);

  const { data: statements } = useQuery({
    queryKey: ["statements-list"],
    queryFn: async () => {
      const { data } = await supabase.from("statements").select("*, credit_cards(name)").eq("status", "completed").order("year", { ascending: false });
      return data ?? [];
    },
  });

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions", selectedStatement, search],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*, statements(month, year, credit_cards(name)), transaction_assignments(user_id, share_amount)")
        .order("date", { ascending: false })
        .limit(50);

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
      toast.success("Transação marcada como revisada");
    },
  });

  const updateAlias = useMutation({
    mutationFn: async ({ id, alias }: { id: string; alias: string }) => {
      const { error } = await supabase.from("transactions").update({ alias }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Apelido salvo");
    },
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
    const total = transactions.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
    const byUser: Record<string, { name: string; total: number }> = {};
    let unassignedTotal = 0;

    for (const t of transactions) {
      const assigns = t.transaction_assignments;
      if (assigns && assigns.length > 0) {
        for (const a of assigns) {
          const uid = a.user_id;
          const name = profileMap[uid] || "Sem nome";
          if (!byUser[uid]) byUser[uid] = { name, total: 0 };
          byUser[uid].total += Number(a.share_amount);
        }
      } else {
        unassignedTotal += Number(t.amount);
      }
    }

    return { total, byUser, unassignedTotal };
  }, [transactions, profileMap]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Transações</h1>
        <p className="text-muted-foreground text-sm mt-1">Visualize e gerencie todas as transações</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="shadow-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total da Fatura</p>
                <p className="text-lg font-heading font-bold">R$ {summary.total.toFixed(2)}</p>
              </div>
            </CardContent>
          </Card>
          {Object.entries(summary.byUser).map(([uid, info]) => (
            <Card key={uid} className="shadow-card">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-accent/50 p-2">
                  <User className="w-5 h-5 text-accent-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{info.name}</p>
                  <p className="text-lg font-heading font-bold">R$ {info.total.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
          {summary.unassignedTotal > 0 && (
            <Card className="shadow-card border-dashed">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-muted p-2">
                  <Users className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Não atribuído</p>
                  <p className="text-lg font-heading font-bold">R$ {summary.unassignedTotal.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedStatement} onValueChange={setSelectedStatement}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Todas as faturas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as faturas</SelectItem>
            {statements?.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>
                {s.credit_cards?.name} - {String(s.month).padStart(2, "0")}/{s.year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Data</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Descrição</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Apelido</th>
                   <th className="text-left p-4 text-sm font-medium text-muted-foreground">Atribuído a</th>
                   <th className="text-right p-4 text-sm font-medium text-muted-foreground">Valor</th>
                  <th className="text-center p-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-right p-4 text-sm font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {transactions?.map((t: any, i: number) => (
                  <motion.tr
                    key={t.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="p-4 text-sm">{new Date(t.date).toLocaleDateString("pt-BR")}</td>
                    <td className="p-4 text-sm font-medium">{t.description}</td>
                    <td className="p-4">
                      {t.alias ? (
                        <Badge variant="secondary" className="text-xs">{t.alias}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4">
                       {t.transaction_assignments && t.transaction_assignments.length > 0 ? (
                         <div className="flex flex-wrap gap-1">
                           {t.transaction_assignments.map((a: any, idx: number) => (
                             <Badge key={idx} variant="outline" className="text-xs">
                               {a.profiles?.full_name || "—"}
                             </Badge>
                           ))}
                         </div>
                       ) : (
                         <span className="text-xs text-muted-foreground">—</span>
                       )}
                     </td>
                     <td className="p-4 text-sm text-right font-heading font-semibold">
                       R$ {Number(t.amount).toFixed(2)}
                     </td>
                    <td className="p-4 text-center">
                      {t.is_reviewed ? (
                        <Badge className="bg-success/10 text-success border-0">Revisada</Badge>
                      ) : (
                        <Badge variant="outline" className="text-warning border-warning/30">Pendente</Badge>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setAssignTx({ id: t.id, amount: Number(t.amount), description: t.alias || t.description })}
                          title="Atribuir / Dividir"
                        >
                          <Users className="w-4 h-4 text-primary" />
                        </Button>
                        {!t.is_reviewed && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => markReviewed.mutate(t.id)}
                            title="Marcar como revisada"
                          >
                            <CheckCircle className="w-4 h-4 text-success" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
                {(!transactions || transactions.length === 0) && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                      Nenhuma transação encontrada
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
    </div>
  );
}
