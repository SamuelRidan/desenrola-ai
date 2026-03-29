import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Tag, Trash2, Edit, Search } from "lucide-react";
import { motion } from "framer-motion";

export default function AliasesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState("");
  const [alias, setAlias] = useState("");
  const [search, setSearch] = useState("");

  const { data: aliases, isLoading } = useQuery({
    queryKey: ["aliases", search],
    queryFn: async () => {
      let query = supabase.from("transaction_aliases").select("*").order("created_at", { ascending: false });
      if (search.trim()) {
        query = query.or(`original_description.ilike.%${search}%,alias.ilike.%${search}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const createAlias = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("transaction_aliases").insert({
        original_description: original,
        alias,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aliases"] });
      toast.success("Apelido criado com sucesso!");
      setOpen(false);
      setOriginal("");
      setAlias("");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const deleteAlias = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transaction_aliases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aliases"] });
      toast.success("Apelido removido");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Apelidos de Transações</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crie apelidos para identificar transações recorrentes
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Novo Apelido</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">Criar Apelido</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createAlias.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Descrição Original</Label>
                <Input
                  placeholder="Ex: PAG*JoseDaSilva"
                  value={original}
                  onChange={(e) => setOriginal(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Apelido</Label>
                <Input
                  placeholder="Ex: Almoço - José"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={createAlias.isPending}>
                {createAlias.isPending ? "Salvando..." : "Criar Apelido"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar apelidos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {aliases && aliases.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {aliases.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card className="shadow-card hover:shadow-elevated transition-shadow group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Tag className="w-4 h-4 text-accent-foreground" />
                      </div>
                      <div>
                        <p className="font-heading font-semibold text-sm">{a.alias}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 break-all">
                          {a.original_description}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive h-8 w-8"
                      onClick={() => deleteAlias.mutate(a.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-8 text-center">
            <Tag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nenhum apelido cadastrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Apelidos ajudam a identificar transações recorrentes
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
