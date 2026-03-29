import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, FileText, Users, TrendingUp, Upload, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

export default function AdminDashboard() {
  const { profile } = useAuth();

  const { data: cardsCount } = useQuery({
    queryKey: ["cards-count"],
    queryFn: async () => {
      const { count } = await supabase.from("credit_cards").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: statementsCount } = useQuery({
    queryKey: ["statements-count"],
    queryFn: async () => {
      const { count } = await supabase.from("statements").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: transactionsCount } = useQuery({
    queryKey: ["transactions-count"],
    queryFn: async () => {
      const { count } = await supabase.from("transactions").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: pendingStatements } = useQuery({
    queryKey: ["pending-statements"],
    queryFn: async () => {
      const { data } = await supabase.from("statements").select("*, credit_cards(name)").eq("status", "pending").limit(5);
      return data ?? [];
    },
  });

  const stats = [
    { label: "Cartões Cadastrados", value: cardsCount ?? 0, icon: <CreditCard className="w-5 h-5" />, color: "text-primary" },
    { label: "Faturas Importadas", value: statementsCount ?? 0, icon: <Upload className="w-5 h-5" />, color: "text-success" },
    { label: "Transações", value: transactionsCount ?? 0, icon: <FileText className="w-5 h-5" />, color: "text-warning" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground">
          Olá, {profile?.full_name || "Administrador"} 👋
        </h1>
        <p className="text-muted-foreground mt-1">Painel administrativo</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} {...fadeIn} transition={{ delay: i * 0.1 }}>
            <Card className="shadow-card hover:shadow-elevated transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-3xl font-heading font-bold mt-1">{stat.value}</p>
                  </div>
                  <div className={`p-3 rounded-lg bg-accent ${stat.color}`}>
                    {stat.icon}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <motion.div {...fadeIn} transition={{ delay: 0.3 }}>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-warning" />
              Faturas Pendentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingStatements && pendingStatements.length > 0 ? (
              <div className="space-y-3">
                {pendingStatements.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{s.credit_cards?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(s.month).padStart(2, "0")}/{s.year}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning font-medium">
                      Pendente
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nenhuma fatura pendente</p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
