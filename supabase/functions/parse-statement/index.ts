import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    // Verify caller is admin
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      console.error("Missing env vars:", { url: !!supabaseUrl, srk: !!serviceRoleKey, anon: !!anonKey });
      return new Response(JSON.stringify({ error: "Erro de configuração do servidor" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
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
      return new Response(JSON.stringify({ error: "Acesso negado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { statement_id, file_path } = await req.json();

    if (!statement_id || !file_path) {
      return new Response(
        JSON.stringify({ error: "statement_id e file_path são obrigatórios" }),
        {
          status: 400,
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
          status: 400,
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
      const base64 = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      );
      fileContent = `[PDF file content in base64 - the AI model will process this as a document]`;

      // Use multimodal AI call for PDF
      const aiResponse = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `Você é um especialista em extrair lançamentos de faturas de cartão de crédito brasileiro. Sua tarefa é extrair os dados com PRECISÃO ABSOLUTA, garantindo que a soma dos lançamentos bata exatamente com o valor total da fatura.

═══════════════════════════════════════
ESTRUTURA TÍPICA DE UMA FATURA BRASILEIRA
═══════════════════════════════════════
Uma fatura de cartão de crédito brasileiro geralmente contém:
- RESUMO DA FATURA: total anterior, pagamento anterior, novas compras, encargos, total atual — ESTES SÃO RESUMOS, NÃO LANÇAMENTOS.
- LANÇAMENTOS DE COMPRAS: lista detalhada de cada compra com data, descrição e valor.
- ENCARGOS FINANCEIROS: juros rotativos, IOF, multa, mora — aparecem como lançamentos individuais.
- PAGAMENTOS: pagamentos efetuados no período.

═══════════════════════════════════════
REGRAS ANTI-DUPLICAÇÃO (CRÍTICO!)
═══════════════════════════════════════
1. JUROS e ENCARGOS: Extraia APENAS os lançamentos INDIVIDUAIS de juros/encargos que aparecem na lista de transações. 
   - NÃO extraia da seção de "Resumo" ou "Demonstrativo de encargos". Essas seções são INFORMATIVAS e duplicam os valores já listados nas transações.
   - Se a fatura listar "JUROS ROTATIVOS R$ 50,00" na seção de transações E TAMBÉM mostrar "Encargos: R$ 50,00" no resumo, extraia APENAS UMA VEZ (a da seção de transações).
   - Se houver um "DEMONSTRATIVO DE ENCARGOS" detalhando CET, taxas mensais/anuais, etc., isso é INFORMATIVO — NÃO são transações.
   
2. IOF: O IOF geralmente aparece como lançamento separado na lista de transações. Extraia-o UMA ÚNICA VEZ.
   - Se o IOF aparecer tanto no resumo quanto nas transações, use APENAS o das transações.

3. SUBTOTAIS e TOTAIS: NUNCA extraia linhas que representam:
   - "Total da fatura", "Total geral", "Valor total", "Total a pagar"
   - "Subtotal compras nacionais", "Subtotal compras internacionais"  
   - "Saldo anterior", "Saldo da fatura anterior"
   - "Total de encargos financeiros" (é um subtotal)
   - "Créditos/Débitos" (quando é um subtotal de seção)
   
4. SALDO ANTERIOR: NUNCA inclua o saldo anterior como transação. Ele é apenas referência.

5. PARCELAMENTOS: Cada parcela individual que aparece na fatura é UM lançamento. NÃO duplique.
   - Se aparecer "LOJA X PARCELA 3/10 R$50,00", isso é UMA transação de R$50,00.

═══════════════════════════════════════
O QUE EXTRAIR
═══════════════════════════════════════
✅ Compras nacionais (lojas, restaurantes, combustível, etc.)
✅ Compras internacionais (usar o valor em REAIS quando disponível)
✅ Parcelas individuais de compras parceladas
✅ Assinaturas (streaming, apps, etc.)
✅ Seguros e anuidade do cartão
✅ Juros rotativos (lançamento individual, NÃO do resumo)
✅ IOF (lançamento individual, NÃO do resumo)
✅ Multa por atraso (lançamento individual)
✅ Pagamento efetuado / crédito em conta
✅ Estornos / devoluções (como payment)
✅ Saques / empréstimos no cartão

O QUE NÃO EXTRAIR
❌ Linhas de resumo / sumário da fatura
❌ Linhas de "Total" ou "Subtotal"
❌ "Saldo anterior" / "Saldo da fatura anterior"
❌ Seção "Demonstrativo de encargos" (é informativa)
❌ CET (Custo Efetivo Total) — é informativo
❌ Taxas informativas (taxa mensal, taxa anual)
❌ Limites de crédito, limite disponível

═══════════════════════════════════════
VALIDAÇÃO OBRIGATÓRIA
═══════════════════════════════════════
Antes de responder, VALIDE:
1. Localize o "TOTAL DA FATURA" ou "VALOR A PAGAR" no documento.
2. Calcule: Total de compras + encargos - pagamentos = deve ser ≈ Total da fatura.
3. Se houver discrepância > 1%, revise os lançamentos antes de responder.

═══════════════════════════════════════
FORMATO DE RESPOSTA
═══════════════════════════════════════
Responda APENAS com um JSON object válido (sem markdown, sem backticks):
{
  "total_fatura": <número com o total da fatura/valor a pagar como impresso no documento, ou null se não encontrado>,
  "saldo_anterior": <número com o saldo anterior/valor da fatura anterior que ficou em aberto, ou 0 se não houver ou não encontrado>,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "<descrição ORIGINAL como aparece na fatura>",
      "amount": <valor numérico positivo, use ponto como separador decimal>,
      "category": "<categoria>",
      "type": "<tipo>"
    }
  ]
}

Categorias válidas: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Moradia", "Assinatura", "Juros/Encargos", "Pagamento", "Outros"
Tipos válidos: "purchase" (compras/débitos), "payment" (pagamentos/créditos/estornos), "interest" (juros/IOF/multa/encargos)

Se não souber a data exata de um lançamento, use o primeiro dia do mês da fatura.`,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extraia todos os lançamentos desta fatura de cartão de crédito. Lembre-se: NÃO duplique juros/encargos que aparecem tanto no resumo quanto na lista de transações. Extraia APENAS da lista de transações.",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:application/pdf;base64,${base64}`,
                    },
                  },
                ],
              },
            ],
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
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: "Créditos de IA insuficientes." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: "Erro ao processar com IA" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "";

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
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `Você é um especialista em extrair lançamentos de faturas de cartão de crédito brasileiro. Sua tarefa é extrair os dados com PRECISÃO ABSOLUTA, garantindo que a soma dos lançamentos bata exatamente com o valor total da fatura.

═══════════════════════════════════════
ESTRUTURA TÍPICA DE UMA FATURA BRASILEIRA
═══════════════════════════════════════
Uma fatura de cartão de crédito brasileiro geralmente contém:
- RESUMO DA FATURA: total anterior, pagamento anterior, novas compras, encargos, total atual — ESTES SÃO RESUMOS, NÃO LANÇAMENTOS.
- LANÇAMENTOS DE COMPRAS: lista detalhada de cada compra com data, descrição e valor.
- ENCARGOS FINANCEIROS: juros rotativos, IOF, multa, mora — aparecem como lançamentos individuais.
- PAGAMENTOS: pagamentos efetuados no período.

═══════════════════════════════════════
REGRAS ANTI-DUPLICAÇÃO (CRÍTICO!)
═══════════════════════════════════════
1. JUROS e ENCARGOS: Extraia APENAS os lançamentos INDIVIDUAIS de juros/encargos que aparecem na lista de transações. 
   - NÃO extraia da seção de "Resumo" ou "Demonstrativo de encargos". Essas seções são INFORMATIVAS e duplicam os valores já listados nas transações.
   - Se a fatura listar "JUROS ROTATIVOS R$ 50,00" na seção de transações E TAMBÉM mostrar "Encargos: R$ 50,00" no resumo, extraia APENAS UMA VEZ (a da seção de transações).
   - Se houver um "DEMONSTRATIVO DE ENCARGOS" detalhando CET, taxas mensais/anuais, etc., isso é INFORMATIVO — NÃO são transações.
   
2. IOF: O IOF geralmente aparece como lançamento separado na lista de transações. Extraia-o UMA ÚNICA VEZ.
   - Se o IOF aparecer tanto no resumo quanto nas transações, use APENAS o das transações.

3. SUBTOTAIS e TOTAIS: NUNCA extraia linhas que representam:
   - "Total da fatura", "Total geral", "Valor total", "Total a pagar"
   - "Subtotal compras nacionais", "Subtotal compras internacionais"  
   - "Saldo anterior", "Saldo da fatura anterior"
   - "Total de encargos financeiros" (é um subtotal)
   - "Créditos/Débitos" (quando é um subtotal de seção)
   
4. SALDO ANTERIOR: NUNCA inclua o saldo anterior como transação. Ele é apenas referência.

5. PARCELAMENTOS: Cada parcela individual que aparece na fatura é UM lançamento. NÃO duplique.
   - Se aparecer "LOJA X PARCELA 3/10 R$50,00", isso é UMA transação de R$50,00.

═══════════════════════════════════════
O QUE EXTRAIR
═══════════════════════════════════════
✅ Compras nacionais (lojas, restaurantes, combustível, etc.)
✅ Compras internacionais (usar o valor em REAIS quando disponível)
✅ Parcelas individuais de compras parceladas
✅ Assinaturas (streaming, apps, etc.)
✅ Seguros e anuidade do cartão
✅ Juros rotativos (lançamento individual, NÃO do resumo)
✅ IOF (lançamento individual, NÃO do resumo)
✅ Multa por atraso (lançamento individual)
✅ Pagamento efetuado / crédito em conta
✅ Estornos / devoluções (como payment)
✅ Saques / empréstimos no cartão

O QUE NÃO EXTRAIR
❌ Linhas de resumo / sumário da fatura
❌ Linhas de "Total" ou "Subtotal"
❌ "Saldo anterior" / "Saldo da fatura anterior"
❌ Seção "Demonstrativo de encargos" (é informativa)
❌ CET (Custo Efetivo Total) — é informativo
❌ Taxas informativas (taxa mensal, taxa anual)
❌ Limites de crédito, limite disponível

═══════════════════════════════════════
VALIDAÇÃO OBRIGATÓRIA
═══════════════════════════════════════
Antes de responder, VALIDE:
1. Localize o "TOTAL DA FATURA" ou "VALOR A PAGAR" no documento.
2. Calcule: Total de compras + encargos - pagamentos = deve ser ≈ Total da fatura.
3. Se houver discrepância > 1%, revise os lançamentos antes de responder.

═══════════════════════════════════════
FORMATO DE RESPOSTA
═══════════════════════════════════════
Responda APENAS com um JSON object válido (sem markdown, sem backticks):
{
  "total_fatura": <número com o total da fatura/valor a pagar como impresso no documento, ou null se não encontrado>,
  "saldo_anterior": <número com o saldo anterior/valor da fatura anterior que ficou em aberto, ou 0 se não houver ou não encontrado>,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "<descrição ORIGINAL como aparece na fatura>",
      "amount": <valor numérico positivo, use ponto como separador decimal>,
      "category": "<categoria>",
      "type": "<tipo>"
    }
  ]
}

Categorias válidas: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Moradia", "Assinatura", "Juros/Encargos", "Pagamento", "Outros"
Tipos válidos: "purchase" (compras/débitos), "payment" (pagamentos/créditos/estornos), "interest" (juros/IOF/multa/encargos)

Se não souber a data exata de um lançamento, use o primeiro dia do mês da fatura.`,
              },
              {
                role: "user",
                content: `Extraia todos os lançamentos desta fatura de cartão de crédito. Lembre-se: NÃO duplique juros/encargos que aparecem tanto no resumo quanto na lista de transações. Extraia APENAS da lista de transações.\n\n${fileContent}`,
              },
            ],
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
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: "Créditos de IA insuficientes." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: "Erro ao processar com IA" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "";

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
      JSON.stringify({ error: (err as Error).message || "Erro interno" }),
      {
        status: 500,
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

    if (Array.isArray(parsed)) {
      transactions = parsed;
    } else if (parsed && Array.isArray(parsed.transactions)) {
      transactions = parsed.transactions;
      totalFatura = parsed.total_fatura != null ? Number(parsed.total_fatura) : null;
      saldoAnterior = parsed.saldo_anterior != null ? Number(parsed.saldo_anterior) : 0;
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
          status: 400,
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
          status: 400,
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

    // ── Validation: check extracted total vs statement total ──
    if (totalFatura != null && totalFatura > 0) {
      let sumPurchases = 0;
      let sumInterest = 0;
      let sumPayments = 0;
      for (const t of transactions) {
        const amt = Math.abs(Number(t.amount));
        const type = t.type || "purchase";
        if (type === "payment") sumPayments += amt;
        else if (type === "interest") sumInterest += amt;
        else sumPurchases += amt;
      }
      const calculatedTotal = sumPurchases + sumInterest - sumPayments;
      const diff = Math.abs(calculatedTotal - totalFatura);
      const pctDiff = totalFatura > 0 ? (diff / totalFatura) * 100 : 0;
      console.log(`Validation: total_fatura=${totalFatura}, calculated=${calculatedTotal.toFixed(2)}, diff=${diff.toFixed(2)} (${pctDiff.toFixed(1)}%)`);
      console.log(`  Purchases: ${sumPurchases.toFixed(2)}, Interest: ${sumInterest.toFixed(2)}, Payments: ${sumPayments.toFixed(2)}`);
    }

    // Delete any existing transactions for this statement (reprocessing)
    await adminClient
      .from("transactions")
      .delete()
      .eq("statement_id", statementId);

    // Insert transactions
    const validTypes = ["purchase", "payment", "interest"];
    const transactionsToInsert = transactions.map((t: any) => ({
      statement_id: statementId,
      date: t.date,
      description: t.description,
      amount: Math.abs(Number(t.amount)),
      category: t.category || null,
      type: validTypes.includes(t.type) ? t.type : "purchase",
      is_reviewed: false,
    }));

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
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update statement status to completed with totals
    await adminClient
      .from("statements")
      .update({ status: "completed", previous_balance: saldoAnterior, total_fatura: totalFatura || 0 })
      .eq("id", statementId);

    return new Response(
      JSON.stringify({
        success: true,
        count: transactionsToInsert.length,
        total_fatura: totalFatura,
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
        error: "Erro ao interpretar resposta da IA",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
