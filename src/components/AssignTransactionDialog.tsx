import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Scissors, Trash2, User, Check, AlertTriangle } from "lucide-react";

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

interface Profile {
  user_id: string;
  full_name: string;
}

interface Assignment {
  id?: string;
  user_id: string;
  share_amount: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: { id: string; amount: number; description: string } | null;
}

export default function AssignTransactionDialog({ open, onOpenChange, transaction }: Props) {
  const queryClient = useQueryClient();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name");
      return (data ?? []) as Profile[];
    },
  });

  const userColorMap = useMemo(() => {
    const map: Record<string, typeof USER_COLORS[0]> = {};
    (profiles ?? []).forEach((p, i) => {
      map[p.user_id] = USER_COLORS[i % USER_COLORS.length];
    });
    return map;
  }, [profiles]);

  const { data: existingAssignments } = useQuery({
    queryKey: ["assignments", transaction?.id],
    queryFn: async () => {
      if (!transaction) return [];
      const { data } = await supabase
        .from("transaction_assignments")
        .select("id, user_id, share_amount")
        .eq("transaction_id", transaction.id);
      return (data ?? []) as Assignment[];
    },
    enabled: !!transaction && open,
  });

  useEffect(() => {
    if (existingAssignments && existingAssignments.length > 0) {
      const users = existingAssignments.map((a) => a.user_id);
      const amts: Record<string, string> = {};
      existingAssignments.forEach((a) => {
        amts[a.user_id] = String(a.share_amount);
      });
      setSelectedUsers(users);
      setAmounts(amts);
    } else {
      setSelectedUsers([]);
      setAmounts({});
    }
  }, [existingAssignments, open]);

  const toggleUser = (userId: string) => {
    setSelectedUsers((prev) => {
      if (prev.includes(userId)) {
        // Also clean up amount
        setAmounts((a) => {
          const copy = { ...a };
          delete copy[userId];
          return copy;
        });
        return prev.filter((u) => u !== userId);
      }
      return [...prev, userId];
    });
  };

  const splitEvenly = () => {
    if (!transaction || selectedUsers.length === 0) return;
    const share = (transaction.amount / selectedUsers.length).toFixed(2);
    const newAmounts: Record<string, string> = {};
    selectedUsers.forEach((uid) => {
      newAmounts[uid] = share;
    });
    setAmounts(newAmounts);
  };

  const assignToSingle = (userId: string) => {
    if (!transaction) return;
    setSelectedUsers([userId]);
    setAmounts({ [userId]: String(transaction.amount.toFixed(2)) });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!transaction) return;

      await supabase
        .from("transaction_assignments")
        .delete()
        .eq("transaction_id", transaction.id);

      if (selectedUsers.length === 0) return;

      const rows = selectedUsers.map((uid) => ({
        transaction_id: transaction.id,
        user_id: uid,
        share_amount: parseFloat(amounts[uid] || "0"),
      }));

      const { error } = await supabase.from("transaction_assignments").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["monthly-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expense-split"] });
      toast.success("Atribuições salvas!");
      onOpenChange(false);
    },
    onError: () => toast.error("Erro ao salvar atribuições"),
  });

  // Fixed: properly sum all amounts from selected users
  const totalAssigned = useMemo(() => {
    return selectedUsers.reduce((sum, uid) => {
      const val = parseFloat(amounts[uid] || "0");
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
  }, [selectedUsers, amounts]);

  const diff = transaction ? transaction.amount - totalAssigned : 0;
  const isBalanced = Math.abs(diff) < 0.01;
  const percentAssigned = transaction && transaction.amount > 0 ? (totalAssigned / transaction.amount) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Atribuir / Dividir Despesa
          </DialogTitle>
        </DialogHeader>

        {transaction && (
          <div className="space-y-5">
            {/* Transaction info */}
            <div className="rounded-xl bg-muted/40 border border-border p-4">
              <p className="text-sm font-medium truncate text-muted-foreground">{transaction.description}</p>
              <p className="text-2xl font-heading font-bold text-primary mt-1">
                R$ {transaction.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            </div>

            {/* Quick actions */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Atribuição rápida — clique para atribuir tudo a uma pessoa</Label>
              <div className="flex flex-wrap gap-2">
                {profiles?.map((p, idx) => {
                  const colors = userColorMap[p.user_id] || USER_COLORS[0];
                  const isSelected = selectedUsers.length === 1 && selectedUsers[0] === p.user_id && isBalanced;
                  return (
                    <button
                      key={p.user_id}
                      onClick={() => assignToSingle(p.user_id)}
                      className={`
                        inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border transition-all
                        ${isSelected
                          ? `${colors.bg} ${colors.border} ${colors.text} ring-2 ${colors.ring}`
                          : "border-border hover:border-primary/30 hover:bg-muted/50"
                        }
                      `}
                    >
                      <span className={`w-6 h-6 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-[10px] font-bold`}>
                        {getInitials(p.full_name || p.user_id)}
                      </span>
                      <span className="font-medium">{(p.full_name || p.user_id).split(" ")[0]}</span>
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium">ou divida entre vários</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* User list for splitting */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Selecione os usuários</Label>
                <Button variant="outline" size="sm" onClick={splitEvenly} disabled={selectedUsers.length === 0}>
                  <Scissors className="w-3.5 h-3.5 mr-1.5" />
                  Dividir igual
                </Button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {profiles?.map((p) => {
                  const checked = selectedUsers.includes(p.user_id);
                  const colors = userColorMap[p.user_id] || USER_COLORS[0];
                  return (
                    <div
                      key={p.user_id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        checked ? `${colors.bg} ${colors.border}` : "border-border hover:border-muted-foreground/20"
                      }`}
                    >
                      <button
                        onClick={() => toggleUser(p.user_id)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-all ${
                          checked
                            ? `${colors.bg} ${colors.text} ring-2 ${colors.ring}`
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {checked ? <Check className="w-4 h-4" /> : getInitials(p.full_name || p.user_id)}
                      </button>
                      <span className="text-sm flex-1 font-medium">{p.full_name || p.user_id}</span>
                      {checked && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">R$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-28 text-right font-heading font-semibold"
                            placeholder="0,00"
                            value={amounts[p.user_id] || ""}
                            onChange={(e) =>
                              setAmounts((prev) => ({ ...prev, [p.user_id]: e.target.value }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Running total bar */}
            {selectedUsers.length > 0 && (
              <div className="space-y-2">
                {/* Progress bar */}
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isBalanced
                        ? "bg-green-500"
                        : totalAssigned > (transaction?.amount || 0)
                        ? "bg-destructive"
                        : "bg-warning"
                    }`}
                    style={{ width: `${Math.min(percentAssigned, 100)}%` }}
                  />
                </div>
                <div className={`flex items-center justify-between p-3 rounded-xl text-sm ${
                  isBalanced
                    ? "bg-green-500/10 border border-green-500/20"
                    : "bg-warning/10 border border-warning/20"
                }`}>
                  <div className="flex items-center gap-2">
                    {isBalanced ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-warning" />
                    )}
                    <span className="font-medium">
                      Atribuído: R$ {totalAssigned.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-muted-foreground">
                      / R$ {transaction.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {!isBalanced && (
                    <span className="font-heading font-bold text-warning">
                      {diff > 0 ? "Faltam" : "Excede"}: R$ {Math.abs(diff).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
