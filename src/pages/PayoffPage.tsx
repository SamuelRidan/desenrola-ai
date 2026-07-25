import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePayoffData } from "@/hooks/usePayoffData";
import {
  formatBRL,
  formatMonthLabel,
  formatMonthLabelUpper,
  groupDebtsByCard,
  groupProjectedParcelasByCard,
} from "@/lib/debt-math";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DollarSign,
  Calendar,
  Clock,
  Wallet,
  Printer,
  Sparkles,
  TrendingDown,
  Pencil,
  Check,
  X,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { toast } from "sonner";

export default function PayoffPage() {
  const { user, role, profile } = useAuth();
  const isAdmin = role === "admin";
  const [selectedUserId, setSelectedUserId] = useState<string>("all");

  // Fetch user profiles for admin dropdown
  const { data: profiles = [] } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name");
      return data ?? [];
    },
    enabled: isAdmin,
  });

  const {
    isLoading,
    groupedDebts,
    projection,
    summary,
    caps,
    updateCap,
    updateAlias,
  } = usePayoffData(selectedUserId);

  // State for inline alias editing
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState("");
  const [editingCapMonth, setEditingCapMonth] = useState<string | null>(null);
  const [capInput, setCapInput] = useState("");

  const handleSaveAlias = async (rawDescription: string) => {
    try {
      await updateAlias(rawDescription, aliasInput);
      setEditingKey(null);
      toast.success("Apelido atualizado em todos os lançamentos correspondentes.");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar apelido.");
    }
  };

  const handleSaveCap = async (month: string, cardId: string) => {
    try {
      const amount = parseFloat(capInput.replace(",", "."));
      if (isNaN(amount) || amount < 0) {
        toast.error("Valor de teto inválido.");
        return;
      }
      await updateCap(month, cardId, amount);
      setEditingCapMonth(null);
      toast.success("Teto de uso atualizado.");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar teto.");
    }
  };

  // Recharts data format
  const chartData = useMemo(() => {
    return projection.map((p) => ({
      month: p.monthLabel,
      total: p.totalDoMes,
      cap: p.capAmount || 0,
      faturaPrevista: p.faturaPrevista || p.totalDoMes,
    }));
  }, [projection]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground flex items-center gap-2">
            Plano de Quitação <Sparkles className="w-6 h-6 text-amber-500" />
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Visualização automática mês a mês até a quitação de todos os seus parcelamentos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {isAdmin && (
            <div className="w-full sm:w-48">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="bg-card">
                  <Users className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Filtrar usuário" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os usuários</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Link to={`/quitacao/impressao${selectedUserId && selectedUserId !== "all" ? `?user=${selectedUserId}` : ""}`}>
            <Button className="gradient-primary text-primary-foreground shadow-md hover:shadow-lg transition-all">
              <Printer className="w-4 h-4 mr-2" />
              Imprimir Relatório A4
            </Button>
          </Link>
        </div>
      </div>

      {/* 4 Cards de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Dívida Total Restante */}
        <Card className="border-l-4 border-l-rose-500 bg-card shadow-sm hover:shadow-md transition-all">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dívida Total Restante
            </CardTitle>
            <div className="p-2 bg-rose-500/10 text-rose-600 rounded-lg">
              <TrendingDown className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {formatBRL(summary.dividaTotalRestante)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Soma de todas as parcelas futuras pendentes
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Mês da Liberdade */}
        <Card className="border-l-4 border-l-emerald-500 bg-card shadow-sm hover:shadow-md transition-all">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mês da Liberdade
            </CardTitle>
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
              <Calendar className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 capitalize">
              {summary.mesLiberdade ? formatMonthLabel(summary.mesLiberdade) : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Mês da última parcela do último parcelamento
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Faltam N Meses */}
        <Card className="border-l-4 border-l-sky-500 bg-card shadow-sm hover:shadow-md transition-all">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tempo Restante
            </CardTitle>
            <div className="p-2 bg-sky-500/10 text-sky-600 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {summary.mesesRestantes > 0 ? `Faltam ${summary.mesesRestantes} meses` : "Zerado 🎉"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.totalParcelamentosAtivos} parcelamento(s) ativo(s)
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Compromisso Próximo Mês */}
        <Card className="border-l-4 border-l-violet-500 bg-card shadow-sm hover:shadow-md transition-all">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Compromisso no Próximo Mês
            </CardTitle>
            <div className="p-2 bg-violet-500/10 text-violet-600 rounded-lg">
              <Wallet className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {formatBRL(summary.compromissoEsteMes)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Parcelas previstas para o próximo mês
            </p>
          </CardContent>
        </Card>
      </div>

      {groupedDebts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4 animate-bounce" />
            <h3 className="text-xl font-bold text-foreground mb-2">
              Nenhum parcelamento ativo encontrado!
            </h3>
            <p className="text-muted-foreground max-w-md mb-4">
              Parabéns! O sistema não encontrou nenhum parcelamento pendente nas suas faturas importadas.
            </p>
            <p className="text-xs text-muted-foreground">
              Se você importar faturas novas com parcelas (ex: "PARC 02/10"), elas aparecerão aqui automaticamente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Gráfico de Barras: Projeção de Parcelas por Mês */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Evolução do Valor Mensal das Parcelas</span>
                <Badge variant="outline" className="text-xs">
                  {projection.length} meses até o fim
                </Badge>
              </CardTitle>
              <CardDescription>
                Acompanhe a queda gradativa do valor total de parcelas conforme os parcelamentos forem finalizando.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis
                      dataKey="month"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12 }}
                      interval={0}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `R$${val}`}
                      tick={{ fontSize: 11 }}
                    />
                    <RechartsTooltip
                      formatter={(val: number) => [formatBRL(val), "Parcelas do Mês"]}
                      labelFormatter={(label) => `Mês: ${label}`}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={45}>
                      {chartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={index === 0 ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.7)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Tabela Resumo dos Parcelamentos Ativos Agrupados por Cartão */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Tabela de Parcelamentos por Cartão ({groupedDebts.length})</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Clique no ícone de lápis para alterar um apelido
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Apelido / Descrição Fatura</TableHead>
                      <TableHead className="text-center">Progresso</TableHead>
                      <TableHead className="text-right">Valor/Mês</TableHead>
                      <TableHead className="text-right font-medium">Saldo Restante</TableHead>
                      <TableHead className="text-center">Mês Final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupDebtsByCard(groupedDebts).map((cardGroup) => (
                      <React.Fragment key={cardGroup.cardId || cardGroup.cardName}>
                        {/* Linha Cabeçalho do Cartão */}
                        <TableRow className="bg-muted/60 font-semibold border-y">
                          <TableCell colSpan={2} className="py-2.5">
                            <div className="flex items-center gap-2 text-foreground font-bold">
                              <CreditCard className="w-4 h-4 text-primary" />
                              <span>{cardGroup.cardName}</span>
                              <Badge variant="outline" className="ml-2 text-xs">
                                {cardGroup.debts.length} parcelamento(s)
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-xs">
                            Subtotal: {formatBRL(cardGroup.totalMonthlyAmount)}/mês
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-xs text-primary">
                            Total: {formatBRL(cardGroup.totalRemaining)}
                          </TableCell>
                          <TableCell></TableCell>
                        </TableRow>

                        {/* Linhas das dívidas deste cartão */}
                        {cardGroup.debts.map((debt) => {
                          const isEditing = editingKey === debt.key;
                          return (
                            <TableRow key={debt.key}>
                              <TableCell className="max-w-[260px] pl-6">
                                {isEditing ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      value={aliasInput}
                                      onChange={(e) => setAliasInput(e.target.value)}
                                      className="h-8 text-xs"
                                      placeholder="Novo apelido"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleSaveAlias(debt.cleanDescription);
                                        if (e.key === "Escape") setEditingKey(null);
                                      }}
                                    />
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 text-emerald-600"
                                      onClick={() => handleSaveAlias(debt.cleanDescription)}
                                    >
                                      <Check className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8"
                                      onClick={() => setEditingKey(null)}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="group flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      {debt.alias ? (
                                        <div className="font-semibold text-foreground truncate">
                                          {debt.alias}
                                        </div>
                                      ) : (
                                        <div className="text-sm font-medium text-foreground truncate">
                                          {debt.cleanDescription}
                                        </div>
                                      )}
                                      <div className="text-xs text-muted-foreground truncate">
                                        {debt.cleanDescription}
                                      </div>
                                    </div>
                                    <button
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1"
                                      onClick={() => {
                                        setEditingKey(debt.key);
                                        setAliasInput(debt.alias || debt.cleanDescription);
                                      }}
                                      title="Editar apelido"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </TableCell>

                              <TableCell className="min-w-[140px]">
                                <div className="space-y-1">
                                  <div className="flex justify-between text-xs font-mono">
                                    <span>{debt.currentInstallment}/{debt.totalInstallments}</span>
                                    <span>{Math.round(debt.progress * 100)}%</span>
                                  </div>
                                  <Progress value={debt.progress * 100} className="h-2" />
                                </div>
                              </TableCell>

                              <TableCell className="text-right font-mono font-medium">
                                {formatBRL(debt.monthlyAmount)}
                              </TableCell>

                              <TableCell className="text-right font-mono font-bold text-foreground">
                                {formatBRL(debt.totalRemaining)}
                              </TableCell>

                              <TableCell className="text-center font-medium capitalize text-sm">
                                {formatMonthLabel(debt.lastDueMonth)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Projeção Mês a Mês (Accordions Agrupados por Cartão) */}
          <div className="space-y-3">
            <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
              Projeção Mês a Mês
            </h2>

            <Accordion type="single" collapsible className="space-y-3" defaultValue={projection[0]?.month}>
              {projection.map((proj) => {
                const hasEncerram = proj.encerram.length > 0;
                const isEditingCap = editingCapMonth === proj.month;
                const cardGroups = groupProjectedParcelasByCard(proj.parcelas);

                return (
                  <AccordionItem
                    key={proj.month}
                    value={proj.month}
                    className="border rounded-xl bg-card px-4 shadow-sm overflow-hidden"
                  >
                    <AccordionTrigger className="hover:no-underline py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full pr-4 gap-2 text-left">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-base capitalize text-foreground">
                            {formatMonthLabel(proj.month)}
                          </span>
                          <span className="text-xs text-muted-foreground font-normal bg-muted px-2.5 py-0.5 rounded-full">
                            mês {proj.monthIndex} de {proj.totalMonths}
                          </span>
                          {hasEncerram && (
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-xs font-semibold animate-pulse">
                              🎉 {proj.encerram.length} parcelamento(s) encerra(m) — libera {formatBRL(proj.alivio)}/mês
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground text-xs block">Parcelas do mês</span>
                            <span className="font-bold font-mono text-foreground">
                              {formatBRL(proj.totalDoMes)}
                            </span>
                          </div>
                          {proj.capAmount != null && (
                            <div>
                              <span className="text-muted-foreground text-xs block">Fatura Prevista</span>
                              <span className="font-bold font-mono text-amber-600">
                                {formatBRL(proj.faturaPrevista || 0)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="pt-2 pb-4 space-y-4">
                      {/* Tabela de parcelas deste mês por cartão */}
                      <div className="rounded-lg border overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/40">
                            <TableRow>
                              <TableHead>Apelido / Nome</TableHead>
                              <TableHead>Descrição Fatura</TableHead>
                              <TableHead className="text-center">Parcela</TableHead>
                              <TableHead className="text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {cardGroups.map((cg) => (
                              <React.Fragment key={cg.cardId || cg.cardName}>
                                <TableRow className="bg-muted/30 font-semibold text-xs border-y">
                                  <TableCell colSpan={3} className="py-2">
                                    <div className="flex items-center gap-2">
                                      <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                                      <span>{cg.cardName}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-bold">
                                    Subtotal: {formatBRL(cg.subtotal)}
                                  </TableCell>
                                </TableRow>
                                {cg.parcelas.map((item, idx) => (
                                  <TableRow key={idx}>
                                    <TableCell className="font-semibold text-foreground pl-6">
                                      {item.debt.alias || item.debt.cleanDescription}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground font-mono">
                                      {item.debt.cleanDescription}
                                    </TableCell>
                                    <TableCell className="text-center text-xs font-mono font-medium">
                                      {item.installmentNumber} / {item.debt.totalInstallments}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold">
                                      {formatBRL(item.debt.monthlyAmount)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </React.Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Bloco de Teto de Gastos Novos para este mês */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-muted/30 rounded-lg border border-dashed">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                            Teto de Gastos Novos em Compras à Vista
                          </span>
                          <p className="text-xs text-muted-foreground">
                            Gasto máximo planejado além das parcelas antigas neste mês.
                          </p>
                        </div>

                        {isEditingCap ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={capInput}
                              onChange={(e) => setCapInput(e.target.value)}
                              placeholder="R$ 500,00"
                              className="h-8 w-32 text-xs font-mono"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => handleSaveCap(proj.month, proj.parcelas[0]?.debt.cardId || "all")}
                            >
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => setEditingCapMonth(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-foreground">
                              {proj.capAmount != null ? formatBRL(proj.capAmount) : "Não definido"}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setEditingCapMonth(proj.month);
                                setCapInput(proj.capAmount != null ? String(proj.capAmount) : "");
                              }}
                            >
                              <Pencil className="w-3 h-3 mr-1" />
                              {proj.capAmount != null ? "Editar Teto" : "Definir Teto"}
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Rodapé explicativo do mês */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs bg-card p-3 rounded-lg border">
                        <div>
                          <span className="text-muted-foreground block">Total de parcelas do mês:</span>
                          <span className="font-bold text-sm font-mono">{formatBRL(proj.totalDoMes)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Saldo restante após este mês:</span>
                          <span className="font-bold text-sm font-mono text-emerald-600">{formatBRL(proj.saldoApos)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Encerram neste mês:</span>
                          {hasEncerram ? (
                            <div>
                              <span className="font-bold text-sm text-emerald-700">
                                {proj.encerram.length} parcelamento(s) · Soma: {formatBRL(proj.alivio)}/mês
                              </span>
                              <span className="block text-[11px] text-muted-foreground mt-0.5">
                                {proj.encerram.map((e) => e.alias || e.cleanDescription).join(", ")}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">Nenhum</span>
                          )}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </>
      )}
    </div>
  );
}
