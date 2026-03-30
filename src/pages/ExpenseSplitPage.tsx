import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Users, Receipt } from "lucide-react";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

interface SplitData {
  cardName: string;
  cardId: string;
  users: Record<string, { name: string; total: number; items: { description: string; date: string; amount: number }[] }>;
  grandTotal: number;
}

export default function ExpenseSplitPage() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));

  const { data: splitData, isLoading } = useQuery({
    queryKey: ["expense-split", month, year],
    queryFn: async () => {
      // Get all assignments with transaction + statement + card info
      const { data } = await supabase
        .from("transaction_assignments")
        .select(`
          share_amount, user_id,
          transactions (
            description, date, amount, alias,
            statements (month, year, card_id, credit_cards (name, id))
          )
        `);

      // Get profiles for names
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name");
      const profileMap: Record<string, string> = {};
      profiles?.forEach((p: any) => { profileMap[p.user_id] = p.full_name || "Sem nome"; });

      const m = parseInt(month);
      const y = parseInt(year);

      // Filter by month/year and group by card -> user
      const cards: Record<string, SplitData> = {};

      (data ?? []).forEach((a: any) => {
        const stmt = a.transactions?.statements;
        if (!stmt || stmt.month !== m || stmt.year !== y) return;

        const cardName = stmt.credit_cards?.name || "Desconhecido";
        const cardId = stmt.card_id;

        if (!cards[cardId]) {
          cards[cardId] = { cardName, cardId, users: {}, grandTotal: 0 };
        }

        const uid = a.user_id;
        if (!cards[cardId].users[uid]) {
          cards[cardId].users[uid] = { name: profileMap[uid] || uid, total: 0, items: [] };
        }

        const amt = Number(a.share_amount);
        cards[cardId].users[uid].total += amt;
        cards[cardId].users[uid].items.push({
          description: a.transactions?.alias || a.transactions?.description,
          date: a.transactions?.date,
          amount: amt,
        });
        cards[cardId].grandTotal += amt;
      });

      return Object.values(cards);
    },
  });

  const grandTotal = splitData?.reduce((s, c) => s + c.grandTotal, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Divisão de Despesas</h1>
        <p className="text-muted-foreground text-sm mt-1">Veja quanto cada pessoa deve por cartão</p>
      </div>

      <div className="flex gap-3">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[2024, 2025, 2026].map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="shadow-card gradient-primary">
          <CardContent className="p-6">
            <p className="text-primary-foreground/80 text-sm">Total Geral do Mês</p>
            <p className="text-3xl font-heading font-bold text-primary-foreground mt-1">
              R$ {grandTotal.toFixed(2)}
            </p>
            <p className="text-primary-foreground/60 text-sm mt-1">
              {MONTHS[parseInt(month) - 1]} {year}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {splitData && splitData.length > 0 ? (
        <div className="space-y-6">
          {splitData.map((card, ci) => (
            <motion.div
              key={card.cardId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ci * 0.1 }}
            >
              <Card className="shadow-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-heading text-lg flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-primary" />
                      {card.cardName}
                    </CardTitle>
                    <span className="font-heading font-bold text-primary text-lg">
                      R$ {card.grandTotal.toFixed(2)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.values(card.users).map((u, ui) => (
                    <div key={ui} className="border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between p-3 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {u.name[0]?.toUpperCase()}
                          </div>
                          <span className="font-medium text-sm">{u.name}</span>
                        </div>
                        <span className="font-heading font-bold text-primary">
                          R$ {u.total.toFixed(2)}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {u.items.map((item, ii) => (
                          <div key={ii} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div>
                              <span className="font-medium">{item.description}</span>
                              <span className="text-muted-foreground ml-2 text-xs">
                                {item.date ? new Date(item.date).toLocaleDateString("pt-BR") : ""}
                              </span>
                            </div>
                            <span className="font-heading text-sm">R$ {item.amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-8 text-center">
            <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nenhuma despesa atribuída para este período</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
