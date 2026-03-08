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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      assignments: {
        Row: {
          allowed_formats: string[] | null
          branch: string
          created_at: string
          deadline: string
          description: string | null
          faculty_profile_id: string
          id: string
          section: string
          title: string
          year: number
        }
        Insert: {
          allowed_formats?: string[] | null
          branch: string
          created_at?: string
          deadline: string
          description?: string | null
          faculty_profile_id: string
          id?: string
          section: string
          title: string
          year: number
        }
        Update: {
          allowed_formats?: string[] | null
          branch?: string
          created_at?: string
          deadline?: string
          description?: string | null
          faculty_profile_id?: string
          id?: string
          section?: string
          title?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignments_faculty_profile_id_fkey"
            columns: ["faculty_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_details: {
        Row: {
          created_at: string
          faculty_id: string
          id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          faculty_id: string
          id?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          faculty_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_details_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_sections: {
        Row: {
          branch: string
          created_at: string
          faculty_profile_id: string
          id: string
          section: string
          semester: string
          year: number
        }
        Insert: {
          branch: string
          created_at?: string
          faculty_profile_id: string
          id?: string
          section: string
          semester?: string
          year: number
        }
        Update: {
          branch?: string
          created_at?: string
          faculty_profile_id?: string
          id?: string
          section?: string
          semester?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "faculty_sections_faculty_profile_id_fkey"
            columns: ["faculty_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_statistics: {
        Row: {
          discriminative_weight: number
          feature_category: string
          feature_value: string
          id: number
          population_frequency: number
          sample_count: number | null
          updated_at: string | null
        }
        Insert: {
          discriminative_weight: number
          feature_category: string
          feature_value: string
          id?: number
          population_frequency: number
          sample_count?: number | null
          updated_at?: string | null
        }
        Update: {
          discriminative_weight?: number
          feature_category?: string
          feature_value?: string
          id?: number
          population_frequency?: number
          sample_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone_number: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone_number?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone_number?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      student_details: {
        Row: {
          branch: string
          created_at: string
          handwriting_feature_embedding: Json | null
          handwriting_features_extracted_at: string | null
          handwriting_image_hash: string | null
          handwriting_submitted_at: string | null
          handwriting_url: string | null
          has_logged_in: boolean | null
          id: string
          phone_number: string | null
          profile_id: string
          roll_number: string
          section: string
          semester: string
          year: number
        }
        Insert: {
          branch: string
          created_at?: string
          handwriting_feature_embedding?: Json | null
          handwriting_features_extracted_at?: string | null
          handwriting_image_hash?: string | null
          handwriting_submitted_at?: string | null
          handwriting_url?: string | null
          has_logged_in?: boolean | null
          id?: string
          phone_number?: string | null
          profile_id: string
          roll_number: string
          section: string
          semester?: string
          year: number
        }
        Update: {
          branch?: string
          created_at?: string
          handwriting_feature_embedding?: Json | null
          handwriting_features_extracted_at?: string | null
          handwriting_image_hash?: string | null
          handwriting_submitted_at?: string | null
          handwriting_url?: string | null
          has_logged_in?: boolean | null
          id?: string
          phone_number?: string | null
          profile_id?: string
          roll_number?: string
          section?: string
          semester?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_details_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          ai_analysis_details: Json | null
          ai_confidence_score: number | null
          ai_flagged_sections: string[] | null
          ai_risk_level: string | null
          ai_similarity_score: number | null
          assignment_id: string
          created_at: string
          feedback: string | null
          file_type: string
          file_url: string
          file_urls: string[] | null
          id: string
          is_late: boolean | null
          marks: number | null
          page_verification_results: Json | null
          status: string | null
          student_profile_id: string
          submitted_at: string
          verified_at: string | null
        }
        Insert: {
          ai_analysis_details?: Json | null
          ai_confidence_score?: number | null
          ai_flagged_sections?: string[] | null
          ai_risk_level?: string | null
          ai_similarity_score?: number | null
          assignment_id: string
          created_at?: string
          feedback?: string | null
          file_type: string
          file_url: string
          file_urls?: string[] | null
          id?: string
          is_late?: boolean | null
          marks?: number | null
          page_verification_results?: Json | null
          status?: string | null
          student_profile_id: string
          submitted_at?: string
          verified_at?: string | null
        }
        Update: {
          ai_analysis_details?: Json | null
          ai_confidence_score?: number | null
          ai_flagged_sections?: string[] | null
          ai_risk_level?: string | null
          ai_similarity_score?: number | null
          assignment_id?: string
          created_at?: string
          feedback?: string | null
          file_type?: string
          file_url?: string
          file_urls?: string[] | null
          id?: string
          is_late?: boolean | null
          marks?: number | null
          page_verification_results?: Json | null
          status?: string | null
          student_profile_id?: string
          submitted_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_student_profile_id_fkey"
            columns: ["student_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          role: Database["public"]["Enums"]["app_role"]
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
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "faculty" | "student"
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
      app_role: ["admin", "faculty", "student"],
    },
  },
} as const
