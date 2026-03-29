import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { motion } from "framer-motion";
import { Receipt, TrendingDown, TrendingUp } from "lucide-react";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export default function MonthlyExpensesPage() {
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));

  const { data: assignments } = useQuery({
    queryKey: ["monthly-expenses", user?.id, month, year],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("transaction_assignments")
        .select(`
          share_amount,
          transactions (
            description, date, amount, alias,
            statements (month, year, credit_cards (name))
          )
        `)
        .eq("user_id", user.id);

      // Filter by month/year client-side
      return (data ?? []).filter((a: any) => {
        const s = a.transactions?.statements;
        return s && s.month === parseInt(month) && s.year === parseInt(year);
      });
    },
    enabled: !!user,
  });

  const total = assignments?.reduce((sum: number, a: any) => sum + Number(a.share_amount), 0) ?? 0;

  // Group by card
  const byCard: Record<string, { name: string; total: number; items: any[] }> = {};
  assignments?.forEach((a: any) => {
    const cardName = a.transactions?.statements?.credit_cards?.name || "Desconhecido";
    if (!byCard[cardName]) byCard[cardName] = { name: cardName, total: 0, items: [] };
    byCard[cardName].total += Number(a.share_amount);
    byCard[cardName].items.push(a);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Despesas Mensais</h1>
        <p className="text-muted-foreground text-sm mt-1">Acompanhe seus gastos mês a mês</p>
      </div>

      <div className="flex gap-3">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
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
            <p className="text-primary-foreground/80 text-sm">Total do Mês</p>
            <p className="text-3xl font-heading font-bold text-primary-foreground mt-1">
              R$ {total.toFixed(2)}
            </p>
            <p className="text-primary-foreground/60 text-sm mt-1">
              {MONTHS[parseInt(month) - 1]} {year}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {Object.values(byCard).length > 0 ? (
        <div className="space-y-4">
          {Object.values(byCard).map((card, i) => (
            <motion.div
              key={card.name}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="shadow-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-heading text-base">{card.name}</CardTitle>
                    <span className="font-heading font-bold text-primary">
                      R$ {card.total.toFixed(2)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {card.items.map((a: any, j: number) => (
                      <div key={j} className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <div>
                          <p className="text-sm font-medium">
                            {a.transactions?.alias || a.transactions?.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {a.transactions?.date ? new Date(a.transactions.date).toLocaleDateString("pt-BR") : ""}
                          </p>
                        </div>
                        <span className="font-heading text-sm font-semibold">
                          R$ {Number(a.share_amount).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-8 text-center">
            <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nenhuma despesa encontrada para este período</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
