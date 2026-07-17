import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { History, CheckCircle, AlertCircle, Loader2, User, CreditCard, Calendar, FileText, Tag } from "lucide-react";
import { parseInstallment } from "@/components/InstallmentModal";

interface RecoverAliasModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    description: string;
    statement_id: string;
    amount: number;
  } | null;
  profileMap: Record<string, string>;
}

interface FoundAlias {
  alias: string | null;
  description: string;
  statementMonth: number;
  statementYear: number;
  cardName: string;
  assignedUsers: { name: string; userId: string; shareAmount: number }[];
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const USER_COLORS = [
  { bg: "bg-violet-500/15", text: "text-violet-600", border: "border-violet-500/25" },
  { bg: "bg-sky-500/15", text: "text-sky-600", border: "border-sky-500/25" },
  { bg: "bg-amber-500/15", text: "text-amber-600", border: "border-amber-500/25" },
  { bg: "bg-rose-500/15", text: "text-rose-600", border: "border-rose-500/25" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600", border: "border-emerald-500/25" },
  { bg: "bg-indigo-500/15", text: "text-indigo-600", border: "border-indigo-500/25" },
];

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function RecoverAliasModal({ open, onOpenChange, transaction, profileMap }: RecoverAliasModalProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [found, setFound] = useState<FoundAlias | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [debugInfo, setDebugInfo] = useState("");

  const extractResult = (match: any): FoundAlias => {
    const assignedUsers = (match.transaction_assignments || []).map((a: any) => ({
      userId: a.user_id,
      name: profileMap[a.user_id] || "Desconhecido",
      shareAmount: Number(a.share_amount || 0),
    }));
    return {
      alias: match.alias,
      description: match.description,
      statementMonth: match.statements?.month || 0,
      statementYear: match.statements?.year || 0,
      cardName: match.statements?.credit_cards?.name || "—",
      assignedUsers,
    };
  };

  // Search for alias when modal opens
  useEffect(() => {
    if (!open || !transaction) {
      setFound(null);
      setNotFound(false);
      setDebugInfo("");
      return;
    }

    const searchAlias = async () => {
      setLoading(true);
      setFound(null);
      setNotFound(false);
      setDebugInfo("");

      const logs: string[] = [];
      const log = (msg: string) => {
        console.log(`[RecoverAlias] ${msg}`);
        logs.push(msg);
      };

      try {
        const parsed = parseInstallment(transaction.description);
        log(`Descrição: "${transaction.description}"`);
        log(`Valor: R$ ${Math.abs(transaction.amount).toFixed(2)}`);

        if (!parsed) {
          log("❌ Não é parcelamento");
          setNotFound(true);
          setDebugInfo(logs.join("\n"));
          setLoading(false);
          return;
        }

        log(`Parcela: ${parsed.current}/${parsed.total}, base: "${parsed.cleanDesc}"`);

        const txAmount = Math.abs(transaction.amount);
        const selectFields = "id, description, alias, amount, statement_id, statements(month, year, credit_cards(name)), transaction_assignments(user_id, share_amount)";

        // Extract a short base name for ilike search (first meaningful word/prefix)
        // e.g. "SilvanaRodrig RIO DE JANEI" → "SilvanaRodrig"
        // e.g. "DaviBladoPlat CAMPINAS" → "DaviBladoPlat"
        const cleanBase = parsed.cleanDesc;
        const shortBase = cleanBase.split(/\s+/)[0]; // First word of the base
        const searchPattern = shortBase && shortBase.length >= 5 ? shortBase : cleanBase;

        log(`Busca por: "${searchPattern}%"`);

        // Fetch ALL candidates matching the base name (from other statements)
        // Include transactions with or without alias — we also want assignment info
        const { data: candidates, error: fetchErr } = await supabase
          .from("transactions")
          .select(selectFields)
          .neq("statement_id", transaction.statement_id)
          .ilike("description", `${searchPattern}%`)
          .order("created_at", { ascending: false })
          .limit(50);

        if (fetchErr) {
          log(`Erro na busca: ${fetchErr.message}`);
          setNotFound(true);
          setDebugInfo(logs.join("\n"));
          setLoading(false);
          return;
        }

        log(`Candidatos encontrados: ${candidates?.length || 0}`);

        if (!candidates || candidates.length === 0) {
          log("❌ Nenhuma parcela anterior encontrada em outras faturas.");
          setNotFound(true);
          setDebugInfo(logs.join("\n"));
          setLoading(false);
          return;
        }

        // Score each candidate based on how well it matches
        // Key matching criteria:
        // 1. Total installments must match (e.g., /10 == /10) — most important
        // 2. Amount must be similar (±R$1.00)
        // 3. Previous installment number (current - 1) is a bonus
        const scored = candidates.map((c: any) => {
          const cParsed = parseInstallment(c.description || "");
          const cAmount = Math.abs(Number(c.amount));
          let score = 0;

          if (cParsed) {
            // Total installments match — critical differentiator (e.g., /10 vs /12)
            if (cParsed.total === parsed.total) {
              score += 100;
              log(`  ✓ "${c.description}" total match: /${cParsed.total}`);
            }
            // Previous installment number bonus
            if (cParsed.current === parsed.current - 1 && cParsed.total === parsed.total) {
              score += 50;
            }
          }

          // Amount similarity (within R$1.00 tolerance)
          const amountDiff = Math.abs(cAmount - txAmount);
          if (amountDiff < 0.05) {
            score += 80; // Near exact match
          } else if (amountDiff < 1.00) {
            score += 60; // Close match (small rounding differences)
          } else if (amountDiff < 5.00) {
            score += 20; // Rough match
          }

          // Bonus for having alias set
          if (c.alias) {
            score += 30;
          }

          // Bonus for having assignments
          if (c.transaction_assignments && c.transaction_assignments.length > 0) {
            score += 10;
          }

          return { ...c, score, cParsed, amountDiff };
        });

        // Sort by score descending
        scored.sort((a: any, b: any) => b.score - a.score);

        log("--- Ranking de candidatos ---");
        scored.slice(0, 8).forEach((c: any, i: number) => {
          const parcInfo = c.cParsed ? `${c.cParsed.current}/${c.cParsed.total}` : "?";
          const aliasInfo = c.alias ? `"${c.alias}"` : "(sem apelido)";
          const assignInfo = c.transaction_assignments?.length ? `${c.transaction_assignments.length} atrib.` : "sem atrib.";
          log(`  #${i + 1} score=${c.score} | ${aliasInfo} | ${assignInfo} | ${parcInfo} | R$ ${c.amount} (diff=${c.amountDiff.toFixed(2)}) | "${c.description}"`);
        });

        // Pick the best match (must have a minimum score to be considered valid)
        const best = scored[0];
        if (best && best.score >= 80) {
          const info = best.alias ? `apelido "${best.alias}"` : "sem apelido, mas com info de atribuição";
          log(`✅ Melhor match: ${info} (score ${best.score})`);
          setFound(extractResult(best));
          setDebugInfo(logs.join("\n"));
          setLoading(false);
          return;
        }

        // If best score is low, still try but warn
        if (best && best.score > 0) {
          const info = best.alias ? `apelido "${best.alias}"` : "sem apelido";
          log(`⚠️ Match de baixa confiança: ${info} (score ${best.score})`);
          setFound(extractResult(best));
          setDebugInfo(logs.join("\n"));
          setLoading(false);
          return;
        }

        log("❌ Nenhum match adequado encontrado.");
        setNotFound(true);
        setDebugInfo(logs.join("\n"));
      } catch (err) {
        console.error("Error searching alias:", err);
        log(`❌ Erro: ${err}`);
        setNotFound(true);
        setDebugInfo(logs.join("\n"));
      }

      setLoading(false);
    };

    searchAlias();
  }, [open, transaction, profileMap]);

  const handleApply = async () => {
    if (!transaction || !found) return;

    setApplying(true);
    try {
      // 1. Update Alias (if any)
      if (found.alias) {
        const { error } = await supabase
          .from("transactions")
          .update({ alias: found.alias })
          .eq("id", transaction.id);

        if (error) throw error;
      }

      // 2. Update User Assignments (if any)
      if (found.assignedUsers && found.assignedUsers.length > 0) {
        // Delete current assignments first
        const { error: deleteErr } = await supabase
          .from("transaction_assignments")
          .delete()
          .eq("transaction_id", transaction.id);

        if (deleteErr) throw deleteErr;

        // Calculate and scale shares proportionally
        const prevTotal = found.assignedUsers.reduce((sum, u) => sum + u.shareAmount, 0);
        const currentTotal = Math.abs(transaction.amount);

        const rows = found.assignedUsers.map((u, idx) => {
          let share = u.shareAmount;
          if (prevTotal > 0 && Math.abs(prevTotal - currentTotal) > 0.05) {
            share = (u.shareAmount / prevTotal) * currentTotal;
          }

          // Adjust last item to prevent rounding gaps
          if (idx === found.assignedUsers.length - 1) {
            const sumOthers = found.assignedUsers.slice(0, idx).reduce((sum, otherU) => {
              let s = otherU.shareAmount;
              if (prevTotal > 0 && Math.abs(prevTotal - currentTotal) > 0.05) {
                s = (otherU.shareAmount / prevTotal) * currentTotal;
              }
              return sum + parseFloat(s.toFixed(2));
            }, 0);
            share = currentTotal - sumOthers;
          }

          return {
            transaction_id: transaction.id,
            user_id: u.userId,
            share_amount: parseFloat(share.toFixed(2)),
          };
        });

        const { error: insertErr } = await supabase
          .from("transaction_assignments")
          .insert(rows);

        if (insertErr) throw insertErr;
      }

      toast.success("Histórico aplicado com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["monthly-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expense-split"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao aplicar histórico: " + err.message);
    }
    setApplying(false);
  };

  const parsed = transaction ? parseInstallment(transaction.description) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="gradient-primary p-5 shrink-0">
          <DialogHeader>
            <DialogTitle className="text-white text-lg font-heading font-bold flex items-center gap-2">
              <div className="p-1.5 rounded-full bg-white/15 backdrop-blur-sm">
                <History className="w-5 h-5 text-white" />
              </div>
              Recuperar Histórico
            </DialogTitle>
            <DialogDescription className="text-white/70 text-sm mt-1">
              Busca apelido e atribuições em faturas anteriores para este parcelamento
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Current transaction info */}
          {transaction && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lançamento Atual</p>
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-sm font-medium break-words">{transaction.description}</p>
              </div>
              <div className="flex justify-between items-center ml-6 mt-1">
                {parsed && (
                  <p className="text-xs text-muted-foreground">
                    Parcela {parsed.current}/{parsed.total}
                  </p>
                )}
                <p className="text-sm font-bold text-foreground">
                  R$ {Math.abs(transaction.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-8 space-y-3"
            >
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Buscando em faturas anteriores...</p>
            </motion.div>
          )}

          {/* Not found state */}
          {notFound && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-8 space-y-3"
            >
              <div className="p-3 rounded-full bg-muted">
                <AlertCircle className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Nenhum apelido ou histórico encontrado em faturas anteriores para este lançamento.
              </p>
            </motion.div>
          )}

          {/* Found result */}
          {found && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              {/* Found info card */}
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-xs font-medium text-primary uppercase tracking-wide">Informações da Fatura Anterior</p>

                {/* Alias (only if present) */}
                {found.alias ? (
                  <div className="flex items-start gap-2">
                    <Tag className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Apelido</p>
                      <p className="text-base font-bold text-primary break-words">{found.alias}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <Tag className="w-4 h-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Apelido</p>
                      <p className="text-xs text-muted-foreground italic">Sem apelido na fatura anterior</p>
                    </div>
                  </div>
                )}

                {/* Original description from previous invoice */}
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Descrição na fatura anterior</p>
                    <p className="text-sm text-foreground break-words">{found.description}</p>
                  </div>
                </div>

                {/* Source statement */}
                <div className="flex items-start gap-2">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Origem</p>
                    <p className="text-sm text-foreground">
                      {found.cardName} · {found.statementMonth > 0 ? MONTH_NAMES[found.statementMonth - 1] : "—"}/{found.statementYear}
                    </p>
                  </div>
                </div>

                {/* Assigned users */}
                {found.assignedUsers.length > 0 && (
                  <div className="flex items-start gap-2">
                    <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Atribuído a</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {found.assignedUsers.map((u, idx) => {
                          const colors = USER_COLORS[idx % USER_COLORS.length];
                          return (
                            <div
                              key={u.userId}
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${colors.bg} ${colors.border} border`}
                            >
                              <span className={`w-5 h-5 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-[10px] font-bold`}>
                                {getInitials(u.name)}
                              </span>
                              <span className="font-medium">{u.name.split(" ")[0]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {found.assignedUsers.length === 0 && (
                  <div className="flex items-start gap-2">
                    <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Atribuído a</p>
                      <p className="text-xs text-muted-foreground italic mt-0.5">Sem atribuição na fatura anterior</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => onOpenChange(false)}
                  disabled={applying}
                >
                  Cancelar
                </Button>
                {found.alias || found.assignedUsers.length > 0 ? (
                  <Button
                    className="flex-1"
                    onClick={handleApply}
                    disabled={applying}
                  >
                    {applying ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Aplicando...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Aplicar Histórico
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => onOpenChange(false)}
                  >
                    Fechar
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {/* Close button for not-found state */}
          {notFound && !loading && (
            <div className="flex justify-end pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
