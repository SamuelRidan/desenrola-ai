import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";

const CATEGORIES = [
  "Alimentação", "Transporte", "Compras", "Saúde",
  "Lazer", "Serviços", "Educação", "Moradia", "Juros/Encargos", "Pagamento", "Outros"
];

const TYPES = [
  { value: "purchase", label: "Compra" },
  { value: "payment", label: "Pagamento" },
  { value: "interest", label: "Juros / Encargos" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statementId: string;
}

export default function AddTransactionDialog({ open, onOpenChange, statementId }: Props) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("purchase");

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!date || !description || !amount) throw new Error("Preencha todos os campos obrigatórios");
      const { error } = await supabase.from("transactions").insert({
        statement_id: statementId,
        date,
        description: description.trim(),
        amount: Math.abs(parseFloat(amount)),
        category: category || null,
        is_reviewed: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Lançamento adicionado!");
      setDate("");
      setDescription("");
      setAmount("");
      setCategory("");
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao adicionar"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            Adicionar Lançamento Manual
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Data *</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Descrição *</Label>
            <Input placeholder="Ex: RESTAURANTE XYZ" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valor (R$) *</Label>
              <Input type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !date || !description || !amount}>
              Adicionar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
