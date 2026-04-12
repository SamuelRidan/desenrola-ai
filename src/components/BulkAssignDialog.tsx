import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, User, Check, Loader2 } from "lucide-react";

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

interface BulkTransaction {
  id: string;
  amount: number;
  description: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: BulkTransaction[];
  onComplete: () => void;
}

export default function BulkAssignDialog({ open, onOpenChange, transactions, onComplete }: Props) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name");
      return (data ?? []) as { user_id: string; full_name: string }[];
    },
  });

  const userColorMap = useMemo(() => {
    const map: Record<string, typeof USER_COLORS[0]> = {};
    (profiles ?? []).forEach((p, i) => {
      map[p.user_id] = USER_COLORS[i % USER_COLORS.length];
    });
    return map;
  }, [profiles]);

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedUserId(null);
    }
  }, [open]);

  const totalAmount = useMemo(() => {
    return transactions.reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || transactions.length === 0) return;

      // Delete existing assignments for all selected transactions
      const txIds = transactions.map((t) => t.id);
      await supabase
        .from("transaction_assignments")
        .delete()
        .in("transaction_id", txIds);

      // Insert new assignments — each transaction gets the full amount assigned to the user
      const rows = transactions.map((t) => ({
        transaction_id: t.id,
        user_id: selectedUserId,
        share_amount: t.amount,
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
      toast.success(`${transactions.length} transações atribuídas com sucesso!`);
      onOpenChange(false);
      onComplete();
    },
    onError: () => toast.error("Erro ao salvar atribuições em lote"),
  });

  const selectedUserName = useMemo(() => {
    if (!selectedUserId || !profiles) return "";
    const profile = profiles.find((p) => p.user_id === selectedUserId);
    return profile?.full_name || "";
  }, [selectedUserId, profiles]);

  const formContent = (
    <div className="space-y-4 md:space-y-5">
      {/* Summary of selected transactions */}
      <div className="rounded-xl bg-muted/40 border border-border p-3 md:p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Transações selecionadas</p>
            <p className="text-xl md:text-2xl font-heading font-bold text-primary mt-1">
              {transactions.length} {transactions.length === 1 ? "transação" : "transações"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Valor total</p>
            <p className="text-lg md:text-xl font-heading font-bold">
              R$ {totalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
        {/* Show first few transaction names */}
        <div className="mt-3 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
          {transactions.slice(0, 8).map((t) => (
            <Badge key={t.id} variant="secondary" className="text-[10px] font-normal max-w-[180px] truncate">
              {t.description}
            </Badge>
          ))}
          {transactions.length > 8 && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              +{transactions.length - 8} mais
            </Badge>
          )}
        </div>
      </div>

      {/* User selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Selecione o responsável</Label>
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {profiles?.map((p) => {
            const isSelected = selectedUserId === p.user_id;
            const colors = userColorMap[p.user_id] || USER_COLORS[0];
            return (
              <button
                key={p.user_id}
                onClick={() => setSelectedUserId(isSelected ? null : p.user_id)}
                className={`
                  w-full flex items-center gap-2.5 md:gap-3 p-3 md:p-3.5 rounded-xl border transition-all active:scale-[0.98]
                  ${isSelected
                    ? `${colors.bg} ${colors.border} ring-2 ${colors.ring}`
                    : "border-border hover:border-primary/30 hover:bg-muted/50"
                  }
                `}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all ${
                  isSelected
                    ? `${colors.bg} ${colors.text}`
                    : "bg-muted text-muted-foreground"
                }`}>
                  {isSelected ? <Check className="w-5 h-5" /> : getInitials(p.full_name || p.user_id)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium truncate">{p.full_name || p.user_id}</p>
                  {isSelected && (
                    <p className={`text-xs ${colors.text} font-medium mt-0.5`}>
                      Receberá {transactions.length} {transactions.length === 1 ? "transação" : "transações"} · R$ {totalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
                {isSelected && (
                  <div className={`shrink-0 w-6 h-6 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center`}>
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Confirmation message */}
      {selectedUserId && (
        <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-3 text-sm">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-600 shrink-0" />
            <span>
              <strong>{transactions.length}</strong> {transactions.length === 1 ? "transação será atribuída" : "transações serão atribuídas"} a{" "}
              <strong>{selectedUserName}</strong>, cada uma com seu valor integral.
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 md:flex-none h-11 md:h-9">
          Cancelar
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!selectedUserId || saveMutation.isPending}
          className="flex-1 md:flex-none h-11 md:h-9"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Users className="w-4 h-4 mr-1.5" />
              Atribuir {transactions.length} {transactions.length === 1 ? "transação" : "transações"}
            </>
          )}
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle className="font-heading flex items-center gap-2 text-base">
              <Users className="w-5 h-5 text-primary" />
              Atribuir em Lote
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            {formContent}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Atribuir em Lote
          </DialogTitle>
        </DialogHeader>
        {formContent}
      </DialogContent>
    </Dialog>
  );
}
