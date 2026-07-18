import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  CreditCard, LayoutDashboard, Upload, FileText, Users,
  Receipt, Tag, LogOut, Menu, X, ChevronRight, Wallet, BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import logoImg from "@/img/logo desenrola AI.png";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  roles?: ("admin" | "user")[];
}

const navItems: NavItem[] = [
  { label: "Painel", href: "/", icon: <LayoutDashboard className="w-5 h-5" />, roles: ["admin", "user"] },
  { label: "Cockpit", href: "/cockpit", icon: <BarChart3 className="w-5 h-5" />, roles: ["admin"] },
  { label: "Cartões", href: "/cartoes", icon: <CreditCard className="w-5 h-5" />, roles: ["admin"] },
  { label: "Importar Fatura", href: "/importar", icon: <Upload className="w-5 h-5" />, roles: ["admin"] },
  { label: "Transações", href: "/transacoes", icon: <FileText className="w-5 h-5" />, roles: ["admin", "user"] },
  { label: "Despesas Mensais", href: "/despesas", icon: <Receipt className="w-5 h-5" />, roles: ["user"] },
  { label: "Divisão de Despesas", href: "/divisao", icon: <Users className="w-5 h-5" />, roles: ["admin", "user"] },
  { label: "Pagamentos", href: "/pagamentos", icon: <Wallet className="w-5 h-5" />, roles: ["admin", "user"] },
  { label: "Apelidos", href: "/apelidos", icon: <Tag className="w-5 h-5" />, roles: ["admin", "user"] },
  { label: "Usuários", href: "/usuarios", icon: <Users className="w-5 h-5" />, roles: ["admin"] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { profile, role, signOut } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filteredItems = navItems.filter(
    (item) => !item.roles || (role && item.roles.includes(role))
  );

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="h-[120px] flex items-center justify-center">
        <img src={logoImg} alt="Desenrola AI" className="w-[300px] h-auto max-w-none object-contain" />
      </div>

      <nav className="flex-1 px-3 py-1 space-y-1">
        {filteredItems.map((item) => {
          const active = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                active
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              {item.icon}
              {item.label}
              {active && <ChevronRight className="w-4 h-4 ml-auto" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-3 px-2">
          {profile?.avatar_url ? (
            <Avatar className="w-8 h-8 border border-sidebar-border shadow-sm">
              <AvatarImage src={profile.avatar_url} />
              <AvatarFallback>{profile?.full_name?.[0]?.toUpperCase() || "U"}</AvatarFallback>
            </Avatar>
          ) : (
            <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shadow-sm">
              {profile?.full_name?.[0]?.toUpperCase() || "U"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {profile?.full_name || "Usuário"}
            </p>
            <p className="text-xs text-sidebar-muted capitalize">{role || "user"}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={signOut}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sair
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 flex-col bg-sidebar border-r border-sidebar-border fixed inset-y-0 left-0 z-30">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar shadow-elevated">
            <div className="absolute top-4 right-4">
              <button onClick={() => setSidebarOpen(false)} className="text-sidebar-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-64 h-screen overflow-y-auto">
        {/* Mobile Header */}
        <header className="lg:hidden flex-none flex items-center justify-between p-4 border-b border-border bg-card">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="w-6 h-6 text-foreground" />
          </button>
          <span className="font-heading font-bold text-foreground">Desenrola AI</span>
          <div className="w-6" />
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 animate-fade-in w-full max-w-[100vw] overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
