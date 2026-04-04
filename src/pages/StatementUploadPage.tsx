import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle, AlertCircle, Clock, Brain, Loader2, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Progress } from "@/components/ui/progress";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export default function StatementUploadPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cardId, setCardId] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [progress, setProgress] = useState(0);

  const { data: cards } = useQuery({
    queryKey: ["credit-cards"],
    queryFn: async () => {
      const { data } = await supabase.from("credit_cards").select("*").order("name");
      return data ?? [];
    },
  });

  const { data: statements } = useQuery({
    queryKey: ["statements"],
    queryFn: async () => {
      const { data } = await supabase
        .from("statements")
        .select("*, credit_cards(name)")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !cardId || !month || !year) {
      toast.error("Preencha todos os campos e selecione um arquivo");
      return;
    }
    setUploading(true);
    setProgress(10);
    setProcessingStep("Enviando arquivo...");

    try {
      const filePath = `${cardId}/${year}-${month.padStart(2, "0")}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("statements")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      setProgress(30);
      setProcessingStep("Registrando fatura...");

      // Check if statement already exists for this card/month/year
      const { data: existing } = await supabase
        .from("statements")
        .select("id")
        .eq("card_id", cardId)
        .eq("month", parseInt(month))
        .eq("year", parseInt(year))
        .maybeSingle();

      let statementData: any;

      if (existing) {
        // Delete old transactions and update existing statement
        const { error: delTxError } = await supabase
          .from("transactions")
          .delete()
          .eq("statement_id", existing.id);
        // Note: delete may fail due to RLS, edge function will handle via adminClient

        const { data: updated, error: updateError } = await supabase
          .from("statements")
          .update({
            file_name: file.name,
            status: "pending",
            uploaded_by: user?.id,
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (updateError) throw updateError;
        statementData = updated;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("statements")
          .insert({
            card_id: cardId,
            month: parseInt(month),
            year: parseInt(year),
            file_name: file.name,
            status: "pending",
            uploaded_by: user?.id,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        statementData = inserted;
      }

      setProgress(50);
      setProcessingStep("🤖 IA analisando a fatura...");

      // Call AI parsing
      const { data: parseResult, error: parseError } = await supabase.functions.invoke(
        "parse-statement",
        {
          body: {
            statement_id: statementData.id,
            file_path: filePath,
          },
        }
      );

      if (parseError) {
        throw new Error(parseError.message || "Erro ao processar fatura");
      }

      if (parseResult?.error) {
        throw new Error(parseResult.error);
      }

      setProgress(100);
      setProcessingStep("Concluído!");

      toast.success(
        `Fatura processada! ${parseResult.count} lançamentos importados.`
      );
      queryClient.invalidateQueries({ queryKey: ["statements"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setFile(null);
      setCardId("");
      setMonth("");
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
    setUploading(false);
    setTimeout(() => {
      setProcessingStep("");
      setProgress(0);
    }, 2000);
  };

  const handleDeleteStatement = async (statementId: string) => {
    if (!confirm("Tem certeza que deseja remover esta fatura e todos os seus lançamentos?")) return;

    try {
      // Desvincula/remove transações atreladas à fatura
      await supabase.from("transactions").delete().eq("statement_id", statementId);
      
      // Remove o registro da fatura
      const { error } = await supabase.from("statements").delete().eq("id", statementId);
      if (error) throw error;
      
      toast.success("Fatura removida com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["statements"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err: any) {
      toast.error("Erro ao remover: " + err.message);
    }
  };

  const statusConfig: Record<string, { icon: any; label: string; className: string }> = {
    pending: { icon: Clock, label: "Pendente", className: "bg-warning/10 text-warning" },
    processing: { icon: Clock, label: "Processando", className: "bg-primary/10 text-primary" },
    completed: { icon: CheckCircle, label: "Concluído", className: "bg-success/10 text-success" },
    error: { icon: AlertCircle, label: "Erro", className: "bg-destructive/10 text-destructive" },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Importar Fatura</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Envie faturas em PDF, CSV ou TXT — a IA extrai os lançamentos automaticamente
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card lg:col-span-1">
          <CardHeader>
            <CardTitle className="font-heading text-lg flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              Nova Importação
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-4">
              <div className="space-y-2">
                <Label>Cartão</Label>
                <Select value={cardId} onValueChange={setCardId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cartão" /></SelectTrigger>
                  <SelectContent>
                    {cards?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} (•••• {c.last_four_digits})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ano</Label>
                  <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} min="2020" max="2030" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Arquivo da Fatura</Label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf,.txt,.csv,.xlsx,.xls"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    {file ? (
                      <p className="text-sm font-medium text-foreground">{file.name}</p>
                    ) : (
                      <div>
                        <p className="text-sm text-muted-foreground">Clique para selecionar</p>
                        <p className="text-xs text-muted-foreground mt-1">PDF, CSV, TXT</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {processingStep && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{processingStep}</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              )}

              <Button type="submit" className="w-full" disabled={uploading}>
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Enviar e Processar com IA
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Faturas Importadas</CardTitle>
          </CardHeader>
          <CardContent>
            {statements && statements.length > 0 ? (
              <div className="space-y-3">
                {statements.map((s: any, i: number) => {
                  const config = statusConfig[s.status] || statusConfig.pending;
                  const StatusIcon = config.icon;
                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{s.credit_cards?.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {MONTHS[(s.month - 1)]} {s.year} · {s.file_name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 ${config.className}`}>
                          <StatusIcon className="w-3 h-3" />
                          {config.label}
                        </span>
                        <Button 
                          type="button"
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDeleteStatement(s.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">
                Nenhuma fatura importada ainda
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
