import React, { useState, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePayoffData } from "@/hooks/usePayoffData";
import {
  formatBRL,
  formatMonthLabelUpper,
  formatMonthLabel,
  groupDebtsByCard,
  groupProjectedParcelasByCard,
} from "@/lib/debt-math";
import { generatePayoffPDF } from "@/lib/pdf-generator";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Download, ArrowLeft, Loader2, Users, FileText } from "lucide-react";
import { toast } from "sonner";

export default function PayoffPrintPage() {
  const [searchParams] = useSearchParams();
  const initialUserId = searchParams.get("user") || "all";
  const [selectedUserId, setSelectedUserId] = useState<string>(initialUserId);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { role } = useAuth();
  const isAdmin = role === "admin";

  // Fetch profiles for admin filter
  const { data: profiles = [] } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name");
      return data ?? [];
    },
    enabled: isAdmin,
  });

  const selectedProfile = useMemo(() => {
    if (selectedUserId === "all") return null;
    return profiles.find((p) => p.user_id === selectedUserId) || null;
  }, [profiles, selectedUserId]);

  const { isLoading, groupedDebts, projection, summary } = usePayoffData(selectedUserId);

  const cardGroupedDebts = useMemo(() => {
    return groupDebtsByCard(groupedDebts);
  }, [groupedDebts]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!containerRef.current) return;
    setIsGeneratingPDF(true);
    toast.info("Gerando PDF com páginas formatadas A4...");

    try {
      const fileName = selectedProfile
        ? `Plano_de_Quitacao_${selectedProfile.full_name.replace(/\s+/g, "_")}.pdf`
        : "Plano_de_Quitacao.pdf";

      await generatePayoffPDF(containerRef.current, fileName);
      toast.success("PDF gerado e baixado com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar PDF.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 md:p-8 print:p-0 print:bg-white text-black font-serif">
      {/* Botões de Ação Topo (Não aparecem na impressão) */}
      <div className="no-print max-w-4xl mx-auto mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-neutral-800 p-4 rounded-xl shadow-md border border-neutral-200 dark:border-neutral-700">
        <Link to={`/quitacao${selectedUserId !== "all" ? `?user=${selectedUserId}` : ""}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar ao Painel
          </Button>
        </Link>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {isAdmin && (
            <div className="w-full sm:w-56">
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

          <Button
            onClick={handleDownloadPDF}
            disabled={isGeneratingPDF}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow font-sans font-semibold"
          >
            {isGeneratingPDF ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Baixar PDF (Formatado A4)
          </Button>

          <Button onClick={handlePrint} variant="outline" className="border-black font-sans">
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* CSS de Impressão Estrito */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body {
            background-color: white !important;
            color: black !important;
            font-family: "Georgia", "Times New Roman", serif !important;
            font-size: 10pt !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          .page-break {
            page-break-after: always !important;
            break-after: page !important;
          }
          .avoid-break {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .print-border {
            border: 1px solid #000 !important;
          }
          .dotted-line {
            border-bottom: 1px dotted #000 !important;
            min-height: 6mm !important;
            display: inline-block;
          }
          .a4-page {
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 0 10mm 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
        }

        /* Preview na tela e container para PDF de alta fidelidade A4 */
        .a4-page {
          width: 210mm;
          min-height: 297mm;
          height: auto;
          padding: 12mm;
          margin: 0 auto 20px auto;
          background: white;
          color: black;
          font-family: "Georgia", "Times New Roman", serif;
          font-size: 10pt;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          box-sizing: border-box;
          position: relative;
        }

        .dotted-line {
          border-bottom: 1px dotted #333;
          min-height: 6mm;
          display: inline-block;
        }
      `}</style>

      {/* Recipiente dos Documentos A4 */}
      <div ref={containerRef} className="max-w-[210mm] mx-auto space-y-6 print:space-y-0">
        {/* ============================================================ */}
        {/* PÁGINA 1 — CAPA                                              */}
        {/* ============================================================ */}
        <div className="a4-page page-break flex flex-col justify-between">
          <div>
            {/* Cabeçalho da Capa */}
            <div className="border-b-2 border-black pb-3 mb-4 flex justify-between items-end">
              <div>
                <h1 className="text-2xl font-bold uppercase tracking-wider">Plano de Quitação de Dívidas</h1>
                <p className="text-xs text-neutral-600 font-sans mt-0.5">
                  Relatório de Acompanhamento Manual (Impressão A4)
                  {selectedProfile && (
                    <span className="font-bold block mt-0.5 text-black">
                      Titular: {selectedProfile.full_name}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right text-xs font-mono">
                Data: {new Date().toLocaleDateString("pt-BR")}
              </div>
            </div>

            {/* 4 Grandes Indicadores da Capa */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="border border-black p-3 rounded-none">
                <span className="text-xs uppercase font-sans text-neutral-600 block">Dívida Total Restante</span>
                <span className="text-xl font-bold font-mono block mt-1">
                  {formatBRL(summary.dividaTotalRestante)}
                </span>
              </div>

              <div className="border border-black p-3 rounded-none">
                <span className="text-xs uppercase font-sans text-neutral-600 block">Mês da Liberdade</span>
                <span className="text-xl font-bold capitalize block mt-1">
                  {summary.mesLiberdade ? formatMonthLabel(summary.mesLiberdade) : "—"}
                </span>
              </div>

              <div className="border border-black p-3 rounded-none">
                <span className="text-xs uppercase font-sans text-neutral-600 block">Parcelamentos Ativos</span>
                <span className="text-lg font-bold block mt-1">
                  {summary.totalParcelamentosAtivos} parcelamento(s)
                </span>
              </div>

              <div className="border border-black p-3 rounded-none">
                <span className="text-xs uppercase font-sans text-neutral-600 block">Tempo Restante</span>
                <span className="text-lg font-bold block mt-1">
                  {summary.mesesRestantes} meses até zerar
                </span>
              </div>
            </div>

            {/* Tabela: Quando cada parcelamento termina (Agrupada por Cartão) */}
            <div className="mb-6">
              <h2 className="text-sm font-bold uppercase border-b border-black pb-1 mb-3">
                Quando cada parcelamento termina (Por Cartão)
              </h2>

              {cardGroupedDebts.length === 0 ? (
                <p className="text-xs italic text-neutral-500 py-4">Nenhum parcelamento ativo encontrado para o filtro selecionado.</p>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b-2 border-black font-sans">
                      <th className="py-1.5 pr-2">Apelido / Nome</th>
                      <th className="py-1.5 px-2">Descrição no Cartão</th>
                      <th className="py-1.5 px-2 text-center">Parc. Restantes</th>
                      <th className="py-1.5 px-2 text-right">Valor / Mês</th>
                      <th className="py-1.5 px-2 text-right">Total Restante</th>
                      <th className="py-1.5 pl-2 text-right">Mês Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardGroupedDebts.map((cg) => (
                      <React.Fragment key={`card-${cg.cardId || cg.cardName}`}>
                        {/* Subcabeçalho do Cartão */}
                        <tr className="border-b border-black bg-neutral-100 font-sans font-bold">
                          <td colSpan={3} className="py-1.5 pr-2 uppercase tracking-wide">
                            💳 CARTÃO: {cg.cardName}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            Subtotal: {formatBRL(cg.totalMonthlyAmount)}/mês
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            Total: {formatBRL(cg.totalRemaining)}
                          </td>
                          <td className="py-1.5 pl-2 text-right"></td>
                        </tr>
                        {cg.debts.map((debt, i) => (
                          <tr key={i} className="border-b border-neutral-300">
                            <td className="py-1.5 pr-2 font-bold pl-3">
                              {debt.alias || <div className="dotted-line w-24 min-h-[5mm]"></div>}
                            </td>
                            <td className="py-1.5 px-2 text-neutral-700 text-[8.5pt] font-mono">
                              {debt.cleanDescription}
                            </td>
                            <td className="py-1.5 px-2 text-center font-mono text-[8.5pt]">
                              {debt.remainingCount}x <span className="text-neutral-500">({debt.currentInstallment}/{debt.totalInstallments})</span>
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {formatBRL(debt.monthlyAmount)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-black">
                              {formatBRL(debt.totalRemaining)}
                            </td>
                            <td className="py-1.5 pl-2 text-right capitalize font-medium">
                              {formatMonthLabel(debt.lastDueMonth)}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Meta Pessoal */}
            <div className="mt-8 pt-4 border-t border-black">
              <span className="font-bold text-xs uppercase block mb-2">Meta Pessoal / Compromisso:</span>
              <div className="dotted-line w-full min-h-[12mm]"></div>
              <div className="dotted-line w-full min-h-[12mm]"></div>
            </div>
          </div>

          {/* Rodapé da Capa */}
          <div className="border-t border-neutral-400 pt-2 flex justify-between text-[8pt] text-neutral-600 font-sans">
            <span>Plano de Quitação — Capa {selectedProfile ? `(${selectedProfile.full_name})` : ""}</span>
            <span>Página 1</span>
          </div>
        </div>

        {/* ============================================================ */}
        {/* UMA PÁGINA POR MÊS, DAQUI ATÉ O FIM                          */}
        {/* ============================================================ */}
        {projection.map((proj, index) => {
          const pageNum = index + 2; // Capa é página 1
          const cardGroups = groupProjectedParcelasByCard(proj.parcelas);

          return (
            <div key={proj.month} className="a4-page page-break flex flex-col justify-between">
              <div>
                {/* Cabeçalho da Página Mensal */}
                <div className="border-b-2 border-black pb-2 mb-4 flex justify-between items-baseline">
                  <h1 className="text-xl font-bold tracking-tight">
                    {formatMonthLabelUpper(proj.month)}
                  </h1>
                  <span className="text-xs font-sans font-bold">
                    mês {proj.monthIndex} de {proj.totalMonths}
                  </span>
                </div>

                {/* Tabela de Parcelas do Mês Agrupada por Cartão */}
                <div className="mb-6">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b-2 border-black font-sans text-[9pt]">
                        <th className="py-1.5 w-6 text-center">☐</th>
                        <th className="py-1.5 px-2">Apelido / Nome</th>
                        <th className="py-1.5 px-2 text-neutral-600 font-normal">Descrição no cartão</th>
                        <th className="py-1.5 px-2 text-center">Parcela</th>
                        <th className="py-1.5 px-2 text-right">Valor</th>
                        <th className="py-1.5 pl-2 text-center w-28">Pago em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cardGroups.map((cg) => (
                        <React.Fragment key={`month-card-${cg.cardId || cg.cardName}`}>
                          <tr className="border-b border-black bg-neutral-100 font-sans font-bold text-[8.5pt]">
                            <td colSpan={4} className="py-1.5 pr-2 uppercase">
                              💳 CARTÃO: {cg.cardName}
                            </td>
                            <td colSpan={2} className="py-1.5 text-right font-mono">
                              Subtotal: {formatBRL(cg.subtotal)}
                            </td>
                          </tr>

                          {cg.parcelas.map((item, pIdx) => {
                            const hasAlias = !!item.debt.alias;
                            return (
                              <tr key={pIdx} className="border-b border-neutral-300 avoid-break">
                                {/* Coluna 1: Quadradinho vazio de 5mm */}
                                <td className="py-2 text-center">
                                  <span className="inline-block w-4 h-4 border border-black align-middle"></span>
                                </td>

                                {/* Coluna 2: Apelido em Negrito ou Linha Pontilhada */}
                                <td className="py-2 px-2 font-bold text-sm pl-4">
                                  {hasAlias ? (
                                    item.debt.alias
                                  ) : (
                                    <div className="dotted-line w-full min-h-[6mm]"></div>
                                  )}
                                </td>

                                {/* Coluna 3: Descrição no cartão (texto cru, fonte menor, cinza) */}
                                <td className="py-2 px-2 text-[8.5pt] text-neutral-600 font-mono">
                                  {item.debt.cleanDescription}
                                </td>

                                {/* Coluna 4: Parcela */}
                                <td className="py-2 px-2 text-center font-mono text-xs">
                                  {item.installmentNumber}/{item.debt.totalInstallments}
                                </td>

                                {/* Coluna 5: Valor */}
                                <td className="py-2 px-2 text-right font-mono font-bold text-sm">
                                  {formatBRL(item.debt.monthlyAmount)}
                                </td>

                                {/* Coluna 6: Pago em */}
                                <td className="py-2 pl-2 text-center">
                                  <div className="dotted-line w-full min-h-[6mm]"></div>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bloco COMPRAS NOVAS DO MÊS */}
                <div className="border border-black p-3 mb-4 avoid-break">
                  <div className="flex justify-between items-center border-b border-black pb-1 mb-2">
                    <span className="font-bold text-xs uppercase font-sans">
                      Compras Novas do Mês (Uso À Vista / Cartão)
                    </span>
                    <span className="text-xs font-mono">
                      Teto planejado: {proj.capAmount ? formatBRL(proj.capAmount) : "R$ ________"}
                    </span>
                  </div>

                  {/* 10 Linhas Pontilhadas para preencher à mão */}
                  <div className="space-y-1.5 text-[8pt] text-neutral-500 font-sans">
                    {Array.from({ length: 10 }).map((_, lineIdx) => (
                      <div key={lineIdx} className="flex items-center gap-2">
                        <span className="w-12 text-neutral-400">Data ___</span>
                        <div className="dotted-line flex-1"></div>
                        <span className="w-20 text-right text-neutral-400">R$ ________</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Rodapé Estruturado da Página do Mês */}
              <div className="border-t-2 border-black pt-3 space-y-2 text-xs avoid-break">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono">
                  <div className="flex justify-between">
                    <span className="font-sans">Total de parcelas do mês:</span>
                    <span className="font-bold">{formatBRL(proj.totalDoMes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans">Teto de uso:</span>
                    <span>{proj.capAmount ? formatBRL(proj.capAmount) : "R$ ______"}</span>
                  </div>
                  <div className="flex justify-between border-t border-dotted border-black pt-0.5">
                    <span className="font-sans font-bold">Fatura real que chegou:</span>
                    <span className="font-bold">R$ __________</span>
                  </div>
                  <div className="flex justify-between border-t border-dotted border-black pt-0.5">
                    <span className="font-sans">Saldo restante após este mês:</span>
                    <span className="font-bold">{formatBRL(proj.saldoApos)}</span>
                  </div>
                </div>

                <div className="flex justify-between items-start text-[9pt] font-sans pt-1.5 border-t border-neutral-300">
                  <div>
                    <span className="font-bold">Encerram neste mês: </span>
                    {proj.encerram.length > 0 ? (
                      <span>
                        <strong className="text-black">{proj.encerram.length} parcelamento(s)</strong> (soma dos valores: <strong>{formatBRL(proj.alivio)}/mês</strong>)
                        <span className="block text-[8.5pt] text-neutral-600 mt-0.5">
                          Itens: {proj.encerram.map((e) => e.alias || e.cleanDescription).join(", ")}
                        </span>
                      </span>
                    ) : (
                      <span className="italic text-neutral-500">nenhum</span>
                    )}
                  </div>
                  <div className="font-bold whitespace-nowrap pl-2">
                    Faltam {proj.totalMonths - proj.monthIndex} meses para zerar
                  </div>
                </div>

                <div className="pt-1">
                  <span className="font-bold text-[8pt] uppercase font-sans">Anotações:</span>
                  <div className="dotted-line w-full min-h-[8mm]"></div>
                </div>

                <div className="pt-2 flex justify-between text-[8pt] text-neutral-500 font-sans border-t border-neutral-200">
                  <span>Plano de Quitação — {formatMonthLabel(proj.month)}</span>
                  <span>Página {pageNum}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
