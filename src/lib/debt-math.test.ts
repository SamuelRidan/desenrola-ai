import { describe, it, expect } from 'vitest';
import {
  generateInstallments,
  addMonths,
  diffMonths,
  parseMonthStr,
  toMonthStr,
  formatMonthLabel,
  groupTransactionInstallments,
  buildPayoffProjection,
  computePayoffSummary,
  parseBulkLines,
  cleanDescription,
  extractInstallmentInfo,
  extractAmount,
  type RawInstallmentItem,
  type GroupedDebt,
  type CapRow,
} from './debt-math';

// ─── Utilitários de data ────────────────────────────────────

describe('Utilitários de data', () => {
  it('parseMonthStr e toMonthStr são inversos', () => {
    const str = '2027-03-01';
    const { year, month } = parseMonthStr(str);
    expect(year).toBe(2027);
    expect(month).toBe(3);
    expect(toMonthStr(year, month)).toBe(str);
  });

  it('addMonths soma corretamente', () => {
    expect(addMonths('2026-11-01', 1)).toBe('2026-12-01');
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
    expect(addMonths('2026-11-01', 12)).toBe('2027-11-01');
    expect(addMonths('2026-01-01', 0)).toBe('2026-01-01');
  });

  it('diffMonths calcula diferença', () => {
    expect(diffMonths('2026-11-01', '2027-10-01')).toBe(11);
    expect(diffMonths('2027-01-01', '2027-01-01')).toBe(0);
    expect(diffMonths('2027-03-01', '2027-01-01')).toBe(-2);
  });

  it('formatMonthLabel formata em pt-BR', () => {
    expect(formatMonthLabel('2027-03-01')).toBe('março/2027');
    expect(formatMonthLabel('2026-11-01')).toBe('novembro/2026');
  });
});

// ─── Geração de parcelas (manual) ───────────────────────────

describe('generateInstallments', () => {
  it('R$ 1.000,00 em 3x → 333,34 / 333,33 / 333,33 e soma = 1000,00', () => {
    const parcelas = generateInstallments({
      total_amount: 1000.00,
      installments_total: 3,
      installments_paid: 0,
      first_due_month: '2026-01-01',
    });

    expect(parcelas).toHaveLength(3);
    expect(parcelas[0].amount).toBe(333.34);
    expect(parcelas[1].amount).toBe(333.33);
    expect(parcelas[2].amount).toBe(333.33);

    const soma = parcelas.reduce((acc, p) => acc + Math.round(p.amount * 100), 0) / 100;
    expect(soma).toBe(1000.00);
  });

  it('1ª parcela em novembro, 12x → última em outubro do ano seguinte', () => {
    const parcelas = generateInstallments({
      total_amount: 1200.00,
      installments_total: 12,
      installments_paid: 0,
      first_due_month: '2026-11-01',
    });

    expect(parcelas).toHaveLength(12);
    expect(parcelas[0].due_month).toBe('2026-11-01');
    expect(parcelas[11].due_month).toBe('2027-10-01');
  });

  it('dívida com 3 de 10 pagas → parcelas 1-3 paid, 4-10 pending', () => {
    const parcelas = generateInstallments({
      total_amount: 1000.00,
      installments_total: 10,
      installments_paid: 3,
      first_due_month: '2026-01-01',
    });

    expect(parcelas).toHaveLength(10);
    for (let i = 0; i < 3; i++) expect(parcelas[i].status).toBe('paid');
    for (let i = 3; i < 10; i++) expect(parcelas[i].status).toBe('pending');
  });

  it('parcelamento de 1 parcela só', () => {
    const parcelas = generateInstallments({
      total_amount: 500.00,
      installments_total: 1,
      installments_paid: 0,
      first_due_month: '2026-06-01',
    });

    expect(parcelas).toHaveLength(1);
    expect(parcelas[0].amount).toBe(500.00);
    expect(parcelas[0].due_month).toBe('2026-06-01');
  });

  it('soma sempre bate com o total (valores com resto grande)', () => {
    const parcelas = generateInstallments({
      total_amount: 999.99,
      installments_total: 7,
      installments_paid: 0,
      first_due_month: '2026-01-01',
    });

    const soma = parcelas.reduce((acc, p) => acc + Math.round(p.amount * 100), 0) / 100;
    expect(soma).toBe(999.99);
  });
});

// ─── Processamento & Projeção de Transações ───────────────

describe('groupTransactionInstallments & buildPayoffProjection', () => {
  const sampleItems: RawInstallmentItem[] = [
    {
      txId: 'tx-1',
      description: 'LOJA XPTO PARC 03/10',
      cleanDescription: 'LOJA XPTO',
      alias: 'Geladeira',
      currentInstallment: 3,
      totalInstallments: 10,
      amount: 100.00,
      cardName: 'Visa Nubank',
      cardId: 'card-1',
      statementMonth: 3,
      statementYear: 2026,
    },
    {
      txId: 'tx-2',
      description: 'NETFLIX (2/12)',
      cleanDescription: 'NETFLIX',
      alias: null,
      currentInstallment: 2,
      totalInstallments: 12,
      amount: 49.90,
      cardName: 'Visa Nubank',
      cardId: 'card-1',
      statementMonth: 3,
      statementYear: 2026,
    },
  ];

  it('agrupa transações e calcula parcelas restantes', () => {
    const grouped = groupTransactionInstallments(sampleItems);
    expect(grouped).toHaveLength(2);

    const geladeira = grouped.find(g => g.cleanDescription === 'LOJA XPTO');
    expect(geladeira).toBeDefined();
    expect(geladeira!.remainingCount).toBe(7); // 10 - 3
    expect(geladeira!.totalRemaining).toBe(700.00);
  });

  it('projeção contém os meses corretos até o fim', () => {
    const grouped = groupTransactionInstallments(sampleItems);
    const projection = buildPayoffProjection(grouped, [], '2026-03-01');

    expect(projection.length).toBeGreaterThan(0);
    // Começa no próximo mês: 2026-04-01
    expect(projection[0].month).toBe('2026-04-01');
    expect(projection[0].totalDoMes).toBeGreaterThan(0);
  });

  it('zero dívidas → sem crash, retorna array vazio', () => {
    const projection = buildPayoffProjection([], []);
    expect(projection).toEqual([]);
  });

  it('encerram identifica dívida que termina no mês', () => {
    const items: RawInstallmentItem[] = [
      {
        txId: 'tx-short',
        description: 'COMPRA PARC 02/02',
        cleanDescription: 'COMPRA',
        alias: 'Magalu',
        currentInstallment: 1,
        totalInstallments: 2,
        amount: 200.00,
        cardName: 'Visa',
        cardId: 'card-1',
        statementMonth: 7,
        statementYear: 2026,
      },
    ];

    const grouped = groupTransactionInstallments(items);
    const projection = buildPayoffProjection(grouped, [], '2026-07-01');

    // Última parcela em 2026-09-01 (7 + (2-1)) = ago/2026
    const lastProj = projection.find(p => p.encerram.length > 0);
    expect(lastProj).toBeDefined();
    expect(lastProj!.encerram[0].cleanDescription).toBe('COMPRA');
    expect(lastProj!.alivio).toBe(200.00);
  });

  it('capAmount aparece na projeção e faturaPrevista é calculada', () => {
    const grouped = groupTransactionInstallments(sampleItems);
    const caps: CapRow[] = [
      { card_id: 'card-1', month: '2026-04-01', cap_amount: 500.00 },
    ];

    const projection = buildPayoffProjection(grouped, caps, '2026-03-01');
    const apr = projection.find(p => p.month === '2026-04-01');
    expect(apr).toBeDefined();
    expect(apr!.capAmount).toBe(500.00);
    expect(apr!.faturaPrevista).toBe(apr!.totalDoMes + 500.00);
  });
});

// ─── Resumo do Plano de Quitação ─────────────────────────────

describe('computePayoffSummary', () => {
  it('zero dívidas → sem crash, mensagem de estado vazio', () => {
    const summary = computePayoffSummary([]);
    expect(summary.dividaTotalRestante).toBe(0);
    expect(summary.mesLiberdade).toBeNull();
    expect(summary.mesesRestantes).toBe(0);
    expect(summary.compromissoEsteMes).toBe(0);
    expect(summary.totalParcelamentosAtivos).toBe(0);
  });

  it('calcula resumo com transações agrupadas', () => {
    const items: RawInstallmentItem[] = [
      {
        txId: 'tx-1',
        description: 'CURSO PARC 03/10',
        cleanDescription: 'CURSO',
        alias: 'Udemy',
        currentInstallment: 3,
        totalInstallments: 10,
        amount: 100.00,
        cardName: 'Visa',
        cardId: 'card-1',
        statementMonth: 3,
        statementYear: 2026,
      },
    ];

    const grouped = groupTransactionInstallments(items);
    const summary = computePayoffSummary(grouped, '2026-03-01');

    expect(summary.totalParcelamentosAtivos).toBe(1);
    expect(summary.dividaTotalRestante).toBe(700.00); // 7 * 100
    expect(summary.compromissoEsteMes).toBe(100.00);
    expect(summary.mesesRestantes).toBe(7);
  });
});

// ─── Parser de linhas de fatura ─────────────────────────────

describe('parseBulkLines', () => {
  it('parse formato: 12/03  PAG*LOJADOJOAO 4829 PARC 03/10   R$ 189,90', () => {
    const lines = parseBulkLines('12/03  PAG*LOJADOJOAO 4829 PARC 03/10   R$ 189,90');

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.installment_current).toBe(3);
    expect(line.installment_total).toBe(10);
    expect(line.amount).toBe(189.90);
    expect(line.cleaned_description).not.toContain('PAG*');
    expect(line.cleaned_description).not.toContain('4829');
    expect(line.cleaned_description).not.toContain('PARC');
    expect(line.confidence).toBe('high');
  });

  it('parse formato: 12/03 - MP *ASSINATURA (2/12) - 49,90', () => {
    const lines = parseBulkLines('12/03 - MP *ASSINATURA (2/12) - 49,90');

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.installment_current).toBe(2);
    expect(line.installment_total).toBe(12);
    expect(line.amount).toBe(49.90);
    expect(line.cleaned_description).not.toContain('MP *');
  });

  it('parse formato: LOJA XPTO 3/10 189,90', () => {
    const lines = parseBulkLines('LOJA XPTO 3/10 189,90');

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.installment_current).toBe(3);
    expect(line.installment_total).toBe(10);
    expect(line.amount).toBe(189.90);
  });

  it('múltiplas linhas', () => {
    const text = `12/03  PAG*LOJADOJOAO 4829 PARC 03/10   R$ 189,90
12/03 - MP *ASSINATURA (2/12) - 49,90
LOJA XPTO 3/10 189,90`;

    const lines = parseBulkLines(text);
    expect(lines).toHaveLength(3);
    expect(lines.every(l => l.amount !== null)).toBe(true);
  });

  it('linha sem info → confidence low', () => {
    const lines = parseBulkLines('alguma coisa sem formato');
    expect(lines).toHaveLength(1);
    expect(lines[0].confidence).toBe('low');
    expect(lines[0].amount).toBeNull();
    expect(lines[0].installment_current).toBeNull();
  });
});

describe('cleanDescription', () => {
  it('remove prefixo PAG*', () => {
    expect(cleanDescription('PAG*LOJADOJOAO')).toBe('LOJADOJOAO');
  });

  it('remove prefixo MP *', () => {
    expect(cleanDescription('MP *ASSINATURA')).toBe('ASSINATURA');
  });

  it('remove códigos numéricos soltos de 4+ dígitos', () => {
    expect(cleanDescription('LOJA 4829 TESTE')).toBe('LOJA TESTE');
  });

  it('remove sufixo PARC 03/10', () => {
    expect(cleanDescription('LOJA PARC 03/10')).toBe('LOJA');
  });

  it('remove sufixo (2/12)', () => {
    const result = cleanDescription('ASSINATURA (2/12)');
    expect(result).not.toContain('(2/12)');
    expect(result).toContain('ASSINATURA');
  });
});

describe('extractInstallmentInfo', () => {
  it('PARC 03/10', () => {
    const result = extractInstallmentInfo('LOJA PARC 03/10 R$ 100,00');
    expect(result).toEqual({ current: 3, total: 10 });
  });

  it('(2/12)', () => {
    const result = extractInstallmentInfo('ASSINATURA (2/12) 49,90');
    expect(result).toEqual({ current: 2, total: 12 });
  });

  it('3/10 no final', () => {
    const result = extractInstallmentInfo('LOJA XPTO 3/10 189,90');
    expect(result).toEqual({ current: 3, total: 10 });
  });

  it('sem parcela → null', () => {
    expect(extractInstallmentInfo('COMPRA AVULSA 100,00')).toBeNull();
  });
});

describe('extractAmount', () => {
  it('R$ 189,90', () => {
    expect(extractAmount('LOJA R$ 189,90')).toBe(189.90);
  });

  it('R$ 1.189,90 (com ponto de milhar)', () => {
    expect(extractAmount('LOJA R$ 1.189,90')).toBe(1189.90);
  });

  it('49,90 no final (sem R$)', () => {
    expect(extractAmount('ASSINATURA (2/12) - 49,90')).toBe(49.90);
  });

  it('sem valor → null', () => {
    expect(extractAmount('COMPRA SEM VALOR')).toBeNull();
  });
});
