import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt, TrendingUp, CreditCard, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

export default function UserDashboard() {
  const { profile, user } = useAuth();

  const { data: myAssignments } = useQuery({
    queryKey: ["my-assignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("transaction_assignments")
        .select("share_amount, transactions(description, date, amount, statement_id)")
        .eq("user_id", user.id)
        .limit(10);
      return data ?? [];
    },
    enabled: !!user,
  });

  const totalSpent = myAssignments?.reduce((sum: number, a: any) => sum + Number(a.share_amount), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground">
          Olá, {profile?.full_name || "Usuário"} 👋
        </h1>
        <p className="text-muted-foreground mt-1">Suas despesas e transações</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <motion.div {...fadeIn} transition={{ delay: 0.1 }}>
          <Card className="shadow-card hover:shadow-elevated transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Atribuído</p>
                  <p className="text-3xl font-heading font-bold mt-1">
                    R$ {totalSpent.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-accent text-primary">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...fadeIn} transition={{ delay: 0.2 }}>
          <Card className="shadow-card hover:shadow-elevated transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Transações</p>
                  <p className="text-3xl font-heading font-bold mt-1">
                    {myAssignments?.length ?? 0}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-accent text-primary">
                  <Receipt className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div {...fadeIn} transition={{ delay: 0.3 }}>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Últimas Despesas</CardTitle>
          </CardHeader>
          <CardContent>
            {myAssignments && myAssignments.length > 0 ? (
              <div className="space-y-3">
                {myAssignments.map((a: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{a.transactions?.description}</p>
                      <p className="text-xs text-muted-foreground">{a.transactions?.date}</p>
                    </div>
                    <span className="font-heading font-semibold text-sm">
                      R$ {Number(a.share_amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nenhuma despesa atribuída ainda</p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
