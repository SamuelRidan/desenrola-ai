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
REGRAS DE EXTRAÇÃO DE TRANSAÇÕES
═══════════════════════════════════════
EXTRAIA APENAS transações que aparecem na LISTA DE TRANSAÇÕES/LANÇAMENTOS:
✅ Compras nacionais e internacionais (valor em REAIS)
✅ Parcelas individuais de compras parceladas
✅ Assinaturas (streaming, apps, etc.)
✅ Seguros e anuidade do cartão
✅ Juros rotativos / juros de financiamento (lançamento individual na lista de transações)
✅ IOF (lançamento individual na lista de transações)
✅ Multa por atraso (lançamento individual)
✅ Saques / empréstimos no cartão
✅ Estornos / devoluções / créditos (valor NEGATIVO — use amount negativo, ex: -150.00)

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

═══════════════════════════════════════
VALIDAÇÃO OBRIGATÓRIA
═══════════════════════════════════════
A fórmula do valor total da fatura é:
Total = Saldo financiado + Juros + IOF + Compras

Antes de responder, VALIDE:
1. Localize o "TOTAL A PAGAR" no documento.
2. Calcule: saldo_anterior + soma das transações extraídas ≈ Total a pagar
3. Se houver discrepância > 1%, revise. Provavelmente você incluiu pagamentos/créditos indevidos ou errou o saldo_anterior.

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
      "type": "<tipo>"
    }
  ]
}

Categorias válidas: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Moradia", "Assinatura", "Juros/Encargos", "Pagamento", "Estorno", "Outros"
Tipos válidos: "purchase" (compras/débitos — valor positivo), "interest" (juros/IOF/multa/encargos — valor positivo), "refund" (estornos/devoluções — valor NEGATIVO)

ATENÇÃO: NÃO use type "payment". Pagamentos da fatura anterior já estão refletidos no saldo_anterior.
Se não souber a data exata de um lançamento, use o primeiro dia do mês da fatura.

═══════════════════════════════════════
EXTRAÇÃO DA TAXA DE JUROS
═══════════════════════════════════════
PROCURE no documento informações sobre a taxa de juros mensal cobrada pelo cartão. Estas geralmente aparecem em seções como:
- "Encargos rotativos", "Taxa de juros", "CET mensal", "Taxa de financiamento"
- "Juros remuneratórios", "Taxa mensal"
- Exemplo: "Taxa de juros mensal: 14,90%" → retorne 14.90
- Exemplo: "Taxa rotativo: 15,99% a.m." → retorne 15.99

Se encontrar múltiplas taxas de juros (rotativo, parcelado, etc.), use a TAXA DO CRÉDITO ROTATIVO (maior taxa, geralmente).
Se NÃO encontrar taxa de juros no documento, retorne null para taxa_juros_mensal.

IMPORTANTE: O valor deve ser a taxa PERCENTUAL mensal (ex: 14.90 para 14,90% ao mês). NÃO converta para decimal.`;

const USER_MESSAGE = "Extraia todos os lançamentos desta fatura de cartão de crédito. IMPORTANTE: (1) Use o SALDO FINANCIADO como saldo_anterior (fatura anterior - pagamento), NÃO o valor total da fatura anterior. (2) NÃO inclua pagamentos da fatura anterior nem créditos de rotativo como transações. (3) Inclua APENAS compras e juros/IOF individuais da lista de transações.";
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

    // Read file content as text
    let fileContent = "";
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
      fileContent = `[PDF file content in base64 - the AI model will process this as a document]`;

      // Use multimodal AI call for PDF
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{
              role: "user",
              parts: [
                { text: USER_MESSAGE },
                { inlineData: { mimeType: "application/pdf", data: base64 } }
              ]
            }]
          }),
        }
      );

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
      fileContent = await fileData.text();

      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{
              role: "user",
              parts: [
                { text: `${USER_MESSAGE}\n\n${fileContent}` }
              ]
            }]
          }),
        }
      );

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

    // ── Deduplication: remove exact duplicates (same description + same amount + same date + same type) ──
    const seen = new Set<string>();
    const deduplicated: any[] = [];
    for (const t of transactions) {
      const key = `${t.date}|${(t.description || "").trim().toUpperCase()}|${Math.abs(Number(t.amount)).toFixed(2)}|${t.type || "purchase"}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(t);
      } else {
        console.log("Removed duplicate:", key);
      }
    }
    transactions = deduplicated;

    // ── Validation: check saldo_anterior + transactions ≈ total_fatura ──
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

    // Fetch known aliases for these descriptions
    const uniqueDescriptions = [...new Set(transactions.map((t: any) => t.description).filter(Boolean))];
    const { data: knownData, error: knownError } = await adminClient
      .from("transactions")
      .select("description, alias")
      .in("description", uniqueDescriptions)
      .not("alias", "is", null);

    if (knownError) {
      console.warn("Could not fetch known aliases:", knownError);
    }

    const aliasMap = new Map<string, string>();
    if (knownData) {
      for (const row of knownData) {
        if (row.alias) {
          aliasMap.set(row.description, row.alias);
        }
      }
    }

    // Insert transactions
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
        alias: aliasMap.get(t.description) || null,
        category: t.category || null,
        type: type === "refund" ? "purchase" : type, // store as purchase with negative amount
        is_reviewed: false,
      };
    });

    const { error: insertError } = await adminClient
      .from("transactions")
      .insert(transactionsToInsert);

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
