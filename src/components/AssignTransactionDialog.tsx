import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Scissors, User, Check, AlertTriangle, UserX } from "lucide-react";

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

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
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
  const isMobile = useIsMobile();
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
      let next: string[];
      if (prev.includes(userId)) {
        next = prev.filter((u) => u !== userId);
      } else {
        next = [...prev, userId];
      }
      // Auto-split equally among selected users
      if (transaction && next.length > 0) {
        const share = (Math.abs(transaction.amount) / next.length).toFixed(2);
        const newAmounts: Record<string, string> = {};
        next.forEach((uid) => {
          newAmounts[uid] = share;
        });
        setAmounts(newAmounts);
      } else {
        setAmounts({});
      }
      return next;
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

  const clearAll = () => {
    setSelectedUsers([]);
    setAmounts({});
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

  const totalAssigned = useMemo(() => {
    return selectedUsers.reduce((sum, uid) => {
      const val = parseFloat(amounts[uid] || "0");
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
  }, [selectedUsers, amounts]);

  const diff = transaction ? transaction.amount - totalAssigned : 0;
  const isBalanced = Math.abs(diff) < 0.01;
  const percentAssigned = transaction && transaction.amount > 0 ? (totalAssigned / transaction.amount) * 100 : 0;

  // Shared form content used by both Dialog and Drawer
  const formContent = transaction ? (
    <div className="space-y-4 md:space-y-5">
      {/* Transaction info */}
      <div className="rounded-xl bg-muted/40 border border-border p-3 md:p-4">
        <p className="text-sm font-medium truncate text-muted-foreground">{transaction.description}</p>
        <p className="text-xl md:text-2xl font-heading font-bold text-primary mt-1">
          R$ {transaction.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </p>
      </div>

      {/* Quick actions */}
      <div className="space-y-2">
        <Label className="text-xs md:text-sm font-medium text-muted-foreground">Atribuir tudo a uma pessoa</Label>
        <div className="flex flex-wrap gap-2">
          {/* Ninguém option */}
          <button
            onClick={clearAll}
            className={`
              inline-flex items-center gap-1.5 md:gap-2 rounded-full px-2.5 md:px-3 py-1.5 md:py-1.5 text-sm border transition-all active:scale-95
              ${selectedUsers.length === 0
                ? "bg-zinc-500/15 border-zinc-500/25 text-zinc-600 ring-2 ring-zinc-500/20"
                : "border-border hover:border-primary/30 hover:bg-muted/50 active:bg-muted"
              }
            `}
          >
            <span className="w-6 h-6 rounded-full bg-zinc-500/15 text-zinc-600 flex items-center justify-center">
              <UserX className="w-3.5 h-3.5" />
            </span>
            <span className="font-medium">Ninguém</span>
            {selectedUsers.length === 0 && <Check className="w-3.5 h-3.5" />}
          </button>
          {profiles?.map((p) => {
            const colors = userColorMap[p.user_id] || USER_COLORS[0];
            const isSelected = selectedUsers.length === 1 && selectedUsers[0] === p.user_id && isBalanced;
            return (
              <button
                key={p.user_id}
                onClick={() => assignToSingle(p.user_id)}
                className={`
                  inline-flex items-center gap-1.5 md:gap-2 rounded-full px-2.5 md:px-3 py-1.5 md:py-1.5 text-sm border transition-all active:scale-95
                  ${isSelected
                    ? `${colors.bg} ${colors.border} ${colors.text} ring-2 ${colors.ring}`
                    : "border-border hover:border-primary/30 hover:bg-muted/50 active:bg-muted"
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
        <span className="text-[10px] md:text-xs text-muted-foreground font-medium">ou divida entre vários</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* User list for splitting */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Selecione os usuários</Label>
          <Button variant="outline" size="sm" onClick={splitEvenly} disabled={selectedUsers.length === 0} className="h-8 md:h-8 text-xs">
            <Scissors className="w-3.5 h-3.5 mr-1.5" />
            Dividir igual
          </Button>
        </div>

        <div className="space-y-2 max-h-48 md:max-h-60 overflow-y-auto pr-1">
          {profiles?.map((p) => {
            const checked = selectedUsers.includes(p.user_id);
            const colors = userColorMap[p.user_id] || USER_COLORS[0];
            return (
              <div
                key={p.user_id}
                className={`flex items-center gap-2.5 md:gap-3 p-2.5 md:p-3 rounded-xl border transition-all ${
                  checked ? `${colors.bg} ${colors.border}` : "border-border"
                }`}
              >
                <button
                  onClick={() => toggleUser(p.user_id)}
                  className={`w-9 h-9 md:w-9 md:h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-all active:scale-90 ${
                    checked
                      ? `${colors.bg} ${colors.text} ring-2 ${colors.ring}`
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {checked ? <Check className="w-4 h-4" /> : getInitials(p.full_name || p.user_id)}
                </button>
                <span className="text-sm flex-1 font-medium truncate">{p.full_name || p.user_id}</span>
                {checked && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">R$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      className="w-24 md:w-28 text-right font-heading font-semibold h-9"
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
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2.5 md:p-3 rounded-xl text-sm ${
            isBalanced
              ? "bg-green-500/10 border border-green-500/20"
              : "bg-warning/10 border border-warning/20"
          }`}>
            <div className="flex items-center gap-2">
              {isBalanced ? (
                <Check className="w-4 h-4 text-green-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              )}
              <span className="font-medium text-xs md:text-sm">
                R$ {totalAssigned.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                <span className="text-muted-foreground"> / R$ {transaction.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
              </span>
            </div>
            {!isBalanced && (
              <span className="font-heading font-bold text-warning text-xs md:text-sm">
                {diff > 0 ? "Faltam" : "Excede"}: R$ {Math.abs(diff).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 md:flex-none h-11 md:h-9">
          Cancelar
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1 md:flex-none h-11 md:h-9">
          Salvar
        </Button>
      </div>
    </div>
  ) : null;

  // Mobile: Bottom Sheet (Drawer)
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle className="font-heading flex items-center gap-2 text-base">
              <Users className="w-5 h-5 text-primary" />
              Atribuir / Dividir Despesa
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            {formContent}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: Dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Atribuir / Dividir Despesa
          </DialogTitle>
        </DialogHeader>
        {formContent}
      </DialogContent>
    </Dialog>
  );
}
