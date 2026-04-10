export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          organization_id: string
          status?: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_admin_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_admin_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      admins: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_admins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token?: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      contract_templates: {
        Row: {
          created_at: string | null
          id: string
          layout: Json
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          layout?: Json
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          layout?: Json
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          contract_template_id: string | null
          created_at: string | null
          document_hash: string | null
          employee_id: string | null
          field_values: Json
          form_snapshot: Json
          id: string
          invitation_id: string | null
          organization_id: string
          pdf_path: string | null
          prefilled_fields: Json
          signature_path: string | null
          signed_at: string | null
          signed_by: string | null
          signer_ip: string | null
          status: Database["public"]["Enums"]["contracts_status_enum"]
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          contract_template_id?: string | null
          created_at?: string | null
          document_hash?: string | null
          employee_id?: string | null
          field_values?: Json
          form_snapshot?: Json
          id?: string
          invitation_id?: string | null
          organization_id: string
          pdf_path?: string | null
          prefilled_fields?: Json
          signature_path?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signer_ip?: string | null
          status?: Database["public"]["Enums"]["contracts_status_enum"]
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          contract_template_id?: string | null
          created_at?: string | null
          document_hash?: string | null
          employee_id?: string | null
          field_values?: Json
          form_snapshot?: Json
          id?: string
          invitation_id?: string | null
          organization_id?: string
          pdf_path?: string | null
          prefilled_fields?: Json
          signature_path?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signer_ip?: string | null
          status?: Database["public"]["Enums"]["contracts_status_enum"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "onboarding_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_contracts_onboarding_form_id_fkey"
            columns: ["contract_template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string | null
          entity_id: string
          id: string
          name: string
          organization_id: string
          parent_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          id?: string
          name: string
          organization_id?: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          id?: string
          name?: string
          organization_id?: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_column_choices: {
        Row: {
          created_at: string | null
          employee_column_id: string
          id: string
          label: string
          organization_id: string
          sort_order: number
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          employee_column_id: string
          id?: string
          label: string
          organization_id?: string
          sort_order?: number
          updated_at?: string | null
          value?: string
        }
        Update: {
          created_at?: string | null
          employee_column_id?: string
          id?: string
          label?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_column_choices_employee_column_id_fkey"
            columns: ["employee_column_id"]
            isOneToOne: false
            referencedRelation: "employee_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_column_choices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_columns: {
        Row: {
          created_at: string | null
          id: string
          label: string
          organization_id: string
          type: Database["public"]["Enums"]["employee_column_type"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          label: string
          organization_id: string
          type: Database["public"]["Enums"]["employee_column_type"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          label?: string
          organization_id?: string
          type?: Database["public"]["Enums"]["employee_column_type"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_columns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          birthday: string
          col_10TeE9YGOpfk4soM: number | null
          col_18BZZlG7sXfxDMD5: string | null
          col_2reneqE2EYuhhGU0: string[] | null
          col_7rIhU1R8IVd7wybP: string | null
          col_a6DGJHNVJcRNAtZZ: string | null
          col_AiR30BcK9ItMXvt7: string | null
          col_bDqpRxbMwXQ2D9uJ: string | null
          col_BFXzgbv83zGQGqfX: string | null
          col_eQMYeqWPv5tC95lU: string | null
          col_fSJRAQPu6qVk72dq: string[] | null
          col_gJS8X6WvqagkbKt6: string | null
          col_hc7V2jNnQ95yoqg1: string | null
          col_HZUIALDS3Zn3oXb5: string | null
          col_I4IuajwGDsnhBv1e: number | null
          col_iNvI3DfOBJgfHgRH: string | null
          col_IwDRzwu8thOhdGha: string | null
          col_jVmC6OHwwBn5iLAY: string | null
          col_kef67eVno2kzEjjr: number | null
          col_LXIpBDGdxAsOB6jQ: string | null
          col_NYUjJAhDwQmGNuBw: string | null
          col_PaFCOi1WhI7A6qH8: string[] | null
          col_pRkCLuzypZ8uOtN7: string | null
          col_PXPmPe3JGdS4Mad4: string | null
          col_Q8tdAhad9wGKoVw6: string | null
          col_Qbzhcn952tHnLoLC: string | null
          col_QOkIHzGHlCM6vaLG: string | null
          col_rnyMwlUuJvLJox8k: string | null
          col_sHzZfLzx0HhB8x6V: string | null
          col_TMkrLH7gnQYmWhDm: string | null
          col_UZXAhfA571NP8vF7: string | null
          col_Wic43M4saWo0mWeG: string[] | null
          col_wPZyWwUFN2Mdc2bc: string | null
          col_yJ1xoXqTzGZ0fgOL: string | null
          col_ZeYuGFnKhcXtxETD: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          organization_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          birthday?: string
          col_10TeE9YGOpfk4soM?: number | null
          col_18BZZlG7sXfxDMD5?: string | null
          col_2reneqE2EYuhhGU0?: string[] | null
          col_7rIhU1R8IVd7wybP?: string | null
          col_a6DGJHNVJcRNAtZZ?: string | null
          col_AiR30BcK9ItMXvt7?: string | null
          col_bDqpRxbMwXQ2D9uJ?: string | null
          col_BFXzgbv83zGQGqfX?: string | null
          col_eQMYeqWPv5tC95lU?: string | null
          col_fSJRAQPu6qVk72dq?: string[] | null
          col_gJS8X6WvqagkbKt6?: string | null
          col_hc7V2jNnQ95yoqg1?: string | null
          col_HZUIALDS3Zn3oXb5?: string | null
          col_I4IuajwGDsnhBv1e?: number | null
          col_iNvI3DfOBJgfHgRH?: string | null
          col_IwDRzwu8thOhdGha?: string | null
          col_jVmC6OHwwBn5iLAY?: string | null
          col_kef67eVno2kzEjjr?: number | null
          col_LXIpBDGdxAsOB6jQ?: string | null
          col_NYUjJAhDwQmGNuBw?: string | null
          col_PaFCOi1WhI7A6qH8?: string[] | null
          col_pRkCLuzypZ8uOtN7?: string | null
          col_PXPmPe3JGdS4Mad4?: string | null
          col_Q8tdAhad9wGKoVw6?: string | null
          col_Qbzhcn952tHnLoLC?: string | null
          col_QOkIHzGHlCM6vaLG?: string | null
          col_rnyMwlUuJvLJox8k?: string | null
          col_sHzZfLzx0HhB8x6V?: string | null
          col_TMkrLH7gnQYmWhDm?: string | null
          col_UZXAhfA571NP8vF7?: string | null
          col_Wic43M4saWo0mWeG?: string[] | null
          col_wPZyWwUFN2Mdc2bc?: string | null
          col_yJ1xoXqTzGZ0fgOL?: string | null
          col_ZeYuGFnKhcXtxETD?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          organization_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          birthday?: string
          col_10TeE9YGOpfk4soM?: number | null
          col_18BZZlG7sXfxDMD5?: string | null
          col_2reneqE2EYuhhGU0?: string[] | null
          col_7rIhU1R8IVd7wybP?: string | null
          col_a6DGJHNVJcRNAtZZ?: string | null
          col_AiR30BcK9ItMXvt7?: string | null
          col_bDqpRxbMwXQ2D9uJ?: string | null
          col_BFXzgbv83zGQGqfX?: string | null
          col_eQMYeqWPv5tC95lU?: string | null
          col_fSJRAQPu6qVk72dq?: string[] | null
          col_gJS8X6WvqagkbKt6?: string | null
          col_hc7V2jNnQ95yoqg1?: string | null
          col_HZUIALDS3Zn3oXb5?: string | null
          col_I4IuajwGDsnhBv1e?: number | null
          col_iNvI3DfOBJgfHgRH?: string | null
          col_IwDRzwu8thOhdGha?: string | null
          col_jVmC6OHwwBn5iLAY?: string | null
          col_kef67eVno2kzEjjr?: number | null
          col_LXIpBDGdxAsOB6jQ?: string | null
          col_NYUjJAhDwQmGNuBw?: string | null
          col_PaFCOi1WhI7A6qH8?: string[] | null
          col_pRkCLuzypZ8uOtN7?: string | null
          col_PXPmPe3JGdS4Mad4?: string | null
          col_Q8tdAhad9wGKoVw6?: string | null
          col_Qbzhcn952tHnLoLC?: string | null
          col_QOkIHzGHlCM6vaLG?: string | null
          col_rnyMwlUuJvLJox8k?: string | null
          col_sHzZfLzx0HhB8x6V?: string | null
          col_TMkrLH7gnQYmWhDm?: string | null
          col_UZXAhfA571NP8vF7?: string | null
          col_Wic43M4saWo0mWeG?: string[] | null
          col_wPZyWwUFN2Mdc2bc?: string | null
          col_yJ1xoXqTzGZ0fgOL?: string | null
          col_ZeYuGFnKhcXtxETD?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          organization_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_employees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string | null
          id: string
          locale: string | null
          name: string
          organization_id: string
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          locale?: string | null
          name: string
          organization_id: string
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          locale?: string | null
          name?: string
          organization_id?: string
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_invitations: {
        Row: {
          contract_template_id: string
          created_at: string | null
          employee_email: string
          entity_id: string
          id: string
          invitation_token: string
          organization_id: string
          prefilled_fields: Json
          sent_by: string | null
          status: Database["public"]["Enums"]["onboarding_invitations_status_enum"]
          updated_at: string | null
        }
        Insert: {
          contract_template_id: string
          created_at?: string | null
          employee_email: string
          entity_id: string
          id?: string
          invitation_token?: string
          organization_id: string
          prefilled_fields?: Json
          sent_by?: string | null
          status?: Database["public"]["Enums"]["onboarding_invitations_status_enum"]
          updated_at?: string | null
        }
        Update: {
          contract_template_id?: string
          created_at?: string | null
          employee_email?: string
          entity_id?: string
          id?: string
          invitation_token?: string
          organization_id?: string
          prefilled_fields?: Json
          sent_by?: string | null
          status?: Database["public"]["Enums"]["onboarding_invitations_status_enum"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_invitations_contract_template_id_fkey"
            columns: ["contract_template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_invitations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_invitations_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_role_permissions: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          permission: Database["public"]["Enums"]["app_permission"]
          role: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          permission: Database["public"]["Enums"]["app_permission"]
          role: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          permission?: Database["public"]["Enums"]["app_permission"]
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_role_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          email_verified: boolean
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          email_verified?: boolean
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          email_verified?: boolean
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rel__department__employee: {
        Row: {
          created_at: string
          department_id: string
          employee_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          employee_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rel__department__employee_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rel__department__employee_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rel__department__invitation: {
        Row: {
          created_at: string
          department_id: string
          invitation_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          invitation_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          invitation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rel__department__invitation_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rel__department__invitation_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "onboarding_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { invitation_token: string }; Returns: Json }
      add_employee_column: {
        Args: { col_name: string; col_type: string }
        Returns: undefined
      }
      authorize: {
        Args: {
          org_id: string
          requested_permission: Database["public"]["Enums"]["app_permission"]
        }
        Returns: boolean
      }
      cleanup_expired_auth_tokens: { Args: never; Returns: undefined }
      create_organization: { Args: { org_name: string }; Returns: string }
      generate_id: { Args: { prefix: string }; Returns: string }
      get_invitation_by_token: {
        Args: { invitation_token: string }
        Returns: Json
      }
      get_my_member_organizations: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      get_organization_role: { Args: { org_id: string }; Returns: string }
      has_pending_invitation: { Args: { org_id: string }; Returns: boolean }
      is_admin_or_owner: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      seed_org_permissions: { Args: { org_id: string }; Returns: undefined }
    }
    Enums: {
      app_permission:
        | "manage_organization"
        | "manage_members"
        | "manage_roles"
        | "view_all_employees"
        | "manage_employees"
        | "view_department_employees"
        | "manage_departments"
        | "view_own_profile"
        | "edit_own_profile"
      contracts_status_enum: "draft" | "sent" | "filled" | "active" | "voided"
      employee_column_type:
        | "text"
        | "number"
        | "date"
        | "boolean"
        | "multi_select"
      onboarding_invitations_status_enum:
        | "sent"
        | "accepted"
        | "expired"
        | "revoked"
        | "approved"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_permission: [
        "manage_organization",
        "manage_members",
        "manage_roles",
        "view_all_employees",
        "manage_employees",
        "view_department_employees",
        "manage_departments",
        "view_own_profile",
        "edit_own_profile",
      ],
      contracts_status_enum: ["draft", "sent", "filled", "active", "voided"],
      employee_column_type: [
        "text",
        "number",
        "date",
        "boolean",
        "multi_select",
      ],
      onboarding_invitations_status_enum: [
        "sent",
        "accepted",
        "expired",
        "revoked",
        "approved",
      ],
    },
  },
} as const

