/**
 * debt-math.ts — Funções puras para o Plano de Quitação.
 *
 * Duas abordagens:
 *  1. Processamento de transações existentes (parseInstallment do sistema)
 *  2. Utilitários de data/moeda compartilhados
 *
 * Regras:
 * - Datas sempre no dia 1, sem hora (string "YYYY-MM-01").
 * - Dinheiro em centavos internamente para aritmética, exposto como number (reais).
 * - Nunca usa `new Date(string)` solto — sempre parseMonthStr / toMonthStr.
 */

// ─── Utilitários de data ────────────────────────────────────

/** Cria uma string "YYYY-MM-01" a partir de ano e mês (1-based). */
export function toMonthStr(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Extrai {year, month} de "YYYY-MM-01". Nunca cria Date. */
export function parseMonthStr(s: string): { year: number; month: number } {
  const parts = s.split('-');
  return { year: Number(parts[0]), month: Number(parts[1]) };
}

/** Soma N meses a "YYYY-MM-01". Retorna "YYYY-MM-01". */
export function addMonths(monthStr: string, n: number): string {
  const { year, month } = parseMonthStr(monthStr);
  const total = (year * 12 + (month - 1)) + n;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return toMonthStr(newYear, newMonth);
}

/** Diferença em meses: b - a. Positivo se b > a. */
export function diffMonths(a: string, b: string): number {
  const pa = parseMonthStr(a);
  const pb = parseMonthStr(b);
  return (pb.year * 12 + pb.month) - (pa.year * 12 + pa.month);
}

/** Compara "YYYY-MM-01" strings: -1, 0, 1. */
export function compareMonths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Retorna "YYYY-MM-01" do mês atual (UTC). */
export function currentMonthStr(): string {
  const now = new Date();
  return toMonthStr(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/** Nomes dos meses em pt-BR. */
const MONTH_NAMES = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

/** Formata "YYYY-MM-01" para "março/2027". */
export function formatMonthLabel(monthStr: string): string {
  const { year, month } = parseMonthStr(monthStr);
  return `${MONTH_NAMES[month]}/${year}`;
}

/** Formata "YYYY-MM-01" para "MARÇO / 2027" (maiúsculo, com espaços). */
export function formatMonthLabelUpper(monthStr: string): string {
  const { year, month } = parseMonthStr(monthStr);
  return `${MONTH_NAMES[month].toUpperCase()} / ${year}`;
}

// ─── Formatação monetária ───────────────────────────────────

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatBRL(value: number): string {
  return currencyFormatter.format(value);
}

// ─── Tipos para processamento de transações ─────────────────

/** Entrada bruta: uma transação parcelada do banco. */
export interface RawInstallmentItem {
  txId: string;
  description: string;
  cleanDescription: string;
  alias: string | null;
  currentInstallment: number;
  totalInstallments: number;
  amount: number;           // share_amount ou full amount
  cardName: string;
  cardId: string;
  statementMonth: number;   // 1-12
  statementYear: number;
}

/** Parcelamento agrupado (mais recente de cada grupo). */
export interface GroupedDebt {
  key: string;
  cleanDescription: string;
  alias: string | null;
  cardName: string;
  cardId: string;
  currentInstallment: number;
  totalInstallments: number;
  monthlyAmount: number;
  remainingCount: number;     // total - current
  totalRemaining: number;     // monthlyAmount * remainingCount
  lastDueMonth: string;       // "YYYY-MM-01" da última parcela
  firstDueMonth: string;      // "YYYY-MM-01" da primeira parcela
  progress: number;           // current / total (0..1)
  referenceMonthStr: string;  // "YYYY-MM-01" do statement de referência
}

/** Item de parcela dentro de uma projeção mensal. */
export interface ProjectedInstallment {
  debt: GroupedDebt;
  installmentNumber: number;  // número da parcela neste mês
}

/** Projeção de um mês. */
export interface MonthProjection {
  month: string;               // "YYYY-MM-01"
  monthLabel: string;          // "março/2027"
  monthIndex: number;          // mês N de total M (1-based)
  totalMonths: number;         // total de meses na projeção
  parcelas: ProjectedInstallment[];
  totalDoMes: number;
  saldoApos: number;
  encerram: GroupedDebt[];
  alivio: number;
  capAmount?: number;
  faturaPrevista?: number;
}

/** Resumo geral do plano de quitação. */
export interface PayoffSummary {
  dividaTotalRestante: number;
  mesLiberdade: string | null;
  mesesRestantes: number;
  compromissoEsteMes: number;
  totalParcelamentosAtivos: number;
}

export interface CapRow {
  card_id: string;
  month: string;
  cap_amount: number;
}

// ─── Agrupamento de transações parceladas ───────────────────

/**
 * Agrupa transações parceladas por parcelamento único.
 * 
 * Chave de agrupamento: cleanDescription + cardId + totalInstallments + amount
 * Mantém apenas o mais recente (maior currentInstallment) de cada grupo.
 * 
 * Isso deduplica: se a mesma compra aparece em múltiplos meses
 * (PARC 01/10, PARC 02/10, ...), mantém só o mais recente.
 */
export function groupTransactionInstallments(items: RawInstallmentItem[]): GroupedDebt[] {
  const groups = new Map<string, RawInstallmentItem>();

  for (const item of items) {
    // Arredonda amount para evitar inconsistências de float na chave
    const amountKey = Math.round(item.amount * 100);
    const key = `${item.cleanDescription}|${item.cardId}|${item.totalInstallments}|${amountKey}`;

    const existing = groups.get(key);
    if (!existing || item.currentInstallment > existing.currentInstallment) {
      groups.set(key, item);
    }
  }

  const result: GroupedDebt[] = [];

  for (const [key, item] of groups) {
    const remaining = item.totalInstallments - item.currentInstallment;
    if (remaining < 0) continue; // inválido

    const refMonth = toMonthStr(item.statementYear, item.statementMonth);

    // Parcela "current" cai no mês do statement.
    // Parcela 1 caiu em: refMonth - (current - 1)
    const firstDue = addMonths(refMonth, -(item.currentInstallment - 1));
    // Última parcela cai em: refMonth + remaining
    const lastDue = addMonths(refMonth, remaining);

    result.push({
      key,
      cleanDescription: item.cleanDescription,
      alias: item.alias,
      cardName: item.cardName,
      cardId: item.cardId,
      currentInstallment: item.currentInstallment,
      totalInstallments: item.totalInstallments,
      monthlyAmount: item.amount,
      remainingCount: remaining,
      totalRemaining: Math.round(item.amount * remaining * 100) / 100,
      lastDueMonth: lastDue,
      firstDueMonth: firstDue,
      progress: item.currentInstallment / item.totalInstallments,
      referenceMonthStr: refMonth,
    });
  }

  // Ordena: maior valor total restante primeiro
  result.sort((a, b) => b.totalRemaining - a.totalRemaining);

  return result;
}

export interface CardGroupedDebts {
  cardId: string;
  cardName: string;
  debts: GroupedDebt[];
  totalMonthlyAmount: number;
  totalRemaining: number;
}

export function groupDebtsByCard(debts: GroupedDebt[]): CardGroupedDebts[] {
  const map = new Map<string, CardGroupedDebts>();

  for (const d of debts) {
    const key = d.cardId || d.cardName;
    const existing = map.get(key);
    if (existing) {
      existing.debts.push(d);
      existing.totalMonthlyAmount += d.monthlyAmount;
      existing.totalRemaining += d.totalRemaining;
    } else {
      map.set(key, {
        cardId: d.cardId,
        cardName: d.cardName,
        debts: [d],
        totalMonthlyAmount: d.monthlyAmount,
        totalRemaining: d.totalRemaining,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.cardName.localeCompare(b.cardName));
}

export interface CardGroupedParcelas {
  cardId: string;
  cardName: string;
  parcelas: ProjectedInstallment[];
  subtotal: number;
}

export function groupProjectedParcelasByCard(parcelas: ProjectedInstallment[]): CardGroupedParcelas[] {
  const map = new Map<string, CardGroupedParcelas>();

  for (const p of parcelas) {
    const key = p.debt.cardId || p.debt.cardName;
    const existing = map.get(key);
    if (existing) {
      existing.parcelas.push(p);
      existing.subtotal += p.debt.monthlyAmount;
    } else {
      map.set(key, {
        cardId: p.debt.cardId,
        cardName: p.debt.cardName,
        parcelas: [p],
        subtotal: p.debt.monthlyAmount,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.cardName.localeCompare(b.cardName));
}

// ─── Projeção mês a mês ────────────────────────────────────

/**
 * Constrói a projeção mês a mês a partir dos parcelamentos agrupados.
 * 
 * Começa no mês seguinte ao mês de referência (próximo mês a pagar)
 * e vai até a última parcela de qualquer parcelamento.
 */
export function buildPayoffProjection(
  debts: GroupedDebt[],
  caps: CapRow[],
  referenceMonth?: string,
): MonthProjection[] {
  if (debts.length === 0) return [];

  // Filtra apenas dívidas com parcelas restantes
  const activeDebts = debts.filter(d => d.remainingCount > 0);
  if (activeDebts.length === 0) return [];

  // O mês de referência é o mês atual por padrão
  const ref = referenceMonth ?? currentMonthStr();

  // O "próximo mês" a pagar: mês seguinte ao ref
  const startMonth = addMonths(ref, 1);

  // Encontra o último mês
  let lastMonth = startMonth;
  for (const debt of activeDebts) {
    if (compareMonths(debt.lastDueMonth, lastMonth) > 0) {
      lastMonth = debt.lastDueMonth;
    }
  }

  const totalMonthsCount = diffMonths(startMonth, lastMonth) + 1;

  // Mapa de caps por mês
  const capByMonth = new Map<string, number>();
  for (const cap of caps) {
    const existing = capByMonth.get(cap.month) ?? 0;
    capByMonth.set(cap.month, existing + cap.cap_amount);
  }

  const projection: MonthProjection[] = [];

  for (let i = 0; i < totalMonthsCount; i++) {
    const m = addMonths(startMonth, i);
    const parcelas: ProjectedInstallment[] = [];
    let totalDoMes = 0;

    for (const debt of activeDebts) {
      // Para esta dívida, a parcela que cai no mês M é:
      // installmentNumber = debt.currentInstallment + diffMonths(debt.referenceMonthStr, m)
      const monthsFromRef = diffMonths(debt.referenceMonthStr, m);
      const installmentNumber = debt.currentInstallment + monthsFromRef;

      if (installmentNumber >= 1 && installmentNumber <= debt.totalInstallments &&
          installmentNumber > debt.currentInstallment) {
        parcelas.push({
          debt,
          installmentNumber,
        });
        totalDoMes += debt.monthlyAmount;
      }
    }

    totalDoMes = Math.round(totalDoMes * 100) / 100;

    // saldo_apos: soma das parcelas de meses após este
    let saldoApos = 0;
    for (const debt of activeDebts) {
      for (let futureInst = debt.currentInstallment + 1; futureInst <= debt.totalInstallments; futureInst++) {
        const futureMonth = addMonths(debt.referenceMonthStr, futureInst - debt.currentInstallment);
        if (compareMonths(futureMonth, m) > 0) {
          saldoApos += debt.monthlyAmount;
        }
      }
    }
    saldoApos = Math.round(saldoApos * 100) / 100;

    // encerram: dívidas cuja última parcela é neste mês
    const encerram: GroupedDebt[] = [];
    let alivio = 0;
    for (const debt of activeDebts) {
      if (debt.lastDueMonth === m) {
        encerram.push(debt);
        alivio += debt.monthlyAmount;
      }
    }
    alivio = Math.round(alivio * 100) / 100;

    const cap = capByMonth.get(m);
    const faturaPrevista = cap != null
      ? Math.round((totalDoMes + cap) * 100) / 100
      : undefined;

    if (totalDoMes > 0 || parcelas.length > 0) {
      projection.push({
        month: m,
        monthLabel: formatMonthLabel(m),
        monthIndex: i + 1,
        totalMonths: totalMonthsCount,
        parcelas,
        totalDoMes,
        saldoApos,
        encerram,
        alivio,
        capAmount: cap,
        faturaPrevista,
      });
    }
  }

  return projection;
}

// ─── Resumo do plano ────────────────────────────────────────

export function computePayoffSummary(
  debts: GroupedDebt[],
  referenceMonth?: string,
): PayoffSummary {
  const ref = referenceMonth ?? currentMonthStr();
  const nextMonth = addMonths(ref, 1);

  const activeDebts = debts.filter(d => d.remainingCount > 0);

  if (activeDebts.length === 0) {
    return {
      dividaTotalRestante: 0,
      mesLiberdade: null,
      mesesRestantes: 0,
      compromissoEsteMes: 0,
      totalParcelamentosAtivos: 0,
    };
  }

  let totalRestante = 0;
  let compromissoNextMonth = 0;
  let lastMonth: string | null = null;

  for (const debt of activeDebts) {
    totalRestante += debt.totalRemaining;

    // Compromisso do próximo mês
    const nextInstallment = debt.currentInstallment + 1;
    if (nextInstallment <= debt.totalInstallments) {
      const instMonth = addMonths(debt.referenceMonthStr, 1);
      if (instMonth === nextMonth) {
        compromissoNextMonth += debt.monthlyAmount;
      }
    }

    if (!lastMonth || compareMonths(debt.lastDueMonth, lastMonth) > 0) {
      lastMonth = debt.lastDueMonth;
    }
  }

  const mesesRestantes = lastMonth ? Math.max(0, diffMonths(ref, lastMonth)) : 0;

  return {
    dividaTotalRestante: Math.round(totalRestante * 100) / 100,
    mesLiberdade: lastMonth,
    mesesRestantes,
    compromissoEsteMes: Math.round(compromissoNextMonth * 100) / 100,
    totalParcelamentosAtivos: activeDebts.length,
  };
}

// ─── Geração de parcelas (para cadastro manual futuro) ──────

export interface GeneratedInstallment {
  number: number;
  due_month: string;
  amount: number;
  status: 'pending' | 'paid';
}

export interface DebtInput {
  total_amount: number;
  installments_total: number;
  installments_paid: number;
  first_due_month: string;
}

/**
 * Gera as parcelas de uma dívida (cadastro manual).
 *
 * Regra:
 *   base = floor(total / n * 100) / 100
 *   resto = total - (base * n)
 *   O resto vai na PRIMEIRA parcela.
 */
export function generateInstallments(input: DebtInput): GeneratedInstallment[] {
  const { total_amount, installments_total, installments_paid, first_due_month } = input;

  const totalCents = Math.round(total_amount * 100);
  const baseCents = Math.floor(totalCents / installments_total);
  const restoCents = totalCents - (baseCents * installments_total);

  const result: GeneratedInstallment[] = [];

  for (let i = 1; i <= installments_total; i++) {
    const cents = i === 1 ? baseCents + restoCents : baseCents;
    result.push({
      number: i,
      due_month: addMonths(first_due_month, i - 1),
      amount: cents / 100,
      status: i <= installments_paid ? 'paid' : 'pending',
    });
  }

  return result;
}

// ─── Parser de linhas de fatura ─────────────────────────────

export interface ParsedLine {
  raw: string;
  cleaned_description: string;
  installment_current: number | null;
  installment_total: number | null;
  amount: number | null;
  confidence: 'high' | 'medium' | 'low';
}

export function cleanDescription(raw: string): string {
  let desc = raw.trim();

  desc = desc.replace(/^\d{2}\/\d{2}\s*-?\s*/, '');
  desc = desc.replace(/^\s*-\s*/, '');
  desc = desc.replace(/^(PAG\*|MP\s*\*\s*|IFD\*|IOF\*|PGTO\*|INT\*)\s*/i, '');
  desc = desc.replace(/\s*-?\s*R\$\s*[\d.,]+\s*$/, '');
  desc = desc.replace(/\s*-\s*[\d]+[.,]\d{2}\s*$/, '');
  desc = desc.replace(/\s+[\d]+[.,]\d{2}\s*$/, '');
  desc = desc.replace(/\s*PARC\s+\d+\/\d+/i, '');
  desc = desc.replace(/\s*\(\d+\/\d+\)\s*/, ' ');
  desc = desc.replace(/\s+\d+\/\d+\s*$/, '');
  desc = desc.replace(/\b\d{4,}\b/g, '').trim();
  desc = desc.replace(/\s*-\s*$/, '');
  desc = desc.replace(/\s{2,}/g, ' ').trim();

  return desc;
}

export function extractInstallmentInfo(raw: string): { current: number; total: number } | null {
  const parcMatch = raw.match(/PARC\s+(\d+)\/(\d+)/i);
  if (parcMatch) {
    return { current: Number(parcMatch[1]), total: Number(parcMatch[2]) };
  }

  const parenMatch = raw.match(/\((\d+)\/(\d+)\)/);
  if (parenMatch) {
    return { current: Number(parenMatch[1]), total: Number(parenMatch[2]) };
  }

  const trailingMatch = raw.match(/\b(\d{1,2})\/(\d{1,2})\s*(?:[\d.,]+\s*)?$/);
  if (trailingMatch) {
    const a = Number(trailingMatch[1]);
    const b = Number(trailingMatch[2]);
    if (a <= b && b >= 2 && b <= 72) {
      return { current: a, total: b };
    }
  }

  return null;
}

export function extractAmount(raw: string): number | null {
  const brMatch = raw.match(/R\$\s*([\d.]+,\d{2})/);
  if (brMatch) {
    return parseBRLNumber(brMatch[1]);
  }

  const trailingMatch = raw.match(/([\d.]+,\d{2})\s*$/);
  if (trailingMatch) {
    return parseBRLNumber(trailingMatch[1]);
  }

  return null;
}

function parseBRLNumber(str: string): number {
  return Number(str.replace(/\./g, '').replace(',', '.'));
}

export function parseBulkLines(text: string): ParsedLine[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  return lines.map(raw => {
    const cleaned = cleanDescription(raw);
    const installmentInfo = extractInstallmentInfo(raw);
    const amount = extractAmount(raw);

    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (amount !== null && installmentInfo !== null) {
      confidence = 'high';
    } else if (amount !== null || installmentInfo !== null) {
      confidence = 'medium';
    }

    return {
      raw,
      cleaned_description: cleaned,
      installment_current: installmentInfo?.current ?? null,
      installment_total: installmentInfo?.total ?? null,
      amount,
      confidence,
    };
  });
}
