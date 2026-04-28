import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarClock, TrendingUp, User, ChevronDown, ChevronUp, Receipt, Clock } from "lucide-react";

const MONTH_NAMES_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const USER_COLORS = [
  { bg: "bg-violet-500/15", text: "text-violet-600", border: "border-violet-500/25", ring: "ring-violet-500/20", barBg: "bg-violet-500" },
  { bg: "bg-sky-500/15", text: "text-sky-600", border: "border-sky-500/25", ring: "ring-sky-500/20", barBg: "bg-sky-500" },
  { bg: "bg-amber-500/15", text: "text-amber-600", border: "border-amber-500/25", ring: "ring-amber-500/20", barBg: "bg-amber-500" },
  { bg: "bg-rose-500/15", text: "text-rose-600", border: "border-rose-500/25", ring: "ring-rose-500/20", barBg: "bg-rose-500" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600", border: "border-emerald-500/25", ring: "ring-emerald-500/20", barBg: "bg-emerald-500" },
  { bg: "bg-indigo-500/15", text: "text-indigo-600", border: "border-indigo-500/25", ring: "ring-indigo-500/20", barBg: "bg-indigo-500" },
];

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/**
 * Detects installment pattern: "PARC XX/YY" or "Parcela X/Y" ANYWHERE in the description.
 * Also captures fallbacks like "XX/YY" at the end of the string.
 * Examples that MATCH:
 *   "AMAZON PARC 03/12"
 *   "AUTO PECAS TO PARC 02/03 RIO DE JANEI"
 *   "Mp *37551516silva - Parcela 1/10"
 *   "NETFLIX PARCELA 01/03"
 *   "COMPRA PARC 1/4"
 *   "LOJA VIRTUAL 02/05" (fallback at end)
 * Examples that DON'T match:
 *   "COMPRA 15/04" (date DD/MM where DD > MM fails current <= total)
 *   "PAGAMENTO FATURA" (no installment)
 */
export function parseInstallment(description: string): { current: number; total: number; cleanDesc: string } | null {
  // 1. Try to match "PARC", "PARCELA", "Parcela", "PARC." followed by XX/YY or XX DE YY anywhere
  const match = description.match(/^(.*?)\s*[-–]?\s*\bPARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\b(.*)$/i);
  
  if (match) {
    const current = parseInt(match[2], 10);
    const total = parseInt(match[3], 10);
    if (total > 1 && current <= total && current >= 1 && total <= 72) {
      // Clean description: combine prefix and suffix, remove extra spaces
      const cleanDesc = (match[1] + " " + match[4]).replace(/\s+/g, " ").trim() || description;
      return { current, total, cleanDesc };
    }
  }

  // 2. Fallback: match just XX/YY or XX DE YY at the END of the string
  const endMatch = description.match(/^(.*?)\s*[-–]?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\s*$/i);
  if (endMatch) {
    const current = parseInt(endMatch[2], 10);
    const total = parseInt(endMatch[3], 10);
    // If current > total, it's likely a date (e.g. 15/04 = 15th of April). We only accept if current <= total.
    if (total > 1 && current <= total && current >= 1 && total <= 72) {
      const cleanDesc = endMatch[1].trim() || description;
      return { current, total, cleanDesc };
    }
  }

  return null;
}

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface InstallmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: any[];
  profileMap: Record<string, string>;
  statementMonth?: number;
  statementYear?: number;
  userRole?: string;
  currentUserId?: string;
}

interface InstallmentItem {
  txId: string;
  description: string;
  cleanDescription: string;
  currentInstallment: number;
  totalInstallments: number;
  remaining: number;
  monthlyAmount: number;
  totalRemaining: number;
  progressPercent: number;
  userId: string;
  userName: string;
}

export default function InstallmentModal({ open, onOpenChange, transactions, profileMap, statementMonth, statementYear, userRole, currentUserId }: InstallmentModalProps) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [viewOnlyMine, setViewOnlyMine] = useState(false);

  const installmentData = useMemo(() => {
    const empty = { items: [] as InstallmentItem[], byUser: {} as Record<string, InstallmentItem[]>, totalNextMonth: 0, totalRemaining: 0, maxRemainingMonths: 0, projection: [] as { month: string; total: number; byUser: Record<string, number> }[] };
    if (!transactions || transactions.length === 0) return empty;

    const items: InstallmentItem[] = [];

    for (const t of transactions) {
      const desc = t.description || "";
      const parsed = parseInstallment(desc);
      if (!parsed) continue;

      // Filter out payments, but ALLOW last installments (current === total)
      if ((t.type || "purchase") === "payment") continue;
      if (parsed.current > parsed.total) continue; // Invalid if current > total
      
      const amount = Math.abs(Number(t.amount));
      if (amount <= 0) continue;

      const remaining = parsed.total - parsed.current; // 0 for the last installment
      const displayName = t.alias || parsed.cleanDesc;

      const assignments = t.transaction_assignments || [];
      if (assignments.length > 0) {
        for (const a of assignments) {
          const shareAmount = Number(a.share_amount) || 0;
          if (shareAmount <= 0) continue;
          items.push({
            txId: t.id,
            description: desc,
            cleanDescription: displayName,
            currentInstallment: parsed.current,
            totalInstallments: parsed.total,
            remaining,
            monthlyAmount: shareAmount,
            totalRemaining: shareAmount * remaining,
            progressPercent: Math.round((parsed.current / parsed.total) * 100),
            userId: a.user_id,
            userName: profileMap[a.user_id] || "Desconhecido",
          });
        }
      } else {
        items.push({
          txId: t.id,
          description: desc,
          cleanDescription: displayName,
          currentInstallment: parsed.current,
          totalInstallments: parsed.total,
          remaining,
          monthlyAmount: amount,
          totalRemaining: amount * remaining,
          progressPercent: Math.round((parsed.current / parsed.total) * 100),
          userId: "__unassigned__",
          userName: "Sem Atribuição",
        });
      }
    }

    // Aplica filtros de visibilidade
    let filteredItems = items;
    if (userRole !== "admin") {
      // Usuário comum só vê as próprias parcelas
      filteredItems = items.filter(i => i.userId === currentUserId);
    } else if (viewOnlyMine) {
      // Admin ativou o filtro "somente minhas"
      filteredItems = items.filter(i => i.userId === currentUserId);
    }

    if (filteredItems.length === 0) return empty;

    // Group by user
    const byUser: Record<string, InstallmentItem[]> = {};
    for (const item of filteredItems) {
      if (!byUser[item.userId]) byUser[item.userId] = [];
      byUser[item.userId].push(item);
    }
    for (const uid of Object.keys(byUser)) {
      byUser[uid].sort((a, b) => {
        // Ordena pelo maior valor total restante (ideal para liquidação)
        if (b.totalRemaining !== a.totalRemaining) {
          return b.totalRemaining - a.totalRemaining;
        }
        // Desempata pelo maior valor de parcela mensal
        if (b.monthlyAmount !== a.monthlyAmount) {
          return b.monthlyAmount - a.monthlyAmount;
        }
        // Desempata pelo número de meses restantes
        return b.remaining - a.remaining;
      });
    }

    const totalRemaining = filteredItems.reduce((s, i) => s + i.totalRemaining, 0);
    const maxRemainingMonths = Math.max(...filteredItems.map(i => i.remaining));

    // Monthly projection starting from next month
    const baseMonth = statementMonth || (new Date().getMonth() + 1);
    const baseYear = statementYear || new Date().getFullYear();
    const projection: { month: string; total: number; byUser: Record<string, number> }[] = [];

    for (let m = 1; m <= Math.min(maxRemainingMonths, 12); m++) {
      const projMonthIdx = ((baseMonth - 1 + m) % 12);
      const projYear = baseYear + Math.floor((baseMonth - 1 + m) / 12);
      const monthLabel = `${MONTH_NAMES_SHORT[projMonthIdx]}/${projYear}`;
      const entry = { month: monthLabel, total: 0, byUser: {} as Record<string, number> };

      for (const item of filteredItems) {
        if (item.remaining >= m) {
          entry.total += item.monthlyAmount;
          entry.byUser[item.userId] = (entry.byUser[item.userId] || 0) + item.monthlyAmount;
        }
      }
      if (entry.total > 0) projection.push(entry);
    }

    const totalNextMonth = projection[0]?.total || 0;

    return { items: filteredItems, byUser, totalNextMonth, totalRemaining, maxRemainingMonths, projection };
  }, [transactions, profileMap, statementMonth, statementYear, userRole, currentUserId, viewOnlyMine]);

  const { items, byUser, totalNextMonth, totalRemaining, maxRemainingMonths, projection } = installmentData;

  const userIds = Object.keys(byUser).sort((a, b) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    const totalA = byUser[a].reduce((s, i) => s + i.totalRemaining, 0);
    const totalB = byUser[b].reduce((s, i) => s + i.totalRemaining, 0);
    return totalB - totalA;
  });

  const toggleUser = (uid: string) => setExpandedUser(prev => prev === uid ? null : uid);

  // Get reference month label
  const refMonthLabel = statementMonth && statementYear
    ? `${MONTH_NAMES_SHORT[(statementMonth - 1)]}/${statementYear}`
    : "mês atual";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <div className="gradient-primary p-5 sm:p-6">
          <DialogHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 text-left">
              <DialogTitle className="text-white text-lg sm:text-xl font-heading font-bold flex items-center gap-2">
                <div className="p-1.5 rounded-full bg-white/15 backdrop-blur-sm">
                  <CalendarClock className="w-5 h-5 text-white" />
                </div>
                Parcelas em Andamento
              </DialogTitle>
              <DialogDescription className="text-white/70 text-sm mt-1">
                Compromissos parcelados a partir de {refMonthLabel}
              </DialogDescription>
            </div>
            
            {userRole === "admin" && (
              <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-full mt-2 sm:mt-0 self-start">
                <span className="text-xs text-white/90 font-medium">Somente minhas</span>
                <button 
                  onClick={() => setViewOnlyMine(!viewOnlyMine)}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${viewOnlyMine ? 'bg-primary' : 'bg-white/30'}`}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${viewOnlyMine ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            )}
          </DialogHeader>

          {items.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                <p className="text-white/60 text-[10px] sm:text-xs font-medium uppercase tracking-wide">Parcelas Ativas</p>
                <p className="text-xl sm:text-2xl font-heading font-bold text-white mt-0.5">{items.length}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                <p className="text-white/60 text-[10px] sm:text-xs font-medium uppercase tracking-wide">Próx. Mês</p>
                <p className="text-xl sm:text-2xl font-heading font-bold text-white mt-0.5">R$ {formatBRL(totalNextMonth)}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                <p className="text-white/60 text-[10px] sm:text-xs font-medium uppercase tracking-wide">Total Restante</p>
                <p className="text-xl sm:text-2xl font-heading font-bold text-white mt-0.5">R$ {formatBRL(totalRemaining)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {items.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                <Receipt className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm">Nenhuma parcela em andamento nesta fatura.</p>
              <p className="text-muted-foreground/60 text-xs">
                São detectadas transações com o padrão "PARC XX/YY" na descrição.
              </p>
            </div>
          ) : (
            <>
              {/* Per-user accordion */}
              {userIds.map((uid, idx) => {
                const userItems = byUser[uid];
                const userName = userItems[0].userName;
                const userMonthly = userItems.reduce((s, i) => s + i.monthlyAmount, 0);
                const userRemaining = userItems.reduce((s, i) => s + i.totalRemaining, 0);
                const colors = uid === "__unassigned__"
                  ? { bg: "bg-muted", text: "text-muted-foreground", border: "border-muted", ring: "ring-muted", barBg: "bg-muted-foreground" }
                  : USER_COLORS[idx % USER_COLORS.length];
                const isExpanded = expandedUser === uid;

                return (
                  <motion.div
                    key={uid}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <Card className={`shadow-card overflow-hidden border ${isExpanded ? colors.border : "border-border"}`}>
                      <button
                        onClick={() => toggleUser(uid)}
                        className="w-full text-left p-3 sm:p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className={`w-10 h-10 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center text-sm font-bold ring-2 ${colors.ring} shrink-0`}>
                          {uid === "__unassigned__" ? <User className="w-4 h-4" /> : getInitials(userName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{userName}</p>
                          <p className="text-xs text-muted-foreground">
                            {userItems.length} parcela{userItems.length !== 1 ? "s" : ""} · R$ {formatBRL(userMonthly)}/mês
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-base sm:text-lg font-heading font-bold ${colors.text}`}>
                            R$ {formatBRL(userRemaining)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">restante</p>
                        </div>
                        <div className="shrink-0 ml-1">
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-border px-3 sm:px-4 py-3 space-y-3">
                              {userItems.map((item, itemIdx) => (
                                <motion.div
                                  key={`${item.txId}-${itemIdx}`}
                                  initial={{ opacity: 0, x: -8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: itemIdx * 0.04 }}
                                  className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium break-words">{item.cleanDescription}</p>
                                      <div className="flex flex-wrap items-center gap-2 mt-1">
                                        <Badge variant="outline" className="text-[10px] font-normal">
                                          Parcela {item.currentInstallment}/{item.totalInstallments}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                          <Clock className="w-3 h-3" />
                                          +{item.remaining} mês{item.remaining !== 1 ? "es" : ""}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-sm font-semibold">R$ {formatBRL(item.monthlyAmount)}<span className="text-muted-foreground font-normal text-xs">/mês</span></p>
                                      <p className="text-[10px] text-muted-foreground">R$ {formatBRL(item.totalRemaining)} restante</p>
                                    </div>
                                  </div>
                                  {/* Progress bar */}
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>{item.currentInstallment} de {item.totalInstallments} pagas</span>
                                      <span>{item.progressPercent}%</span>
                                    </div>
                                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${item.progressPercent}%` }}
                                        transition={{ duration: 0.6, delay: itemIdx * 0.05 }}
                                        className={`h-full rounded-full ${colors.barBg} opacity-80`}
                                      />
                                    </div>
                                  </div>
                                </motion.div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </Card>
                  </motion.div>
                );
              })}

              {/* Monthly projection */}
              {projection.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                  <Card className="shadow-card">
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                        <p className="text-sm font-medium text-muted-foreground">Projeção — Próximos Meses</p>
                      </div>
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left p-2 font-medium text-muted-foreground">Mês</th>
                              {userIds.filter(u => u !== "__unassigned__").map(uid => (
                                <th key={uid} className="text-right p-2 font-medium text-muted-foreground truncate max-w-[80px]">
                                  {(profileMap[uid] || "").split(" ")[0]}
                                </th>
                              ))}
                              {byUser["__unassigned__"] && (
                                <th className="text-right p-2 font-medium text-muted-foreground">S/ Atrib.</th>
                              )}
                              <th className="text-right p-2 font-semibold text-foreground">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projection.map((row, ri) => (
                              <motion.tr
                                key={row.month}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.35 + ri * 0.04 }}
                                className="border-b border-border/50 last:border-0"
                              >
                                <td className="p-2 font-medium text-muted-foreground whitespace-nowrap">{row.month}</td>
                                {userIds.filter(u => u !== "__unassigned__").map(uid => (
                                  <td key={uid} className="p-2 text-right whitespace-nowrap">
                                    {row.byUser[uid] ? `R$ ${formatBRL(row.byUser[uid])}` : <span className="text-muted-foreground/40">—</span>}
                                  </td>
                                ))}
                                {byUser["__unassigned__"] && (
                                  <td className="p-2 text-right whitespace-nowrap">
                                    {row.byUser["__unassigned__"] ? `R$ ${formatBRL(row.byUser["__unassigned__"])}` : <span className="text-muted-foreground/40">—</span>}
                                  </td>
                                )}
                                <td className="p-2 text-right font-semibold whitespace-nowrap">
                                  R$ {formatBRL(row.total)}
                                </td>
                              </motion.tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
