import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Divide, Trash2 } from "lucide-react";

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
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((u) => u !== userId) : [...prev, userId]
    );
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!transaction) return;

      // Delete existing assignments
      await supabase
        .from("transaction_assignments")
        .delete()
        .eq("transaction_id", transaction.id);

      if (selectedUsers.length === 0) return;

      // Insert new assignments
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

  const totalAssigned = selectedUsers.reduce((sum, uid) => sum + parseFloat(amounts[uid] || "0"), 0);
  const diff = transaction ? transaction.amount - totalAssigned : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Atribuir / Dividir Despesa
          </DialogTitle>
        </DialogHeader>

        {transaction && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium truncate">{transaction.description}</p>
              <p className="text-lg font-heading font-bold text-primary mt-1">
                R$ {transaction.amount.toFixed(2)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Selecione os usuários</Label>
                <Button variant="outline" size="sm" onClick={splitEvenly} disabled={selectedUsers.length === 0}>
                  <Divide className="w-3 h-3 mr-1" />
                  Dividir igual
                </Button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {profiles?.map((p) => {
                  const checked = selectedUsers.includes(p.user_id);
                  return (
                    <div key={p.user_id} className="flex items-center gap-3 p-2 rounded-lg border border-border">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleUser(p.user_id)}
                      />
                      <span className="text-sm flex-1">{p.full_name || p.user_id}</span>
                      {checked && (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-28 text-right"
                          placeholder="0.00"
                          value={amounts[p.user_id] || ""}
                          onChange={(e) => setAmounts((prev) => ({ ...prev, [p.user_id]: e.target.value }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {selectedUsers.length > 0 && (
              <div className={`p-3 rounded-lg text-sm ${Math.abs(diff) < 0.01 ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                Atribuído: R$ {totalAssigned.toFixed(2)} / R$ {transaction.amount.toFixed(2)}
                {Math.abs(diff) >= 0.01 && (
                  <span className="ml-2 font-semibold">
                    (Diferença: R$ {diff.toFixed(2)})
                  </span>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
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
