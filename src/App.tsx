import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import CardsPage from "./pages/CardsPage";
import StatementUploadPage from "./pages/StatementUploadPage";
import TransactionsPage from "./pages/TransactionsPage";
import MonthlyExpensesPage from "./pages/MonthlyExpensesPage";
import ExpenseSplitPage from "./pages/ExpenseSplitPage";
import AliasesPage from "./pages/AliasesPage";
import UsersPage from "./pages/UsersPage";
import PaymentsPage from "./pages/PaymentsPage";
import UserDashboard from "./pages/UserDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children, adminOnly }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { session, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (adminOnly && role !== "admin") return <Navigate to="/" replace />;

  return <AppLayout>{children}</AppLayout>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/registro" element={<PublicRoute><RegisterPage /></PublicRoute>} />
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/cartoes" element={<ProtectedRoute adminOnly><CardsPage /></ProtectedRoute>} />
            <Route path="/importar" element={<ProtectedRoute adminOnly><StatementUploadPage /></ProtectedRoute>} />
            <Route path="/transacoes" element={<ProtectedRoute><TransactionsPage /></ProtectedRoute>} />
            <Route path="/despesas" element={<ProtectedRoute><MonthlyExpensesPage /></ProtectedRoute>} />
            <Route path="/divisao" element={<ProtectedRoute><ExpenseSplitPage /></ProtectedRoute>} />
            <Route path="/apelidos" element={<ProtectedRoute><AliasesPage /></ProtectedRoute>} />
            <Route path="/pagamentos" element={<ProtectedRoute><PaymentsPage /></ProtectedRoute>} />
            <Route path="/usuarios" element={<ProtectedRoute adminOnly><UsersPage /></ProtectedRoute>} />
            <Route path="/cockpit" element={<ProtectedRoute><UserDashboard /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
