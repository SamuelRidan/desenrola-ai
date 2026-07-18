import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Receipt, TrendingUp, CreditCard, Calendar, BarChart3, 
  CalendarClock, Wallet, Clock, User, ChevronDown, 
  ChevronUp, ArrowUpRight, ShieldAlert, Tag, HelpCircle, Users
} from "lucide-react";
import { parseInstallment } from "@/components/InstallmentModal";

const MONTH_NAMES_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_NAMES_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const USER_COLORS = [
  { bg: "bg-violet-500/15", text: "text-violet-600", border: "border-violet-500/25", ring: "ring-violet-500/20" },
  { bg: "bg-sky-500/15", text: "text-sky-600", border: "border-sky-500/25", ring: "ring-sky-500/20" },
  { bg: "bg-amber-500/15", text: "text-amber-600", border: "border-amber-500/25", ring: "ring-amber-500/20" },
  { bg: "bg-rose-500/15", text: "text-rose-600", border: "border-rose-500/25", ring: "ring-rose-500/20" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600", border: "border-emerald-500/25", ring: "ring-emerald-500/20" },
];

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ProjectedInstallment {
  description: string;
  cleanDescription: string;
  current: number;
  total: number;
  monthlyAmount: number;
  remainingInstallments: number;
  totalRemaining: number;
  cardName: string;
  userId: string;
  userName: string;
}

export default function UserDashboard() {
  const { profile, user, role } = useAuth();
  const [selectedProjMonth, setSelectedProjMonth] = useState<string | null>(null);
  
  // State for user selection (admins only)
  const isAdmin = role === "admin";
  const [selectedUserId, setSelectedUserId] = useState<string>("all");

  // Fetch users/profiles list (admins only)
  const { data: profiles = [] } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, full_name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAdmin,
  });

  // Create a profile map for easily looking up names by user_id
  const profileMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (profiles) {
      profiles.forEach(p => {
        map[p.user_id] = p.full_name;
      });
    }
    // Make sure current user profile is in the map too
    if (user && profile) {
      map[user.id] = profile.full_name;
    }
    return map;
  }, [profiles, user, profile]);

  // Fetch all assignments based on selected user filter
  const { data: allAssignments, isLoading } = useQuery({
    queryKey: ["user-cockpit-data", user?.id, selectedUserId],
    queryFn: async () => {
      if (!user) return [];
      
      let query = supabase
        .from("transaction_assignments")
        .select(`
          id,
          share_amount,
          user_id,
          transactions (
            id,
            description,
            date,
            amount,
            alias,
            type,
            category,
            statement_id,
            statements (
              id,
              month,
              year,
              credit_cards (
                name
              )
            )
          )
        `);

      // Filter by selected user if not 'all' (consolidated)
      // Normal users can only fetch their own assignments
      if (!isAdmin) {
        query = query.eq("user_id", user.id);
      } else if (selectedUserId !== "all") {
        query = query.eq("user_id", selectedUserId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // Calculate cockpit statistics and projections
  const stats = useMemo(() => {
    const defaultStats = {
      totalSpentHistoric: 0,
      currentMonthSpent: 0,
      activeInstallments: [] as ProjectedInstallment[],
      projection: [] as { monthLabel: string; total: number; items: ProjectedInstallment[] }[],
      totalCommitted: 0,
      byCard: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      currentMonthLabel: "",
    };

    if (!allAssignments || allAssignments.length === 0) return defaultStats;

    const now = new Date();
    const currentMonthNum = now.getMonth() + 1;
    const currentYearNum = now.getFullYear();
    const currentMonthLabel = `${MONTH_NAMES_SHORT[currentMonthNum - 1]}/${currentYearNum}`;

    let totalSpentHistoric = 0;
    let currentMonthSpent = 0;
    const activeInstallments: ProjectedInstallment[] = [];
    const cardMap: Record<string, number> = {};
    const categoryMap: Record<string, number> = {};

    // Get current/latest active statement reference info to base future projection on
    let refMonth = currentMonthNum;
    let refYear = currentYearNum;

    // Find the latest statement referenced in the user's transactions
    allAssignments.forEach((a: any) => {
      const s = a.transactions?.statements;
      if (s) {
        if (s.year > refYear || (s.year === refYear && s.month > refMonth)) {
          refMonth = s.month;
          refYear = s.year;
        }
      }
    });

    allAssignments.forEach((a: any) => {
      const tx = a.transactions;
      if (!tx) return;

      const shareAmount = Number(a.share_amount) || 0;
      totalSpentHistoric += shareAmount;

      // Group by card
      const cardName = tx.statements?.credit_cards?.name || "Outros";
      cardMap[cardName] = (cardMap[cardName] || 0) + shareAmount;

      // Group by category
      const category = tx.category || "Sem Categoria";
      categoryMap[category] = (categoryMap[category] || 0) + shareAmount;

      // Current month calculation
      const stmt = tx.statements;
      if (stmt && stmt.month === currentMonthNum && stmt.year === currentYearNum) {
        currentMonthSpent += shareAmount;
      }

      // Check if installment
      const parsed = parseInstallment(tx.description);
      if (parsed && tx.type !== "payment") {
        const remaining = parsed.total - parsed.current;
        if (remaining >= 0) {
          activeInstallments.push({
            description: tx.description,
            cleanDescription: tx.alias || parsed.cleanDesc,
            current: parsed.current,
            total: parsed.total,
            monthlyAmount: shareAmount,
            remainingInstallments: remaining,
            totalRemaining: shareAmount * remaining,
            cardName,
            userId: a.user_id,
            userName: profileMap[a.user_id] || "Desconhecido",
          });
        }
      }
    });

    // Generate monthly projection starting from next month of refMonth/refYear
    const projection: { monthLabel: string; total: number; items: ProjectedInstallment[] }[] = [];
    const maxFutureMonths = Math.max(...activeInstallments.map(i => i.remainingInstallments), 0);

    for (let m = 1; m <= Math.min(maxFutureMonths, 12); m++) {
      const projMonthIdx = ((refMonth - 1 + m) % 12);
      const projYear = refYear + Math.floor((refMonth - 1 + m) / 12);
      const monthLabel = `${MONTH_NAMES_SHORT[projMonthIdx]}/${projYear}`;

      const monthEntry = {
        monthLabel,
        total: 0,
        items: [] as ProjectedInstallment[],
      };

      activeInstallments.forEach((item) => {
        if (item.remainingInstallments >= m) {
          monthEntry.total += item.monthlyAmount;
          // Project the installment info for that month
          monthEntry.items.push({
            ...item,
            current: item.current + m,
          });
        }
      });

      if (monthEntry.total > 0) {
        projection.push(monthEntry);
      }
    }

    const totalCommitted = activeInstallments.reduce((sum, item) => sum + item.totalRemaining, 0);

    return {
      totalSpentHistoric,
      currentMonthSpent,
      activeInstallments,
      projection,
      totalCommitted,
      byCard: cardMap,
      byCategory: categoryMap,
      currentMonthLabel,
    };
  }, [allAssignments, profileMap]);

  const {
    currentMonthSpent,
    projection,
    totalCommitted,
    byCard,
    byCategory,
    currentMonthLabel,
    activeInstallments
  } = stats;

  const monthlyAverage = useMemo(() => {
    if (projection.length === 0) return currentMonthSpent;
    const projSum = projection.reduce((sum, item) => sum + item.total, 0);
    return (projSum + currentMonthSpent) / (projection.length + 1);
  }, [projection, currentMonthSpent]);

  // Selected month detail items
  const selectedMonthDetails = useMemo(() => {
    if (!selectedProjMonth) return null;
    return projection.find(p => p.monthLabel === selectedProjMonth) || null;
  }, [selectedProjMonth, projection]);

  const maxProjectionValue = useMemo(() => {
    const values = projection.map(p => p.total);
    if (values.length === 0) return 1;
    return Math.max(...values, currentMonthSpent);
  }, [projection, currentMonthSpent]);

  function getInitials(name: string) {
    return name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground">
            Olá, {profile?.full_name?.split(" ")[0] || "Usuário"} 👋
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isAdmin ? "Painel consolidado e gerenciamento de cockpit de despesas." : "Bem-vindo ao seu cockpit de despesas e planejamento financeiro."}
          </p>
        </div>

        {/* User Selector for Admins */}
        {isAdmin && (
          <div className="flex items-center gap-2 bg-card border rounded-xl p-2.5 shadow-sm shrink-0">
            <Users className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground hidden sm:inline">Visualizar:</span>
            <Select value={selectedUserId} onValueChange={(val) => { setSelectedUserId(val); setSelectedProjMonth(null); }}>
              <SelectTrigger className="w-[180px] sm:w-[220px] h-8 text-xs font-medium border-0 focus:ring-0">
                <SelectValue placeholder="Selecione um usuário" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-semibold">Consolidado (Todos)</SelectItem>
                {profiles.map(p => (
                  <SelectItem key={p.user_id} value={p.user_id} className="text-xs">
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Carregando painel de consumo...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 1: KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <Card className="relative overflow-hidden border-0 shadow-elevated bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-white/80 text-xs font-medium uppercase tracking-wide">Fatura Atual ({currentMonthLabel})</p>
                    <p className="text-2xl sm:text-3xl font-heading font-bold">
                      R$ {formatBRL(currentMonthSpent)}
                    </p>
                    <p className="text-white/60 text-[10px]">
                      {selectedUserId === "all" ? "Total de todos os usuários neste mês" : "Atribuído a este usuário neste mês"}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/10 backdrop-blur-md">
                    <Wallet className="w-6 h-6 text-white" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="relative overflow-hidden border-0 shadow-elevated bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-white/80 text-xs font-medium uppercase tracking-wide">Total Comprometido</p>
                    <p className="text-2xl sm:text-3xl font-heading font-bold">
                      R$ {formatBRL(totalCommitted)}
                    </p>
                    <p className="text-white/60 text-[10px]">Soma de todas as parcelas futuras</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/10 backdrop-blur-md">
                    <CalendarClock className="w-6 h-6 text-white" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <Card className="relative overflow-hidden border border-border shadow-card bg-card">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Média de Gastos</p>
                    <p className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
                      R$ {formatBRL(monthlyAverage)}
                    </p>
                    <p className="text-muted-foreground text-[10px]">Baseada nas faturas e projeções</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted">
                    <TrendingUp className="w-6 h-6 text-primary" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Section 2: Projeção de Gastos (Futuras Parcelas) */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="shadow-card">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 gap-2">
                <div>
                  <CardTitle className="font-heading text-lg flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" />
                    Projeção de Parcelas Futuras
                  </CardTitle>
                  <CardDescription>
                    Monitore o peso das compras já parceladas nos próximos meses
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="w-fit text-xs font-normal">
                  {projection.length} meses projetados
                </Badge>
              </CardHeader>
              <CardContent className="space-y-6">
                {projection.length > 0 ? (
                  <>
                    {/* Bar timeline chart */}
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-3 pt-2">
                      {/* Current Month reference bar */}
                      <div 
                        onClick={() => setSelectedProjMonth(null)}
                        className={`flex flex-col items-center justify-end h-[160px] pb-1 rounded-xl cursor-pointer transition-all ${
                          selectedProjMonth === null 
                            ? "bg-primary/10 ring-1 ring-primary/30" 
                            : "hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex-1 w-full flex items-end justify-center px-1">
                          <div 
                            className="w-4 sm:w-6 bg-indigo-500 rounded-t-md transition-all duration-500" 
                            style={{ height: `${(currentMonthSpent / maxProjectionValue) * 100}%` }}
                          />
                        </div>
                        <p className="text-[10px] font-bold text-foreground mt-2">{currentMonthLabel}</p>
                        <p className="text-[9px] text-muted-foreground font-semibold">R$ {Math.round(currentMonthSpent)}</p>
                      </div>

                      {/* Projected future bars */}
                      {projection.slice(0, 11).map((p, idx) => {
                        const isSelected = selectedProjMonth === p.monthLabel;
                        const heightPercent = (p.total / maxProjectionValue) * 100;
                        return (
                          <div
                            key={p.monthLabel}
                            onClick={() => setSelectedProjMonth(isSelected ? null : p.monthLabel)}
                            className={`flex flex-col items-center justify-end h-[160px] pb-1 rounded-xl cursor-pointer transition-all ${
                              isSelected 
                                ? "bg-primary/10 ring-1 ring-primary/30" 
                                : "hover:bg-muted/40"
                            }`}
                          >
                            <div className="flex-1 w-full flex items-end justify-center px-1">
                              <div 
                                className="w-4 sm:w-6 bg-primary/70 rounded-t-md transition-all duration-500 hover:bg-primary" 
                                style={{ height: `${heightPercent}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-bold text-foreground mt-2">{p.monthLabel}</p>
                            <p className="text-[9px] text-muted-foreground font-semibold">R$ {Math.round(p.total)}</p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="p-3.5 bg-muted/40 border rounded-xl flex items-start gap-3">
                      <HelpCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Toque em qualquer coluna do gráfico acima para abrir a listagem detalhada e ver o que está programado para ser cobrado no mês selecionado.
                      </p>
                    </div>

                    {/* Detailed list area */}
                    <AnimatePresence mode="wait">
                      {selectedProjMonth && selectedMonthDetails && (
                        <motion.div
                          key={selectedProjMonth}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="border border-primary/20 rounded-xl overflow-hidden bg-primary/5 shadow-inner"
                        >
                          <div className="gradient-primary p-3 flex justify-between items-center text-white">
                            <div>
                              <p className="text-[10px] uppercase font-bold tracking-wider opacity-85">Detalhamento das Parcelas</p>
                              <p className="text-sm font-heading font-semibold">{selectedProjMonth}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs opacity-85">Valor Projetado</p>
                              <p className="text-base font-bold">R$ {formatBRL(selectedMonthDetails.total)}</p>
                            </div>
                          </div>
                          <div className="p-3 space-y-2 max-h-[250px] overflow-y-auto">
                            {selectedMonthDetails.items.map((item, idx) => (
                              <div key={idx} className="bg-card border p-2.5 rounded-lg flex items-center justify-between text-xs gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="font-semibold text-foreground truncate">{item.cleanDescription}</p>
                                    
                                    {/* User Tag for Consolidated view */}
                                    {selectedUserId === "all" && (
                                      <span className="text-[9px] bg-indigo-500/10 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full border border-indigo-500/10">
                                        {item.userName.split(" ")[0]}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-muted-foreground">
                                    <span>{item.cardName}</span>
                                    <span>·</span>
                                    <span className="font-medium text-primary">Parcela {item.current}/{item.total}</span>
                                  </div>
                                </div>
                                <span className="font-heading font-bold text-foreground whitespace-nowrap ml-2">
                                  R$ {formatBRL(item.monthlyAmount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <div className="text-center py-10">
                    <Calendar className="w-12 h-12 text-muted-foreground/45 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhuma parcela futura programada.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Section 3: Gráficos de Perfil de Consumo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Gastos por Cartão */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <Card className="shadow-card h-full">
                <CardHeader>
                  <CardTitle className="font-heading text-lg flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" />
                    Consumo por Cartão
                  </CardTitle>
                  <CardDescription>Distribuição histórica do seu limite de gastos</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.keys(byCard).length > 0 ? (
                    Object.entries(byCard).map(([cardName, value], idx) => {
                      const totalSpent = Object.values(byCard).reduce((s, v) => s + v, 0);
                      const percent = totalSpent > 0 ? (value / totalSpent) * 100 : 0;
                      return (
                        <div key={cardName} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">{cardName}</span>
                            <span className="font-medium text-muted-foreground">
                              R$ {formatBRL(value)} ({percent.toFixed(0)}%)
                            </span>
                          </div>
                          <Progress value={percent} className="h-2" />
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">Sem lançamentos associados.</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Gastos por Categoria */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card className="shadow-card h-full">
                <CardHeader>
                  <CardTitle className="font-heading text-lg flex items-center gap-2">
                    <Tag className="w-5 h-5 text-primary" />
                    Principais Categorias
                  </CardTitle>
                  <CardDescription>Sua distribuição de despesas por classificação</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.keys(byCategory).length > 0 ? (
                    Object.entries(byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([category, value], idx) => {
                        const totalSpent = Object.values(byCategory).reduce((s, v) => s + v, 0);
                        const percent = totalSpent > 0 ? (value / totalSpent) * 100 : 0;
                        return (
                          <div key={category} className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground">{category}</span>
                              <span className="font-medium text-muted-foreground">
                                R$ {formatBRL(value)} ({percent.toFixed(0)}%)
                              </span>
                            </div>
                            <Progress value={percent} className="h-2 bg-muted [&>div]:bg-purple-500" />
                          </div>
                        );
                      })
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">Sem classificação disponível.</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Section 4: Suas Parcelas em Andamento */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-heading text-lg flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  {selectedUserId === "all" ? "Parcelas Ativas em Andamento (Geral)" : "Suas Parcelas Ativas"}
                </CardTitle>
                <CardDescription>
                  Acompanhe a liquidação e o total restante de cada compra parcelada
                </CardDescription>
              </CardHeader>
              <CardContent>
                {activeInstallments.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {activeInstallments.map((item, idx) => {
                      const progress = Math.round((item.current / item.total) * 100);
                      return (
                        <div key={idx} className="border p-3.5 rounded-xl space-y-2 bg-card hover:shadow-sm transition-shadow">
                          <div className="flex justify-between items-start gap-2 text-xs">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="font-bold text-foreground truncate">{item.cleanDescription}</p>
                                
                                {/* User tag in cards if Consolidated */}
                                {selectedUserId === "all" && (
                                  <span className="text-[8px] bg-indigo-500/10 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full border border-indigo-500/10 shrink-0">
                                    {item.userName.split(" ")[0]}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{item.cardName}</p>
                            </div>
                            <span className="font-bold text-foreground whitespace-nowrap bg-muted px-2 py-0.5 rounded text-[10px]">
                              {item.current}/{item.total}
                            </span>
                          </div>

                          <div className="space-y-1">
                            <Progress value={progress} className="h-1.5 bg-muted [&>div]:bg-amber-500" />
                            <div className="flex justify-between text-[9px] text-muted-foreground">
                              <span>Progresso: {progress}%</span>
                              <span>Faltam {item.remainingInstallments} parcelas</span>
                            </div>
                          </div>

                          <div className="flex justify-between items-end border-t pt-2 mt-2 text-[10px]">
                            <div>
                              <p className="text-muted-foreground uppercase text-[8px] tracking-wider">Restante</p>
                              <p className="font-bold text-amber-600">R$ {formatBRL(item.totalRemaining)}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-muted-foreground uppercase text-[8px] tracking-wider">Valor Mensal</p>
                              <p className="font-semibold text-foreground">R$ {formatBRL(item.monthlyAmount)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <CalendarClock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhuma parcela ativa encontrada.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}
    </div>
  );
}
