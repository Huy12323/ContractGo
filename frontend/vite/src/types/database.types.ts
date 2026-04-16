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
          is_archived: boolean
          layout: Json
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_archived?: boolean
          layout?: Json
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_archived?: boolean
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
      employee_views: {
        Row: {
          created_at: string | null
          created_by: string | null
          field_order: Json
          field_widths: Json
          filter: Json
          group_by: Json
          hidden_keys: Json
          id: string
          is_default: boolean
          name: string
          organization_id: string
          sort: Json
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          field_order?: Json
          field_widths?: Json
          filter?: Json
          group_by?: Json
          hidden_keys?: Json
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          sort?: Json
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          field_order?: Json
          field_widths?: Json
          filter?: Json
          group_by?: Json
          hidden_keys?: Json
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          sort?: Json
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_views_organization_id_fkey"
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
          col_jC4iUV6VwMAvUiUr: string | null
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
          col_jC4iUV6VwMAvUiUr?: string | null
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
          col_jC4iUV6VwMAvUiUr?: string | null
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
          timezone: Database["public"]["Enums"]["iana_timezone"] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          locale?: string | null
          name: string
          organization_id: string
          timezone?: Database["public"]["Enums"]["iana_timezone"] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          locale?: string | null
          name?: string
          organization_id?: string
          timezone?: Database["public"]["Enums"]["iana_timezone"] | null
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
      files: {
        Row: {
          content_type: string
          created_at: string | null
          id: string
          name: string
          organization_id: string | null
          r2_key: string
          size: number
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          content_type: string
          created_at?: string | null
          id?: string
          name: string
          organization_id?: string | null
          r2_key: string
          size: number
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          r2_key?: string
          size?: number
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      realtime_table_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["realtime_table_events_event_type_enum"]
          id: string
          organization_id: string
          record_id: string | null
          table_name: string
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["realtime_table_events_event_type_enum"]
          id?: string
          organization_id: string
          record_id?: string | null
          table_name: string
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["realtime_table_events_event_type_enum"]
          id?: string
          organization_id?: string
          record_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "realtime_table_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rel__department__employee: {
        Row: {
          created_at: string
          department_id: string
          employee_id: string
          is_manager: boolean
        }
        Insert: {
          created_at?: string
          department_id: string
          employee_id: string
          is_manager?: boolean
        }
        Update: {
          created_at?: string
          department_id?: string
          employee_id?: string
          is_manager?: boolean
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
      clean_employee_view_filter_node: {
        Args: { deleted_field: string; node: Json }
        Returns: Json
      }
      clean_old_realtime_events: { Args: never; Returns: undefined }
      cleanup_expired_auth_tokens: { Args: never; Returns: undefined }
      create_organization: { Args: { org_name: string }; Returns: string }
      generate_id: { Args: { prefix: string }; Returns: string }
      get_invitation_by_token: {
        Args: { invitation_token: string }
        Returns: Json
      }
      get_invitation_preview: {
        Args: { p_token: string }
        Returns: {
          employee_email: string
          organization_name: string
          status: Database["public"]["Enums"]["onboarding_invitations_status_enum"]
        }[]
      }
      get_my_member_organizations: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      get_organization_id_for_change: {
        Args: { p_record_data: Json; p_table_name: string }
        Returns: string
      }
      get_organization_role: { Args: { org_id: string }; Returns: string }
      has_pending_invitation: { Args: { org_id: string }; Returns: boolean }
      is_admin_or_owner: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      reorder_employee_views: { Args: { p_ids: string[] }; Returns: undefined }
    }
    Enums: {
      contracts_status_enum: "draft" | "sent" | "filled" | "active" | "voided"
      employee_column_type:
        | "text"
        | "number"
        | "date"
        | "boolean"
        | "multi_select"
        | "single_select"
      iana_timezone:
        | "Africa/Abidjan"
        | "Africa/Accra"
        | "Africa/Addis_Ababa"
        | "Africa/Algiers"
        | "Africa/Asmara"
        | "Africa/Asmera"
        | "Africa/Bamako"
        | "Africa/Bangui"
        | "Africa/Banjul"
        | "Africa/Bissau"
        | "Africa/Blantyre"
        | "Africa/Brazzaville"
        | "Africa/Bujumbura"
        | "Africa/Cairo"
        | "Africa/Casablanca"
        | "Africa/Ceuta"
        | "Africa/Conakry"
        | "Africa/Dakar"
        | "Africa/Dar_es_Salaam"
        | "Africa/Djibouti"
        | "Africa/Douala"
        | "Africa/El_Aaiun"
        | "Africa/Freetown"
        | "Africa/Gaborone"
        | "Africa/Harare"
        | "Africa/Johannesburg"
        | "Africa/Juba"
        | "Africa/Kampala"
        | "Africa/Khartoum"
        | "Africa/Kigali"
        | "Africa/Kinshasa"
        | "Africa/Lagos"
        | "Africa/Libreville"
        | "Africa/Lome"
        | "Africa/Luanda"
        | "Africa/Lubumbashi"
        | "Africa/Lusaka"
        | "Africa/Malabo"
        | "Africa/Maputo"
        | "Africa/Maseru"
        | "Africa/Mbabane"
        | "Africa/Mogadishu"
        | "Africa/Monrovia"
        | "Africa/Nairobi"
        | "Africa/Ndjamena"
        | "Africa/Niamey"
        | "Africa/Nouakchott"
        | "Africa/Ouagadougou"
        | "Africa/Porto-Novo"
        | "Africa/Sao_Tome"
        | "Africa/Timbuktu"
        | "Africa/Tripoli"
        | "Africa/Tunis"
        | "Africa/Windhoek"
        | "America/Adak"
        | "America/Anchorage"
        | "America/Anguilla"
        | "America/Antigua"
        | "America/Araguaina"
        | "America/Argentina/Buenos_Aires"
        | "America/Argentina/Catamarca"
        | "America/Argentina/ComodRivadavia"
        | "America/Argentina/Cordoba"
        | "America/Argentina/Jujuy"
        | "America/Argentina/La_Rioja"
        | "America/Argentina/Mendoza"
        | "America/Argentina/Rio_Gallegos"
        | "America/Argentina/Salta"
        | "America/Argentina/San_Juan"
        | "America/Argentina/San_Luis"
        | "America/Argentina/Tucuman"
        | "America/Argentina/Ushuaia"
        | "America/Aruba"
        | "America/Asuncion"
        | "America/Atikokan"
        | "America/Atka"
        | "America/Bahia"
        | "America/Bahia_Banderas"
        | "America/Barbados"
        | "America/Belem"
        | "America/Belize"
        | "America/Blanc-Sablon"
        | "America/Boa_Vista"
        | "America/Bogota"
        | "America/Boise"
        | "America/Buenos_Aires"
        | "America/Cambridge_Bay"
        | "America/Campo_Grande"
        | "America/Cancun"
        | "America/Caracas"
        | "America/Catamarca"
        | "America/Cayenne"
        | "America/Cayman"
        | "America/Chicago"
        | "America/Chihuahua"
        | "America/Ciudad_Juarez"
        | "America/Coral_Harbour"
        | "America/Cordoba"
        | "America/Costa_Rica"
        | "America/Coyhaique"
        | "America/Creston"
        | "America/Cuiaba"
        | "America/Curacao"
        | "America/Danmarkshavn"
        | "America/Dawson"
        | "America/Dawson_Creek"
        | "America/Denver"
        | "America/Detroit"
        | "America/Dominica"
        | "America/Edmonton"
        | "America/Eirunepe"
        | "America/El_Salvador"
        | "America/Ensenada"
        | "America/Fort_Nelson"
        | "America/Fort_Wayne"
        | "America/Fortaleza"
        | "America/Glace_Bay"
        | "America/Godthab"
        | "America/Goose_Bay"
        | "America/Grand_Turk"
        | "America/Grenada"
        | "America/Guadeloupe"
        | "America/Guatemala"
        | "America/Guayaquil"
        | "America/Guyana"
        | "America/Halifax"
        | "America/Havana"
        | "America/Hermosillo"
        | "America/Indiana/Indianapolis"
        | "America/Indiana/Knox"
        | "America/Indiana/Marengo"
        | "America/Indiana/Petersburg"
        | "America/Indiana/Tell_City"
        | "America/Indiana/Vevay"
        | "America/Indiana/Vincennes"
        | "America/Indiana/Winamac"
        | "America/Indianapolis"
        | "America/Inuvik"
        | "America/Iqaluit"
        | "America/Jamaica"
        | "America/Jujuy"
        | "America/Juneau"
        | "America/Kentucky/Louisville"
        | "America/Kentucky/Monticello"
        | "America/Knox_IN"
        | "America/Kralendijk"
        | "America/La_Paz"
        | "America/Lima"
        | "America/Los_Angeles"
        | "America/Louisville"
        | "America/Lower_Princes"
        | "America/Maceio"
        | "America/Managua"
        | "America/Manaus"
        | "America/Marigot"
        | "America/Martinique"
        | "America/Matamoros"
        | "America/Mazatlan"
        | "America/Mendoza"
        | "America/Menominee"
        | "America/Merida"
        | "America/Metlakatla"
        | "America/Mexico_City"
        | "America/Miquelon"
        | "America/Moncton"
        | "America/Monterrey"
        | "America/Montevideo"
        | "America/Montreal"
        | "America/Montserrat"
        | "America/Nassau"
        | "America/New_York"
        | "America/Nipigon"
        | "America/Nome"
        | "America/Noronha"
        | "America/North_Dakota/Beulah"
        | "America/North_Dakota/Center"
        | "America/North_Dakota/New_Salem"
        | "America/Nuuk"
        | "America/Ojinaga"
        | "America/Panama"
        | "America/Pangnirtung"
        | "America/Paramaribo"
        | "America/Phoenix"
        | "America/Port-au-Prince"
        | "America/Port_of_Spain"
        | "America/Porto_Acre"
        | "America/Porto_Velho"
        | "America/Puerto_Rico"
        | "America/Punta_Arenas"
        | "America/Rainy_River"
        | "America/Rankin_Inlet"
        | "America/Recife"
        | "America/Regina"
        | "America/Resolute"
        | "America/Rio_Branco"
        | "America/Rosario"
        | "America/Santa_Isabel"
        | "America/Santarem"
        | "America/Santiago"
        | "America/Santo_Domingo"
        | "America/Sao_Paulo"
        | "America/Scoresbysund"
        | "America/Shiprock"
        | "America/Sitka"
        | "America/St_Barthelemy"
        | "America/St_Johns"
        | "America/St_Kitts"
        | "America/St_Lucia"
        | "America/St_Thomas"
        | "America/St_Vincent"
        | "America/Swift_Current"
        | "America/Tegucigalpa"
        | "America/Thule"
        | "America/Thunder_Bay"
        | "America/Tijuana"
        | "America/Toronto"
        | "America/Tortola"
        | "America/Vancouver"
        | "America/Virgin"
        | "America/Whitehorse"
        | "America/Winnipeg"
        | "America/Yakutat"
        | "America/Yellowknife"
        | "Antarctica/Casey"
        | "Antarctica/Davis"
        | "Antarctica/DumontDUrville"
        | "Antarctica/Macquarie"
        | "Antarctica/Mawson"
        | "Antarctica/McMurdo"
        | "Antarctica/Palmer"
        | "Antarctica/Rothera"
        | "Antarctica/South_Pole"
        | "Antarctica/Syowa"
        | "Antarctica/Troll"
        | "Antarctica/Vostok"
        | "Arctic/Longyearbyen"
        | "Asia/Aden"
        | "Asia/Almaty"
        | "Asia/Amman"
        | "Asia/Anadyr"
        | "Asia/Aqtau"
        | "Asia/Aqtobe"
        | "Asia/Ashgabat"
        | "Asia/Ashkhabad"
        | "Asia/Atyrau"
        | "Asia/Baghdad"
        | "Asia/Bahrain"
        | "Asia/Baku"
        | "Asia/Bangkok"
        | "Asia/Barnaul"
        | "Asia/Beirut"
        | "Asia/Bishkek"
        | "Asia/Brunei"
        | "Asia/Calcutta"
        | "Asia/Chita"
        | "Asia/Choibalsan"
        | "Asia/Chongqing"
        | "Asia/Chungking"
        | "Asia/Colombo"
        | "Asia/Dacca"
        | "Asia/Damascus"
        | "Asia/Dhaka"
        | "Asia/Dili"
        | "Asia/Dubai"
        | "Asia/Dushanbe"
        | "Asia/Famagusta"
        | "Asia/Gaza"
        | "Asia/Harbin"
        | "Asia/Hebron"
        | "Asia/Ho_Chi_Minh"
        | "Asia/Hong_Kong"
        | "Asia/Hovd"
        | "Asia/Irkutsk"
        | "Asia/Istanbul"
        | "Asia/Jakarta"
        | "Asia/Jayapura"
        | "Asia/Jerusalem"
        | "Asia/Kabul"
        | "Asia/Kamchatka"
        | "Asia/Karachi"
        | "Asia/Kashgar"
        | "Asia/Kathmandu"
        | "Asia/Katmandu"
        | "Asia/Khandyga"
        | "Asia/Kolkata"
        | "Asia/Krasnoyarsk"
        | "Asia/Kuala_Lumpur"
        | "Asia/Kuching"
        | "Asia/Kuwait"
        | "Asia/Macao"
        | "Asia/Macau"
        | "Asia/Magadan"
        | "Asia/Makassar"
        | "Asia/Manila"
        | "Asia/Muscat"
        | "Asia/Nicosia"
        | "Asia/Novokuznetsk"
        | "Asia/Novosibirsk"
        | "Asia/Omsk"
        | "Asia/Oral"
        | "Asia/Phnom_Penh"
        | "Asia/Pontianak"
        | "Asia/Pyongyang"
        | "Asia/Qatar"
        | "Asia/Qostanay"
        | "Asia/Qyzylorda"
        | "Asia/Rangoon"
        | "Asia/Riyadh"
        | "Asia/Saigon"
        | "Asia/Sakhalin"
        | "Asia/Samarkand"
        | "Asia/Seoul"
        | "Asia/Shanghai"
        | "Asia/Singapore"
        | "Asia/Srednekolymsk"
        | "Asia/Taipei"
        | "Asia/Tashkent"
        | "Asia/Tbilisi"
        | "Asia/Tehran"
        | "Asia/Tel_Aviv"
        | "Asia/Thimbu"
        | "Asia/Thimphu"
        | "Asia/Tokyo"
        | "Asia/Tomsk"
        | "Asia/Ujung_Pandang"
        | "Asia/Ulaanbaatar"
        | "Asia/Ulan_Bator"
        | "Asia/Urumqi"
        | "Asia/Ust-Nera"
        | "Asia/Vientiane"
        | "Asia/Vladivostok"
        | "Asia/Yakutsk"
        | "Asia/Yangon"
        | "Asia/Yekaterinburg"
        | "Asia/Yerevan"
        | "Atlantic/Azores"
        | "Atlantic/Bermuda"
        | "Atlantic/Canary"
        | "Atlantic/Cape_Verde"
        | "Atlantic/Faeroe"
        | "Atlantic/Faroe"
        | "Atlantic/Jan_Mayen"
        | "Atlantic/Madeira"
        | "Atlantic/Reykjavik"
        | "Atlantic/South_Georgia"
        | "Atlantic/St_Helena"
        | "Atlantic/Stanley"
        | "Australia/ACT"
        | "Australia/Adelaide"
        | "Australia/Brisbane"
        | "Australia/Broken_Hill"
        | "Australia/Canberra"
        | "Australia/Currie"
        | "Australia/Darwin"
        | "Australia/Eucla"
        | "Australia/Hobart"
        | "Australia/LHI"
        | "Australia/Lindeman"
        | "Australia/Lord_Howe"
        | "Australia/Melbourne"
        | "Australia/NSW"
        | "Australia/North"
        | "Australia/Perth"
        | "Australia/Queensland"
        | "Australia/South"
        | "Australia/Sydney"
        | "Australia/Tasmania"
        | "Australia/Victoria"
        | "Australia/West"
        | "Australia/Yancowinna"
        | "Brazil/Acre"
        | "Brazil/DeNoronha"
        | "Brazil/East"
        | "Brazil/West"
        | "CET"
        | "CST6CDT"
        | "Canada/Atlantic"
        | "Canada/Central"
        | "Canada/Eastern"
        | "Canada/Mountain"
        | "Canada/Newfoundland"
        | "Canada/Pacific"
        | "Canada/Saskatchewan"
        | "Canada/Yukon"
        | "Chile/Continental"
        | "Chile/EasterIsland"
        | "Cuba"
        | "EET"
        | "EST"
        | "EST5EDT"
        | "Egypt"
        | "Eire"
        | "Europe/Amsterdam"
        | "Europe/Andorra"
        | "Europe/Astrakhan"
        | "Europe/Athens"
        | "Europe/Belfast"
        | "Europe/Belgrade"
        | "Europe/Berlin"
        | "Europe/Bratislava"
        | "Europe/Brussels"
        | "Europe/Bucharest"
        | "Europe/Budapest"
        | "Europe/Busingen"
        | "Europe/Chisinau"
        | "Europe/Copenhagen"
        | "Europe/Dublin"
        | "Europe/Gibraltar"
        | "Europe/Guernsey"
        | "Europe/Helsinki"
        | "Europe/Isle_of_Man"
        | "Europe/Istanbul"
        | "Europe/Jersey"
        | "Europe/Kaliningrad"
        | "Europe/Kiev"
        | "Europe/Kirov"
        | "Europe/Kyiv"
        | "Europe/Lisbon"
        | "Europe/Ljubljana"
        | "Europe/London"
        | "Europe/Luxembourg"
        | "Europe/Madrid"
        | "Europe/Malta"
        | "Europe/Mariehamn"
        | "Europe/Minsk"
        | "Europe/Monaco"
        | "Europe/Moscow"
        | "Europe/Nicosia"
        | "Europe/Oslo"
        | "Europe/Paris"
        | "Europe/Podgorica"
        | "Europe/Prague"
        | "Europe/Riga"
        | "Europe/Rome"
        | "Europe/Samara"
        | "Europe/San_Marino"
        | "Europe/Sarajevo"
        | "Europe/Saratov"
        | "Europe/Simferopol"
        | "Europe/Skopje"
        | "Europe/Sofia"
        | "Europe/Stockholm"
        | "Europe/Tallinn"
        | "Europe/Tirane"
        | "Europe/Tiraspol"
        | "Europe/Ulyanovsk"
        | "Europe/Uzhgorod"
        | "Europe/Vaduz"
        | "Europe/Vatican"
        | "Europe/Vienna"
        | "Europe/Vilnius"
        | "Europe/Volgograd"
        | "Europe/Warsaw"
        | "Europe/Zagreb"
        | "Europe/Zaporozhye"
        | "Europe/Zurich"
        | "GB"
        | "GB-Eire"
        | "HST"
        | "Hongkong"
        | "Iceland"
        | "Indian/Antananarivo"
        | "Indian/Chagos"
        | "Indian/Christmas"
        | "Indian/Cocos"
        | "Indian/Comoro"
        | "Indian/Kerguelen"
        | "Indian/Mahe"
        | "Indian/Maldives"
        | "Indian/Mauritius"
        | "Indian/Mayotte"
        | "Indian/Reunion"
        | "Iran"
        | "Israel"
        | "Jamaica"
        | "Japan"
        | "Kwajalein"
        | "Libya"
        | "MET"
        | "MST"
        | "MST7MDT"
        | "Mexico/BajaNorte"
        | "Mexico/BajaSur"
        | "Mexico/General"
        | "NZ"
        | "NZ-CHAT"
        | "Navajo"
        | "PRC"
        | "PST8PDT"
        | "Pacific/Apia"
        | "Pacific/Auckland"
        | "Pacific/Bougainville"
        | "Pacific/Chatham"
        | "Pacific/Chuuk"
        | "Pacific/Easter"
        | "Pacific/Efate"
        | "Pacific/Enderbury"
        | "Pacific/Fakaofo"
        | "Pacific/Fiji"
        | "Pacific/Funafuti"
        | "Pacific/Galapagos"
        | "Pacific/Gambier"
        | "Pacific/Guadalcanal"
        | "Pacific/Guam"
        | "Pacific/Honolulu"
        | "Pacific/Johnston"
        | "Pacific/Kanton"
        | "Pacific/Kiritimati"
        | "Pacific/Kosrae"
        | "Pacific/Kwajalein"
        | "Pacific/Majuro"
        | "Pacific/Marquesas"
        | "Pacific/Midway"
        | "Pacific/Nauru"
        | "Pacific/Niue"
        | "Pacific/Norfolk"
        | "Pacific/Noumea"
        | "Pacific/Pago_Pago"
        | "Pacific/Palau"
        | "Pacific/Pitcairn"
        | "Pacific/Pohnpei"
        | "Pacific/Ponape"
        | "Pacific/Port_Moresby"
        | "Pacific/Rarotonga"
        | "Pacific/Saipan"
        | "Pacific/Samoa"
        | "Pacific/Tahiti"
        | "Pacific/Tarawa"
        | "Pacific/Tongatapu"
        | "Pacific/Truk"
        | "Pacific/Wake"
        | "Pacific/Wallis"
        | "Pacific/Yap"
        | "Poland"
        | "Portugal"
        | "ROC"
        | "ROK"
        | "Singapore"
        | "Turkey"
        | "US/Alaska"
        | "US/Aleutian"
        | "US/Arizona"
        | "US/Central"
        | "US/East-Indiana"
        | "US/Eastern"
        | "US/Hawaii"
        | "US/Indiana-Starke"
        | "US/Michigan"
        | "US/Mountain"
        | "US/Pacific"
        | "US/Samoa"
        | "UTC"
        | "W-SU"
        | "WET"
      onboarding_invitations_status_enum:
        | "sent"
        | "accepted"
        | "expired"
        | "revoked"
        | "approved"
      realtime_table_events_event_type_enum: "INSERT" | "UPDATE" | "DELETE"
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
      contracts_status_enum: ["draft", "sent", "filled", "active", "voided"],
      employee_column_type: [
        "text",
        "number",
        "date",
        "boolean",
        "multi_select",
        "single_select",
      ],
      iana_timezone: [
        "Africa/Abidjan",
        "Africa/Accra",
        "Africa/Addis_Ababa",
        "Africa/Algiers",
        "Africa/Asmara",
        "Africa/Asmera",
        "Africa/Bamako",
        "Africa/Bangui",
        "Africa/Banjul",
        "Africa/Bissau",
        "Africa/Blantyre",
        "Africa/Brazzaville",
        "Africa/Bujumbura",
        "Africa/Cairo",
        "Africa/Casablanca",
        "Africa/Ceuta",
        "Africa/Conakry",
        "Africa/Dakar",
        "Africa/Dar_es_Salaam",
        "Africa/Djibouti",
        "Africa/Douala",
        "Africa/El_Aaiun",
        "Africa/Freetown",
        "Africa/Gaborone",
        "Africa/Harare",
        "Africa/Johannesburg",
        "Africa/Juba",
        "Africa/Kampala",
        "Africa/Khartoum",
        "Africa/Kigali",
        "Africa/Kinshasa",
        "Africa/Lagos",
        "Africa/Libreville",
        "Africa/Lome",
        "Africa/Luanda",
        "Africa/Lubumbashi",
        "Africa/Lusaka",
        "Africa/Malabo",
        "Africa/Maputo",
        "Africa/Maseru",
        "Africa/Mbabane",
        "Africa/Mogadishu",
        "Africa/Monrovia",
        "Africa/Nairobi",
        "Africa/Ndjamena",
        "Africa/Niamey",
        "Africa/Nouakchott",
        "Africa/Ouagadougou",
        "Africa/Porto-Novo",
        "Africa/Sao_Tome",
        "Africa/Timbuktu",
        "Africa/Tripoli",
        "Africa/Tunis",
        "Africa/Windhoek",
        "America/Adak",
        "America/Anchorage",
        "America/Anguilla",
        "America/Antigua",
        "America/Araguaina",
        "America/Argentina/Buenos_Aires",
        "America/Argentina/Catamarca",
        "America/Argentina/ComodRivadavia",
        "America/Argentina/Cordoba",
        "America/Argentina/Jujuy",
        "America/Argentina/La_Rioja",
        "America/Argentina/Mendoza",
        "America/Argentina/Rio_Gallegos",
        "America/Argentina/Salta",
        "America/Argentina/San_Juan",
        "America/Argentina/San_Luis",
        "America/Argentina/Tucuman",
        "America/Argentina/Ushuaia",
        "America/Aruba",
        "America/Asuncion",
        "America/Atikokan",
        "America/Atka",
        "America/Bahia",
        "America/Bahia_Banderas",
        "America/Barbados",
        "America/Belem",
        "America/Belize",
        "America/Blanc-Sablon",
        "America/Boa_Vista",
        "America/Bogota",
        "America/Boise",
        "America/Buenos_Aires",
        "America/Cambridge_Bay",
        "America/Campo_Grande",
        "America/Cancun",
        "America/Caracas",
        "America/Catamarca",
        "America/Cayenne",
        "America/Cayman",
        "America/Chicago",
        "America/Chihuahua",
        "America/Ciudad_Juarez",
        "America/Coral_Harbour",
        "America/Cordoba",
        "America/Costa_Rica",
        "America/Coyhaique",
        "America/Creston",
        "America/Cuiaba",
        "America/Curacao",
        "America/Danmarkshavn",
        "America/Dawson",
        "America/Dawson_Creek",
        "America/Denver",
        "America/Detroit",
        "America/Dominica",
        "America/Edmonton",
        "America/Eirunepe",
        "America/El_Salvador",
        "America/Ensenada",
        "America/Fort_Nelson",
        "America/Fort_Wayne",
        "America/Fortaleza",
        "America/Glace_Bay",
        "America/Godthab",
        "America/Goose_Bay",
        "America/Grand_Turk",
        "America/Grenada",
        "America/Guadeloupe",
        "America/Guatemala",
        "America/Guayaquil",
        "America/Guyana",
        "America/Halifax",
        "America/Havana",
        "America/Hermosillo",
        "America/Indiana/Indianapolis",
        "America/Indiana/Knox",
        "America/Indiana/Marengo",
        "America/Indiana/Petersburg",
        "America/Indiana/Tell_City",
        "America/Indiana/Vevay",
        "America/Indiana/Vincennes",
        "America/Indiana/Winamac",
        "America/Indianapolis",
        "America/Inuvik",
        "America/Iqaluit",
        "America/Jamaica",
        "America/Jujuy",
        "America/Juneau",
        "America/Kentucky/Louisville",
        "America/Kentucky/Monticello",
        "America/Knox_IN",
        "America/Kralendijk",
        "America/La_Paz",
        "America/Lima",
        "America/Los_Angeles",
        "America/Louisville",
        "America/Lower_Princes",
        "America/Maceio",
        "America/Managua",
        "America/Manaus",
        "America/Marigot",
        "America/Martinique",
        "America/Matamoros",
        "America/Mazatlan",
        "America/Mendoza",
        "America/Menominee",
        "America/Merida",
        "America/Metlakatla",
        "America/Mexico_City",
        "America/Miquelon",
        "America/Moncton",
        "America/Monterrey",
        "America/Montevideo",
        "America/Montreal",
        "America/Montserrat",
        "America/Nassau",
        "America/New_York",
        "America/Nipigon",
        "America/Nome",
        "America/Noronha",
        "America/North_Dakota/Beulah",
        "America/North_Dakota/Center",
        "America/North_Dakota/New_Salem",
        "America/Nuuk",
        "America/Ojinaga",
        "America/Panama",
        "America/Pangnirtung",
        "America/Paramaribo",
        "America/Phoenix",
        "America/Port-au-Prince",
        "America/Port_of_Spain",
        "America/Porto_Acre",
        "America/Porto_Velho",
        "America/Puerto_Rico",
        "America/Punta_Arenas",
        "America/Rainy_River",
        "America/Rankin_Inlet",
        "America/Recife",
        "America/Regina",
        "America/Resolute",
        "America/Rio_Branco",
        "America/Rosario",
        "America/Santa_Isabel",
        "America/Santarem",
        "America/Santiago",
        "America/Santo_Domingo",
        "America/Sao_Paulo",
        "America/Scoresbysund",
        "America/Shiprock",
        "America/Sitka",
        "America/St_Barthelemy",
        "America/St_Johns",
        "America/St_Kitts",
        "America/St_Lucia",
        "America/St_Thomas",
        "America/St_Vincent",
        "America/Swift_Current",
        "America/Tegucigalpa",
        "America/Thule",
        "America/Thunder_Bay",
        "America/Tijuana",
        "America/Toronto",
        "America/Tortola",
        "America/Vancouver",
        "America/Virgin",
        "America/Whitehorse",
        "America/Winnipeg",
        "America/Yakutat",
        "America/Yellowknife",
        "Antarctica/Casey",
        "Antarctica/Davis",
        "Antarctica/DumontDUrville",
        "Antarctica/Macquarie",
        "Antarctica/Mawson",
        "Antarctica/McMurdo",
        "Antarctica/Palmer",
        "Antarctica/Rothera",
        "Antarctica/South_Pole",
        "Antarctica/Syowa",
        "Antarctica/Troll",
        "Antarctica/Vostok",
        "Arctic/Longyearbyen",
        "Asia/Aden",
        "Asia/Almaty",
        "Asia/Amman",
        "Asia/Anadyr",
        "Asia/Aqtau",
        "Asia/Aqtobe",
        "Asia/Ashgabat",
        "Asia/Ashkhabad",
        "Asia/Atyrau",
        "Asia/Baghdad",
        "Asia/Bahrain",
        "Asia/Baku",
        "Asia/Bangkok",
        "Asia/Barnaul",
        "Asia/Beirut",
        "Asia/Bishkek",
        "Asia/Brunei",
        "Asia/Calcutta",
        "Asia/Chita",
        "Asia/Choibalsan",
        "Asia/Chongqing",
        "Asia/Chungking",
        "Asia/Colombo",
        "Asia/Dacca",
        "Asia/Damascus",
        "Asia/Dhaka",
        "Asia/Dili",
        "Asia/Dubai",
        "Asia/Dushanbe",
        "Asia/Famagusta",
        "Asia/Gaza",
        "Asia/Harbin",
        "Asia/Hebron",
        "Asia/Ho_Chi_Minh",
        "Asia/Hong_Kong",
        "Asia/Hovd",
        "Asia/Irkutsk",
        "Asia/Istanbul",
        "Asia/Jakarta",
        "Asia/Jayapura",
        "Asia/Jerusalem",
        "Asia/Kabul",
        "Asia/Kamchatka",
        "Asia/Karachi",
        "Asia/Kashgar",
        "Asia/Kathmandu",
        "Asia/Katmandu",
        "Asia/Khandyga",
        "Asia/Kolkata",
        "Asia/Krasnoyarsk",
        "Asia/Kuala_Lumpur",
        "Asia/Kuching",
        "Asia/Kuwait",
        "Asia/Macao",
        "Asia/Macau",
        "Asia/Magadan",
        "Asia/Makassar",
        "Asia/Manila",
        "Asia/Muscat",
        "Asia/Nicosia",
        "Asia/Novokuznetsk",
        "Asia/Novosibirsk",
        "Asia/Omsk",
        "Asia/Oral",
        "Asia/Phnom_Penh",
        "Asia/Pontianak",
        "Asia/Pyongyang",
        "Asia/Qatar",
        "Asia/Qostanay",
        "Asia/Qyzylorda",
        "Asia/Rangoon",
        "Asia/Riyadh",
        "Asia/Saigon",
        "Asia/Sakhalin",
        "Asia/Samarkand",
        "Asia/Seoul",
        "Asia/Shanghai",
        "Asia/Singapore",
        "Asia/Srednekolymsk",
        "Asia/Taipei",
        "Asia/Tashkent",
        "Asia/Tbilisi",
        "Asia/Tehran",
        "Asia/Tel_Aviv",
        "Asia/Thimbu",
        "Asia/Thimphu",
        "Asia/Tokyo",
        "Asia/Tomsk",
        "Asia/Ujung_Pandang",
        "Asia/Ulaanbaatar",
        "Asia/Ulan_Bator",
        "Asia/Urumqi",
        "Asia/Ust-Nera",
        "Asia/Vientiane",
        "Asia/Vladivostok",
        "Asia/Yakutsk",
        "Asia/Yangon",
        "Asia/Yekaterinburg",
        "Asia/Yerevan",
        "Atlantic/Azores",
        "Atlantic/Bermuda",
        "Atlantic/Canary",
        "Atlantic/Cape_Verde",
        "Atlantic/Faeroe",
        "Atlantic/Faroe",
        "Atlantic/Jan_Mayen",
        "Atlantic/Madeira",
        "Atlantic/Reykjavik",
        "Atlantic/South_Georgia",
        "Atlantic/St_Helena",
        "Atlantic/Stanley",
        "Australia/ACT",
        "Australia/Adelaide",
        "Australia/Brisbane",
        "Australia/Broken_Hill",
        "Australia/Canberra",
        "Australia/Currie",
        "Australia/Darwin",
        "Australia/Eucla",
        "Australia/Hobart",
        "Australia/LHI",
        "Australia/Lindeman",
        "Australia/Lord_Howe",
        "Australia/Melbourne",
        "Australia/NSW",
        "Australia/North",
        "Australia/Perth",
        "Australia/Queensland",
        "Australia/South",
        "Australia/Sydney",
        "Australia/Tasmania",
        "Australia/Victoria",
        "Australia/West",
        "Australia/Yancowinna",
        "Brazil/Acre",
        "Brazil/DeNoronha",
        "Brazil/East",
        "Brazil/West",
        "CET",
        "CST6CDT",
        "Canada/Atlantic",
        "Canada/Central",
        "Canada/Eastern",
        "Canada/Mountain",
        "Canada/Newfoundland",
        "Canada/Pacific",
        "Canada/Saskatchewan",
        "Canada/Yukon",
        "Chile/Continental",
        "Chile/EasterIsland",
        "Cuba",
        "EET",
        "EST",
        "EST5EDT",
        "Egypt",
        "Eire",
        "Europe/Amsterdam",
        "Europe/Andorra",
        "Europe/Astrakhan",
        "Europe/Athens",
        "Europe/Belfast",
        "Europe/Belgrade",
        "Europe/Berlin",
        "Europe/Bratislava",
        "Europe/Brussels",
        "Europe/Bucharest",
        "Europe/Budapest",
        "Europe/Busingen",
        "Europe/Chisinau",
        "Europe/Copenhagen",
        "Europe/Dublin",
        "Europe/Gibraltar",
        "Europe/Guernsey",
        "Europe/Helsinki",
        "Europe/Isle_of_Man",
        "Europe/Istanbul",
        "Europe/Jersey",
        "Europe/Kaliningrad",
        "Europe/Kiev",
        "Europe/Kirov",
        "Europe/Kyiv",
        "Europe/Lisbon",
        "Europe/Ljubljana",
        "Europe/London",
        "Europe/Luxembourg",
        "Europe/Madrid",
        "Europe/Malta",
        "Europe/Mariehamn",
        "Europe/Minsk",
        "Europe/Monaco",
        "Europe/Moscow",
        "Europe/Nicosia",
        "Europe/Oslo",
        "Europe/Paris",
        "Europe/Podgorica",
        "Europe/Prague",
        "Europe/Riga",
        "Europe/Rome",
        "Europe/Samara",
        "Europe/San_Marino",
        "Europe/Sarajevo",
        "Europe/Saratov",
        "Europe/Simferopol",
        "Europe/Skopje",
        "Europe/Sofia",
        "Europe/Stockholm",
        "Europe/Tallinn",
        "Europe/Tirane",
        "Europe/Tiraspol",
        "Europe/Ulyanovsk",
        "Europe/Uzhgorod",
        "Europe/Vaduz",
        "Europe/Vatican",
        "Europe/Vienna",
        "Europe/Vilnius",
        "Europe/Volgograd",
        "Europe/Warsaw",
        "Europe/Zagreb",
        "Europe/Zaporozhye",
        "Europe/Zurich",
        "GB",
        "GB-Eire",
        "HST",
        "Hongkong",
        "Iceland",
        "Indian/Antananarivo",
        "Indian/Chagos",
        "Indian/Christmas",
        "Indian/Cocos",
        "Indian/Comoro",
        "Indian/Kerguelen",
        "Indian/Mahe",
        "Indian/Maldives",
        "Indian/Mauritius",
        "Indian/Mayotte",
        "Indian/Reunion",
        "Iran",
        "Israel",
        "Jamaica",
        "Japan",
        "Kwajalein",
        "Libya",
        "MET",
        "MST",
        "MST7MDT",
        "Mexico/BajaNorte",
        "Mexico/BajaSur",
        "Mexico/General",
        "NZ",
        "NZ-CHAT",
        "Navajo",
        "PRC",
        "PST8PDT",
        "Pacific/Apia",
        "Pacific/Auckland",
        "Pacific/Bougainville",
        "Pacific/Chatham",
        "Pacific/Chuuk",
        "Pacific/Easter",
        "Pacific/Efate",
        "Pacific/Enderbury",
        "Pacific/Fakaofo",
        "Pacific/Fiji",
        "Pacific/Funafuti",
        "Pacific/Galapagos",
        "Pacific/Gambier",
        "Pacific/Guadalcanal",
        "Pacific/Guam",
        "Pacific/Honolulu",
        "Pacific/Johnston",
        "Pacific/Kanton",
        "Pacific/Kiritimati",
        "Pacific/Kosrae",
        "Pacific/Kwajalein",
        "Pacific/Majuro",
        "Pacific/Marquesas",
        "Pacific/Midway",
        "Pacific/Nauru",
        "Pacific/Niue",
        "Pacific/Norfolk",
        "Pacific/Noumea",
        "Pacific/Pago_Pago",
        "Pacific/Palau",
        "Pacific/Pitcairn",
        "Pacific/Pohnpei",
        "Pacific/Ponape",
        "Pacific/Port_Moresby",
        "Pacific/Rarotonga",
        "Pacific/Saipan",
        "Pacific/Samoa",
        "Pacific/Tahiti",
        "Pacific/Tarawa",
        "Pacific/Tongatapu",
        "Pacific/Truk",
        "Pacific/Wake",
        "Pacific/Wallis",
        "Pacific/Yap",
        "Poland",
        "Portugal",
        "ROC",
        "ROK",
        "Singapore",
        "Turkey",
        "US/Alaska",
        "US/Aleutian",
        "US/Arizona",
        "US/Central",
        "US/East-Indiana",
        "US/Eastern",
        "US/Hawaii",
        "US/Indiana-Starke",
        "US/Michigan",
        "US/Mountain",
        "US/Pacific",
        "US/Samoa",
        "UTC",
        "W-SU",
        "WET",
      ],
      onboarding_invitations_status_enum: [
        "sent",
        "accepted",
        "expired",
        "revoked",
        "approved",
      ],
      realtime_table_events_event_type_enum: ["INSERT", "UPDATE", "DELETE"],
    },
  },
} as const

