import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Você é um especialista em extrair lançamentos de faturas de cartão de crédito brasileiro. Sua tarefa é extrair os dados com PRECISÃO ABSOLUTA.

═══════════════════════════════════════
COMO INTERPRETAR O RESUMO DA FATURA
═══════════════════════════════════════
O resumo da fatura brasileira geralmente mostra:
- "Fatura anterior": valor total da fatura do mês passado
- "Pagamento recebido": quanto o cliente pagou da fatura anterior
- "Saldo financiado" / "Saldo restante": fatura anterior MENOS pagamento recebido
- "Juros de financiamento": juros sobre o saldo financiado
- "IOF de financiamento": imposto sobre o financiamento
- "Total de compras": soma de todas as compras novas do período
- "Total a pagar" / "Valor da fatura": o valor final que o cliente deve pagar

IMPORTANTE SOBRE O SALDO ANTERIOR:
- O "saldo_anterior" que você deve retornar é o SALDO FINANCIADO (saldo restante após pagamento), NÃO o valor total da "fatura anterior".
- Fórmula: saldo_anterior = Fatura anterior - Pagamento recebido
- Se a fatura mostrar "Saldo financiado: R$ 1.584,72", use 1584.72 como saldo_anterior.
- Se não houver "Saldo financiado" explícito, calcule: Fatura anterior - Pagamento recebido.
- Se não houver saldo anterior ou fatura anterior, use 0.

═══════════════════════════════════════
IDENTIFICAÇÃO DO RESPONSÁVEL (TITULAR/DEPENDENTE)
═══════════════════════════════════════
Faturas de cartão de crédito brasileiro frequentemente agrupam as transações por RESPONSÁVEL (titular e dependentes/adicionais).
Cada seção de responsável geralmente aparece como um cabeçalho no formato:
- "1 - NOME COMPLETO" ou "NOME COMPLETO" antes das transações daquela pessoa
- "2 - NOME DEPENDENTE"
- "3 - OUTRO DEPENDENTE"
- Ou variações como "Titular: NOME", "Dependente: NOME", "Cartão adicional: NOME"

REGRAS PARA CAPTURA DO RESPONSÁVEL:
1. Identifique os CABEÇALHOS que agrupam transações por pessoa.
2. Para CADA transação, atribua o campo "card_holder" com o NOME DO RESPONSÁVEL sob o qual a transação aparece.
3. Use APENAS o nome da pessoa, SEM o número de prefixo. Exemplo: se o cabeçalho é "1 - SAMUEL SOUZA RIDAN", use "SAMUEL SOUZA RIDAN".
4. Se a fatura NÃO tiver agrupamento por responsável (todas as transações sob um único titular), use null para card_holder.
5. Se aparecerem categorias ("Restaurantes", "Supermercados", "Saúde", etc.) dentro de uma seção de responsável, mantenha o responsável daquela seção, a categoria é apenas um sub-agrupamento.
6. NÃO confunda nomes de categorias ("Alimentação", "Lazer", "Serviços") com nomes de responsáveis.

═══════════════════════════════════════
REGRAS DE EXTRAÇÃO DE TRANSAÇÕES
═══════════════════════════════════════

⚠️ REGRA FUNDAMENTAL: EXTRAIA **ABSOLUTAMENTE TODOS** OS LANÇAMENTOS ⚠️
É OBRIGATÓRIO extrair cada linha de lançamento que apareça na fatura. NÃO omita NENHUM lançamento, independente do valor (mesmo R$ 0,01). A contagem de lançamentos extraídos DEVE corresponder exatamente à contagem de linhas na fatura.

EXTRAIA APENAS transações que aparecem na LISTA DE TRANSAÇÕES/LANÇAMENTOS:
✅ Compras nacionais e internacionais (valor em REAIS)
✅ Parcelas individuais de compras parceladas (CADA parcela é um lançamento separado)
✅ Assinaturas (streaming, apps, etc.)
✅ Seguros e anuidade do cartão
✅ Juros rotativos / juros de financiamento (lançamento individual na lista de transações)
✅ IOF (lançamento individual na lista de transações)
✅ Multa por atraso (lançamento individual)
✅ Saques / empréstimos no cartão
✅ Estornos / devoluções / créditos (valor NEGATIVO — use amount negativo, ex: -150.00)
✅ Lançamentos de TODAS as pessoas/titulares/dependentes do cartão

NÃO EXTRAIA como transações:
❌ "Pagamento recebido" / "Pagamento em DD/MM" — estes são pagamentos da fatura ANTERIOR, já refletidos no saldo financiado
❌ "Crédito de rotativo" / "Crédito de financiamento" — é uma entrada técnica contábil, NÃO é transação real
❌ Linhas de resumo, totais, subtotais
❌ "Saldo anterior" / "Fatura anterior"
❌ Seção "Demonstrativo de encargos" (informativa)
❌ CET, taxas informativas, limites de crédito
❌ Estornos que já estão descontados do total em uma linha de subtotal (mas EXTRAIA estornos individuais com valor NEGATIVO)

REGRAS ANTI-DUPLICAÇÃO:
1. Juros e IOF: extraia APENAS da lista de transações, NUNCA do resumo.
2. Se o mesmo valor aparecer no resumo E na lista de transações, extraia APENAS da lista.
3. NUNCA extraia subtotais como "Total de compras", "Total de encargos".
4. Se houver lançamentos LEGÍTIMOS repetidos (mesma loja, mesmo valor, mesmo dia), extraia TODOS eles — NÃO descarte como duplicata.

═══════════════════════════════════════
VALIDAÇÃO OBRIGATÓRIA
═══════════════════════════════════════
A fórmula do valor total da fatura é:
Total = Saldo financiado + Juros + IOF + Compras

Antes de responder, VALIDE:
1. Localize o "TOTAL A PAGAR" no documento.
2. Calcule: saldo_anterior + soma das transações extraídas ≈ Total a pagar
3. Se houver discrepância > 1%, revise. Provavelmente você OMITIU lançamentos ou incluiu pagamentos/créditos indevidos.
4. CONTE o número de lançamentos no documento e compare com o número de transações extraídas. Se faltam transações, REVISE e extraia os faltantes.

═══════════════════════════════════════
EXTRAÇÃO DA TAXA DE JUROS
═══════════════════════════════════════
Se a fatura contiver informações sobre taxa de juros mensal (ex: "Taxa de juros mensal: 14,90%", "CET mensal: 16,50%", "Juros rotativos: 14,90% a.m."):
- Extraia o valor percentual MENSAL como número (ex: 14.90 para 14,90%)
- Use o campo "taxa_juros_mensal" no JSON
- Se houver mais de uma taxa, use a taxa de juros rotativos/financiamento
- Se não encontrar nenhuma taxa, retorne null

═══════════════════════════════════════
FORMATO DE RESPOSTA
═══════════════════════════════════════
Responda APENAS com um JSON object válido (sem markdown, sem backticks):
{
  "total_fatura": <número com o total a pagar como impresso no documento, ou null>,
  "saldo_anterior": <número com o SALDO FINANCIADO (fatura anterior - pagamento recebido), ou 0>,
  "fatura_anterior": <número com o valor da fatura anterior, ou 0>,
  "pagamento_anterior": <número com o pagamento recebido da fatura anterior, ou 0>,
  "taxa_juros_mensal": <número com a taxa de juros mensal em percentual (ex: 14.90 para 14,90%), ou null se não encontrada>,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "<descrição ORIGINAL como aparece na fatura>",
      "amount": <valor numérico — positivo para compras/juros, NEGATIVO para estornos/devoluções>,
      "category": "<categoria>",
      "type": "<tipo>",
      "card_holder": "<NOME DO RESPONSÁVEL que aparece como cabeçalho da seção, ou null se não houver agrupamento>"
    }
  ]
}

Categorias válidas: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Moradia", "Assinatura", "Juros/Encargos", "Pagamento", "Estorno", "Outros"
Tipos válidos: "purchase" (compras/débitos — valor positivo), "interest" (juros/IOF/multa/encargos — valor positivo), "refund" (estornos/devoluções — valor NEGATIVO)

ATENÇÃO: NÃO use type "payment". Pagamentos da fatura anterior já estão refletidos no saldo_anterior.
Se não souber a data exata de um lançamento, use o primeiro dia do mês da fatura.`;

const USER_MESSAGE = `Analise esta fatura de cartão de crédito e extraia ABSOLUTAMENTE TODOS os lançamentos. 

ATENÇÃO: É OBRIGATÓRIO extrair CADA lançamento individual que aparece na fatura, sem omitir nenhum. Isso inclui lançamentos de TODOS os titulares e dependentes do cartão.

Se a fatura tiver seções separadas por responsável (titular/dependente), identifique o card_holder de cada seção e atribua corretamente a cada lançamento.

Retorne o JSON completo conforme o formato especificado nas instruções.`;

/**
 * Normalizes an installment description by stripping the installment suffix.
 * E.g. "AMAZON PARC 03/12" → "AMAZON"
 *      "Mp *37551516silva - Parcela 1/10" → "Mp *37551516silva"
 * Returns null if the description is NOT an installment.
 */
function normalizeInstallmentDesc(description: string): string | null {
  // 1. Match "PARC", "PARCELA", "Parcela", "PARC." followed by XX/YY or XX DE YY
  const match = description.match(/^(.*?)\s*[-–]?\s*\bPARC(?:ELA)?\.?\s*\d{1,2}\s*(?:\/|DE)\s*\d{1,2}\b(.*)$/i);
  if (match) {
    const cleaned = (match[1] + " " + match[2]).replace(/\s+/g, " ").trim();
    return cleaned && cleaned.length >= 8 ? cleaned : null;
  }
  // 2. Fallback: XX/YY at the end (only if it looks like installments, not dates)
  const endMatch = description.match(/^(.*?)\s*[-–]?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\s*$/i);
  if (endMatch) {
    const current = parseInt(endMatch[2], 10);
    const total = parseInt(endMatch[3], 10);
    if (total > 1 && current <= total && current >= 1 && total <= 72) {
      const cleaned = endMatch[1].trim();
      return cleaned && cleaned.length >= 8 ? cleaned : null;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado (Falta authHeader)" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    // Verify caller is admin
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error("Missing env vars:", { url: !!supabaseUrl, srk: !!serviceRoleKey, anon: !!anonKey });
      return new Response(JSON.stringify({ error: "Erro de configuração do servidor local" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      supabaseUrl,
      anonKey,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user: caller },
    } = await userClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Token não autorizado" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Acesso negado: Você não é admin na user_roles" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { statement_id, file_path } = await req.json();

    if (!statement_id || !file_path) {
      return new Response(
        JSON.stringify({ error: "statement_id e file_path são obrigatórios" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update statement status to processing
    await adminClient
      .from("statements")
      .update({ status: "processing" })
      .eq("id", statement_id);

    // Download the file from storage
    const { data: fileData, error: downloadError } = await adminClient.storage
      .from("statements")
      .download(file_path);

    if (downloadError || !fileData) {
      await adminClient
        .from("statements")
        .update({ status: "error" })
        .eq("id", statement_id);
      return new Response(
        JSON.stringify({
          error: "Erro ao baixar arquivo: " + (downloadError?.message || "arquivo não encontrado"),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Gemini API configuration for reliable extraction
    const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;
    const generationConfig = {
      temperature: 0,
    };

    // Read file content
    const fileName = file_path.toLowerCase();

    if (fileName.endsWith(".pdf")) {
      // For PDFs, convert to base64 and send to AI as a document
      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      const CHUNK_SIZE = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const base64 = btoa(binary);

      // Use multimodal AI call for PDF
      const aiResponse = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig,
          contents: [{
            role: "user",
            parts: [
              { text: USER_MESSAGE },
              { inlineData: { mimeType: "application/pdf", data: base64 } }
            ]
          }]
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        await adminClient
          .from("statements")
          .update({ status: "error" })
          .eq("id", statement_id);

        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: "Créditos de IA insuficientes." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: `Erro ao processar com IA: ${errText}` }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const aiData = await aiResponse.json();
      const content = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return await processAIResponse(
        content,
        statement_id,
        adminClient,
        corsHeaders
      );
    } else {
      // For text/CSV files
      const fileContent = await fileData.text();

      const aiResponse = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig,
          contents: [{
            role: "user",
            parts: [
              { text: `${USER_MESSAGE}\n\n${fileContent}` }
            ]
          }]
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        await adminClient
          .from("statements")
          .update({ status: "error" })
          .eq("id", statement_id);

        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: "Créditos de IA insuficientes." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: `Erro ao processar com IA: ${errText}` }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const aiData = await aiResponse.json();
      const content = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return await processAIResponse(
        content,
        statement_id,
        adminClient,
        corsHeaders
      );
    }
  } catch (err) {
    console.error("parse-statement error:", err);
    return new Response(
      JSON.stringify({ error: `Erro interno no bloco principal: ${(err as Error).message || err}` }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function processAIResponse(
  content: string,
  statementId: string,
  adminClient: any,
  corsHeaders: Record<string, string>
) {
  try {
    // Clean the response - remove markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(cleanContent);

    // Support both new format {total_fatura, transactions} and old format [array]
    let transactions: any[];
    let totalFatura: number | null = null;
    let saldoAnterior: number = 0;
    let taxaJurosMensal: number | null = null;

    if (Array.isArray(parsed)) {
      transactions = parsed;
    } else if (parsed && Array.isArray(parsed.transactions)) {
      transactions = parsed.transactions;
      totalFatura = parsed.total_fatura != null ? Number(parsed.total_fatura) : null;
      saldoAnterior = parsed.saldo_anterior != null ? Number(parsed.saldo_anterior) : 0;
      taxaJurosMensal = parsed.taxa_juros_mensal != null ? Number(parsed.taxa_juros_mensal) : null;
    } else {
      await adminClient
        .from("statements")
        .update({ status: "error" })
        .eq("id", statementId);
      return new Response(
        JSON.stringify({
          error: "Formato de resposta inválido da IA",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (transactions.length === 0) {
      await adminClient
        .from("statements")
        .update({ status: "error" })
        .eq("id", statementId);
      return new Response(
        JSON.stringify({
          error: "Nenhum lançamento encontrado na fatura",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[parse-statement] AI returned ${transactions.length} transactions`);

    // —— Deduplication: remove only TRUE duplicates (AI hallucinated repeats) ——
    // We allow legitimate repeated transactions (same store/amount/date) by tracking
    // how many times each key appears in the original list vs how many we've kept.
    const keyCount = new Map<string, number>();
    const keptCount = new Map<string, number>();
    
    for (const t of transactions) {
      const key = `${t.date}|${(t.description || "").trim().toUpperCase()}|${Math.abs(Number(t.amount)).toFixed(2)}|${t.type || "purchase"}|${(t.card_holder || "").toUpperCase()}`;
      keyCount.set(key, (keyCount.get(key) || 0) + 1);
    }

    // Only deduplicate if the same key appears 3+ times (very likely AI hallucination)
    // Keep up to 2 identical transactions (legitimate repeats do happen)
    const MAX_IDENTICAL = 2;
    const deduplicated: any[] = [];
    for (const t of transactions) {
      const key = `${t.date}|${(t.description || "").trim().toUpperCase()}|${Math.abs(Number(t.amount)).toFixed(2)}|${t.type || "purchase"}|${(t.card_holder || "").toUpperCase()}`;
      const total = keyCount.get(key) || 0;
      const kept = keptCount.get(key) || 0;
      
      if (total <= MAX_IDENTICAL || kept < MAX_IDENTICAL) {
        deduplicated.push(t);
        keptCount.set(key, kept + 1);
      } else {
        console.log(`[Dedup] Removed likely AI duplicate: ${key}`);
      }
    }
    
    if (deduplicated.length < transactions.length) {
      console.log(`[Dedup] Removed ${transactions.length - deduplicated.length} likely AI duplicates, kept ${deduplicated.length}`);
    }
    transactions = deduplicated;

    // —— Validation: check saldo_anterior + transactions ≈ total_fatura ——
    if (totalFatura != null && totalFatura > 0) {
      let sumPurchases = 0;
      let sumInterest = 0;
      let sumRefunds = 0;
      for (const t of transactions) {
        const amt = Number(t.amount);
        const type = t.type || "purchase";
        if (type === "interest") sumInterest += Math.abs(amt);
        else if (type === "refund" || amt < 0) sumRefunds += Math.abs(amt);
        else sumPurchases += Math.abs(amt);
      }
      const calculatedTotal = saldoAnterior + sumPurchases + sumInterest - sumRefunds;
      const diff = Math.abs(calculatedTotal - totalFatura);
      const pctDiff = totalFatura > 0 ? (diff / totalFatura) * 100 : 0;
      console.log(`Validation: total_fatura=${totalFatura}, saldo_anterior=${saldoAnterior}, calculated=${calculatedTotal.toFixed(2)}, diff=${diff.toFixed(2)} (${pctDiff.toFixed(1)}%)`);
      console.log(`  Purchases: ${sumPurchases.toFixed(2)}, Interest: ${sumInterest.toFixed(2)}, Refunds: ${sumRefunds.toFixed(2)}`);
    }

    // Delete any existing transactions for this statement (reprocessing)
    await adminClient
      .from("transactions")
      .delete()
      .eq("statement_id", statementId);

    // Insert transactions (aliases are not carried over — users set them manually)
    const validTypes = ["purchase", "payment", "interest", "refund"];
    const transactionsToInsert = transactions.map((t: any) => {
      const type = validTypes.includes(t.type) ? t.type : "purchase";
      const rawAmount = Number(t.amount);
      // Preserve negative amounts for refunds/chargebacks, use abs for others
      const amount = type === "refund" ? -Math.abs(rawAmount) : (rawAmount < 0 ? rawAmount : Math.abs(rawAmount));
      return {
        statement_id: statementId,
        date: t.date,
        description: t.description,
        amount,
        alias: null,
        category: t.category || null,
        type: type === "refund" ? "purchase" : type, // store as purchase with negative amount
        is_reviewed: false,
        card_holder: t.card_holder || null,
      };
    });

    console.log(`[parse-statement] Inserting ${transactionsToInsert.length} transactions`);

    const { data: insertedData, error: insertError } = await adminClient
      .from("transactions")
      .insert(transactionsToInsert)
      .select("id, description");

    if (insertError) {
      console.error("Insert error:", insertError);
      await adminClient
        .from("statements")
        .update({ status: "error" })
        .eq("id", statementId);
      return new Response(
        JSON.stringify({
          error: "Erro ao salvar transações: " + insertError.message,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update statement status to completed with totals
    await adminClient
      .from("statements")
      .update({ status: "completed", previous_balance: saldoAnterior, total_fatura: totalFatura || 0 })
      .eq("id", statementId);

    // Update credit card interest rate if extracted from statement
    if (taxaJurosMensal != null && taxaJurosMensal > 0) {
      // Get the card_id from the statement
      const { data: stmtData } = await adminClient
        .from("statements")
        .select("card_id")
        .eq("id", statementId)
        .single();

      if (stmtData?.card_id) {
        await adminClient
          .from("credit_cards")
          .update({ interest_rate: taxaJurosMensal })
          .eq("id", stmtData.card_id);
        console.log(`Updated interest_rate for card ${stmtData.card_id}: ${taxaJurosMensal}%`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: transactionsToInsert.length,
        total_fatura: totalFatura,
        previous_balance: saldoAnterior,
        interest_rate: taxaJurosMensal,
        transactions: transactionsToInsert,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (parseErr) {
    console.error("Parse error:", parseErr, "Content:", content);
    await adminClient
      .from("statements")
      .update({ status: "error" })
      .eq("id", statementId);
    return new Response(
      JSON.stringify({
        error: `Erro ao interpretar resposta da IA: ${parseErr}`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
