import { useAuth } from "@/contexts/AuthContext";
import AdminDashboard from "./AdminDashboard";
import { Navigate } from "react-router-dom";

export default function Index() {
  const { role, loading, session } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Regular users go directly to the transactions page
  if (role !== "admin") return <Navigate to="/transacoes" replace />;

  return <AdminDashboard />;
}
