export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      credit_cards: {
        Row: {
          brand: string
          created_at: string
          created_by: string | null
          id: string
          interest_rate: number
          last_four_digits: string
          name: string
          updated_at: string
        }
        Insert: {
          brand?: string
          created_at?: string
          created_by?: string | null
          id?: string
          interest_rate?: number
          last_four_digits: string
          name: string
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          created_by?: string | null
          id?: string
          interest_rate?: number
          last_four_digits?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_payments: {
        Row: {
          id: string
          statement_id: string
          amount_paid: number
          payment_date: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          statement_id: string
          amount_paid: number
          payment_date?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          statement_id?: string
          amount_paid?: number
          payment_date?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "statements"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      statements: {
        Row: {
          card_id: string
          created_at: string
          file_name: string | null
          id: string
          month: number
          previous_balance: number
          status: string
          total_fatura: number
          updated_at: string
          uploaded_by: string | null
          year: number
        }
        Insert: {
          card_id: string
          created_at?: string
          file_name?: string | null
          id?: string
          month: number
          previous_balance?: number
          status?: string
          total_fatura?: number
          updated_at?: string
          uploaded_by?: string | null
          year: number
        }
        Update: {
          card_id?: string
          created_at?: string
          file_name?: string | null
          id?: string
          month?: number
          previous_balance?: number
          status?: string
          total_fatura?: number
          updated_at?: string
          uploaded_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "statements_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_aliases: {
        Row: {
          alias: string
          created_at: string
          created_by: string | null
          id: string
          original_description: string
        }
        Insert: {
          alias: string
          created_at?: string
          created_by?: string | null
          id?: string
          original_description: string
        }
        Update: {
          alias?: string
          created_at?: string
          created_by?: string | null
          id?: string
          original_description?: string
        }
        Relationships: []
      }
      transaction_assignments: {
        Row: {
          created_at: string
          id: string
          share_amount: number
          transaction_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          share_amount: number
          transaction_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          share_amount?: number
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_assignments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          alias: string | null
          amount: number
          category: string | null
          created_at: string
          date: string
          description: string
          id: string
          is_reviewed: boolean
          statement_id: string
          type: string
          updated_at: string
        }
        Insert: {
          alias?: string | null
          amount: number
          category?: string | null
          created_at?: string
          date: string
          description: string
          id?: string
          is_reviewed?: boolean
          statement_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          alias?: string | null
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          is_reviewed?: boolean
          statement_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "statements"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
