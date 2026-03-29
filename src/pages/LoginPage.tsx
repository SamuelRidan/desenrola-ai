import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { CreditCard, LogIn } from "lucide-react";
import { motion } from "framer-motion";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Preencha todos os campos");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("Erro ao fazer login: " + error.message);
    } else {
      toast.success("Login realizado com sucesso!");
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-heading font-bold text-sidebar-foreground">
              CardManager
            </h1>
          </div>
          <p className="text-sidebar-muted text-sm">
            Gerencie suas faturas de cartão de crédito
          </p>
        </div>

        <Card className="shadow-elevated border-sidebar-border bg-card">
          <CardHeader>
            <CardTitle className="font-heading">Entrar</CardTitle>
            <CardDescription>Acesse sua conta para continuar</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                <LogIn className="w-4 h-4 mr-2" />
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Não tem conta?{" "}
              <Link to="/registro" className="text-primary hover:underline font-medium">
                Cadastre-se
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
