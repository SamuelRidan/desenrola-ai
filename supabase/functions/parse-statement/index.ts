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
                content: `Você é um assistente especializado em extrair TODOS os lançamentos de faturas de cartão de crédito, incluindo pagamentos e encargos financeiros.

REGRAS CRÍTICAS:
1. Extraia ABSOLUTAMENTE TODOS os lançamentos da fatura, sem exceção.
2. Inclua compras nacionais e internacionais, parcelamentos, assinaturas, seguros, anuidades.
3. Inclua PAGAMENTOS efetuados (créditos na fatura). Marque como type: "payment".
4. Inclua JUROS ROTATIVOS, encargos financeiros, multas, IOF sobre juros. Marque como type: "interest".
5. Compras e débitos normais devem ter type: "purchase".
6. NÃO ignore nenhum lançamento. Ignore APENAS linhas de "Total" ou "Saldo anterior".
7. Valores em moeda estrangeira devem usar o valor em reais (BRL) quando disponível.
8. Para parcelamentos (ex: "PARCELA 3/10"), inclua cada parcela como um lançamento individual.

FORMATO: Responda APENAS com um JSON array válido, sem markdown, sem backticks.
Cada objeto deve ter:
- "date": "YYYY-MM-DD" (se não souber a data exata, use o primeiro dia do mês)
- "description": descrição COMPLETA e ORIGINAL como aparece na fatura
- "amount": valor numérico positivo (sem R$, use ponto como separador decimal)
- "category": uma de: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Moradia", "Assinatura", "Juros/Encargos", "Pagamento", "Outros"
- "type": "purchase" para compras, "payment" para pagamentos/créditos, "interest" para juros/encargos/multas

Exemplo: [{"date":"2025-01-15","description":"RESTAURANTE XYZ","amount":45.90,"category":"Alimentação","type":"purchase"},{"date":"2025-01-10","description":"PAGAMENTO EFETUADO","amount":500.00,"category":"Pagamento","type":"payment"},{"date":"2025-01-20","description":"JUROS ROTATIVOS","amount":35.00,"category":"Juros/Encargos","type":"interest"}]`,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extraia todos os lançamentos desta fatura de cartão de crédito:",
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
                content: `Você é um assistente especializado em extrair TODOS os lançamentos de faturas de cartão de crédito.

REGRAS CRÍTICAS:
1. Extraia ABSOLUTAMENTE TODOS os lançamentos da fatura, sem exceção. Não pule nenhum.
2. Inclua compras nacionais e internacionais, parcelamentos, assinaturas, seguros, anuidades.
3. NÃO ignore nenhum lançamento. Se houver 50 lançamentos na fatura, retorne 50.
4. Ignore APENAS: linha de "Total", "Pagamento anterior", "Saldo anterior", "Encargos financeiros/juros de mora".
5. Valores em moeda estrangeira devem usar o valor em reais (BRL) quando disponível.
6. Para parcelamentos (ex: "PARCELA 3/10"), inclua cada parcela como um lançamento individual.

FORMATO: Responda APENAS com um JSON array válido, sem markdown, sem backticks.
Cada objeto deve ter:
- "date": "YYYY-MM-DD" (se não souber a data exata, use o primeiro dia do mês)
- "description": descrição COMPLETA e ORIGINAL como aparece na fatura
- "amount": valor numérico positivo (sem R$, use ponto como separador decimal)
- "category": uma de: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Moradia", "Assinatura", "Outros"

Exemplo: [{"date":"2025-01-15","description":"RESTAURANTE XYZ","amount":45.90,"category":"Alimentação"}]`,
              },
              {
                role: "user",
                content: `Extraia todos os lançamentos desta fatura de cartão de crédito:\n\n${fileContent}`,
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
      JSON.stringify({ error: err.message || "Erro interno" }),
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

    const transactions = JSON.parse(cleanContent);

    if (!Array.isArray(transactions) || transactions.length === 0) {
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

    // Delete any existing transactions for this statement (reprocessing)
    await adminClient
      .from("transactions")
      .delete()
      .eq("statement_id", statementId);

    // Insert transactions
    const transactionsToInsert = transactions.map((t: any) => ({
      statement_id: statementId,
      date: t.date,
      description: t.description,
      amount: Math.abs(Number(t.amount)),
      category: t.category || null,
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

    // Update statement status to completed
    await adminClient
      .from("statements")
      .update({ status: "completed" })
      .eq("id", statementId);

    return new Response(
      JSON.stringify({
        success: true,
        count: transactionsToInsert.length,
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
