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
    const userClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
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
                content: `Você é um assistente especializado em extrair lançamentos de faturas de cartão de crédito.
Analise o documento da fatura e extraia TODOS os lançamentos/transações.

IMPORTANTE: Responda APENAS com um JSON válido, sem markdown, sem backticks, sem texto extra.
O JSON deve ser um array de objetos com exatamente estes campos:
- "date": data no formato "YYYY-MM-DD"
- "description": descrição do lançamento (texto original da fatura)
- "amount": valor numérico positivo (sem símbolo de moeda)
- "category": categoria sugerida (ex: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Outros")

Exemplo de resposta:
[{"date":"2025-01-15","description":"RESTAURANTE XYZ","amount":45.90,"category":"Alimentação"}]

Se não conseguir identificar a data exata, use o primeiro dia do mês da fatura.
Ignore linhas que são totais, pagamentos, encargos ou juros.
Extraia apenas os lançamentos de compras.`,
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
                content: `Você é um assistente especializado em extrair lançamentos de faturas de cartão de crédito.
Analise o texto da fatura e extraia TODOS os lançamentos/transações.

IMPORTANTE: Responda APENAS com um JSON válido, sem markdown, sem backticks, sem texto extra.
O JSON deve ser um array de objetos com exatamente estes campos:
- "date": data no formato "YYYY-MM-DD"  
- "description": descrição do lançamento (texto original da fatura)
- "amount": valor numérico positivo (sem símbolo de moeda)
- "category": categoria sugerida (ex: "Alimentação", "Transporte", "Compras", "Saúde", "Lazer", "Serviços", "Educação", "Outros")

Exemplo de resposta:
[{"date":"2025-01-15","description":"RESTAURANTE XYZ","amount":45.90,"category":"Alimentação"}]

Se não conseguir identificar a data exata, use o primeiro dia do mês da fatura.
Ignore linhas que são totais, pagamentos, encargos ou juros.
Extraia apenas os lançamentos de compras.`,
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
