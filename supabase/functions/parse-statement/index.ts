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

NÃO EXTRAIA como transações:
❌ "Pagamento recebido" / "Pagamento em DD/MM" — estes são pagamentos da fatura ANTERIOR, já refletidos no saldo financiado
❌ "Crédito de rotativo" / "Crédito de financiamento" — é uma entrada técnica contábil, NÃO é transação real
❌ Linhas de resumo, totais, subtotais
❌ "Saldo anterior" / "Fatura anterior"
❌ Seção "Demonstrativo de encargos" (informativa)
❌ CET, taxas informativas, limites de crédito
❌ Estornos que já estão descontados do total

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
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "<descrição ORIGINAL como aparece na fatura>",
      "amount": <valor numérico positivo>,
      "category": "<categoria>",
      "type": "<tipo>"
    }
  ]
}

Categorias válidas: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Moradia", "Assinatura", "Juros/Encargos", "Pagamento", "Outros"
Tipos válidos: "purchase" (compras/débitos), "interest" (juros/IOF/multa/encargos)

ATENÇÃO: NÃO use type "payment". Pagamentos da fatura anterior já estão refletidos no saldo_anterior.
Se não souber a data exata de um lançamento, use o primeiro dia do mês da fatura.`;

const USER_MESSAGE = "Extraia todos os lançamentos desta fatura de cartão de crédito. IMPORTANTE: (1) Use o SALDO FINANCIADO como saldo_anterior (fatura anterior - pagamento), NÃO o valor total da fatura anterior. (2) NÃO inclua pagamentos da fatura anterior nem créditos de rotativo como transações. (3) Inclua APENAS compras e juros/IOF individuais da lista de transações.";
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
                content: SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: USER_MESSAGE,
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
                content: SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: `${USER_MESSAGE}\n\n${fileContent}`,
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

    // ── Validation: check saldo_anterior + transactions ≈ total_fatura ──
    if (totalFatura != null && totalFatura > 0) {
      let sumPurchases = 0;
      let sumInterest = 0;
      for (const t of transactions) {
        const amt = Math.abs(Number(t.amount));
        const type = t.type || "purchase";
        if (type === "interest") sumInterest += amt;
        else sumPurchases += amt;
      }
      const calculatedTotal = saldoAnterior + sumPurchases + sumInterest;
      const diff = Math.abs(calculatedTotal - totalFatura);
      const pctDiff = totalFatura > 0 ? (diff / totalFatura) * 100 : 0;
      console.log(`Validation: total_fatura=${totalFatura}, saldo_anterior=${saldoAnterior}, calculated=${calculatedTotal.toFixed(2)}, diff=${diff.toFixed(2)} (${pctDiff.toFixed(1)}%)`);
      console.log(`  Purchases: ${sumPurchases.toFixed(2)}, Interest: ${sumInterest.toFixed(2)}`);
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
        previous_balance: saldoAnterior,
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
