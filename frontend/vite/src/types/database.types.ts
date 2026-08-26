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
      ai_usage_daily: {
        Row: {
          day: string
          request_count: number
          scope: string
          scope_id: string
          updated_at: string
        }
        Insert: {
          day: string
          request_count?: number
          scope: string
          scope_id: string
          updated_at?: string
        }
        Update: {
          day?: string
          request_count?: number
          scope?: string
          scope_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_idempotency_keys: {
        Row: {
          api_key_id: string | null
          completed_at: string | null
          created_at: string
          endpoint: string
          idempotency_key: string
          organization_id: string
          request_fingerprint: string
          response_body: Json | null
          response_status: number | null
        }
        Insert: {
          api_key_id?: string | null
          completed_at?: string | null
          created_at?: string
          endpoint: string
          idempotency_key: string
          organization_id: string
          request_fingerprint: string
          response_body?: Json | null
          response_status?: number | null
        }
        Update: {
          api_key_id?: string | null
          completed_at?: string | null
          created_at?: string
          endpoint?: string
          idempotency_key?: string
          organization_id?: string
          request_fingerprint?: string
          response_body?: Json | null
          response_status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_idempotency_keys_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_idempotency_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          allowed_embed_origins: string[]
          created_at: string
          created_by_user_id: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          last_used_ip: unknown
          name: string
          organization_id: string
          revoked_at: string | null
          scopes: Database["public"]["Enums"]["api_keys_scopes_enum"][]
          updated_at: string
        }
        Insert: {
          allowed_embed_origins?: string[]
          created_at?: string
          created_by_user_id: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          last_used_ip?: unknown
          name: string
          organization_id: string
          revoked_at?: string | null
          scopes: Database["public"]["Enums"]["api_keys_scopes_enum"][]
          updated_at?: string
        }
        Update: {
          allowed_embed_origins?: string[]
          created_at?: string
          created_by_user_id?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          last_used_ip?: unknown
          name?: string
          organization_id?: string
          revoked_at?: string | null
          scopes?: Database["public"]["Enums"]["api_keys_scopes_enum"][]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limits: {
        Row: {
          attempt_count: number
          client_key: string
          window_start: string
        }
        Insert: {
          attempt_count?: number
          client_key: string
          window_start?: string
        }
        Update: {
          attempt_count?: number
          client_key?: string
          window_start?: string
        }
        Relationships: []
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
      contract_template_versions: {
        Row: {
          content_hash: string
          created_at: string
          created_by: string | null
          default_expiry_days: number | null
          default_reminder_days: number[]
          id: string
          layout: Json
          organization_id: string
          pdf_file_id: string | null
          pdf_file_path: string | null
          signer_roles: Json
          template_id: string
          type: Database["public"]["Enums"]["contract_template_type_enum"]
          version_number: number
        }
        Insert: {
          content_hash: string
          created_at?: string
          created_by?: string | null
          default_expiry_days?: number | null
          default_reminder_days?: number[]
          id?: string
          layout?: Json
          organization_id: string
          pdf_file_id?: string | null
          pdf_file_path?: string | null
          signer_roles?: Json
          template_id: string
          type: Database["public"]["Enums"]["contract_template_type_enum"]
          version_number: number
        }
        Update: {
          content_hash?: string
          created_at?: string
          created_by?: string | null
          default_expiry_days?: number | null
          default_reminder_days?: number[]
          id?: string
          layout?: Json
          organization_id?: string
          pdf_file_id?: string | null
          pdf_file_path?: string | null
          signer_roles?: Json
          template_id?: string
          type?: Database["public"]["Enums"]["contract_template_type_enum"]
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_template_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_template_versions_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          created_at: string | null
          default_expiry_days: number | null
          default_reminder_days: number[]
          entity_id: string
          id: string
          is_ad_hoc: boolean
          is_archived: boolean
          layout: Json
          name: string
          organization_id: string
          pdf_file_id: string | null
          pdf_file_path: string | null
          signer_roles: Json
          type: Database["public"]["Enums"]["contract_template_type_enum"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_expiry_days?: number | null
          default_reminder_days?: number[]
          entity_id: string
          id?: string
          is_ad_hoc?: boolean
          is_archived?: boolean
          layout?: Json
          name: string
          organization_id?: string
          pdf_file_id?: string | null
          pdf_file_path?: string | null
          signer_roles?: Json
          type?: Database["public"]["Enums"]["contract_template_type_enum"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_expiry_days?: number | null
          default_reminder_days?: number[]
          entity_id?: string
          id?: string
          is_ad_hoc?: boolean
          is_archived?: boolean
          layout?: Json
          name?: string
          organization_id?: string
          pdf_file_id?: string | null
          pdf_file_path?: string | null
          signer_roles?: Json
          type?: Database["public"]["Enums"]["contract_template_type_enum"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_templates_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_templates_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_dispatch_config: {
        Row: {
          cron_secret: string | null
          functions_base_url: string | null
          id: string
          updated_at: string
        }
        Insert: {
          cron_secret?: string | null
          functions_base_url?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          cron_secret?: string | null
          functions_base_url?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
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
          folder_id: string | null
          id: string
          name: string
          organization_id: string | null
          r2_key: string
          size: number
          thumbnail_r2_key: string | null
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          content_type: string
          created_at?: string | null
          folder_id?: string | null
          id?: string
          name: string
          organization_id?: string | null
          r2_key: string
          size: number
          thumbnail_r2_key?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string | null
          folder_id?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          r2_key?: string
          size?: number
          thumbnail_r2_key?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
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
      folders: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: string
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
          role?: string
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
          role?: string
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
      members: {
        Row: {
          __full_name: string | null
          birthday: string
          can_manage_templates: boolean
          can_send_documents: boolean
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
          __full_name?: string | null
          birthday?: string
          can_manage_templates?: boolean
          can_send_documents?: boolean
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          organization_id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          __full_name?: string | null
          birthday?: string
          can_manage_templates?: boolean
          can_send_documents?: boolean
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          emailed: boolean
          id: string
          link: string | null
          metadata: Json
          organization_id: string | null
          read_at: string | null
          request_id: string | null
          title: string
          type: Database["public"]["Enums"]["notifications_type_enum"]
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          emailed?: boolean
          id?: string
          link?: string | null
          metadata?: Json
          organization_id?: string | null
          read_at?: string | null
          request_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notifications_type_enum"]
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          emailed?: boolean
          id?: string
          link?: string | null
          metadata?: Json
          organization_id?: string | null
          read_at?: string | null
          request_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notifications_type_enum"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_assistant_enabled: boolean
          created_at: string
          id: string
          is_personal: boolean
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          ai_assistant_enabled?: boolean
          created_at?: string
          id?: string
          is_personal?: boolean
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          ai_assistant_enabled?: boolean
          created_at?: string
          id?: string
          is_personal?: boolean
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
          avatar_file_id: string | null
          avatar_url: string | null
          created_at: string
          email: string
          email_verified: boolean
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          whitelist: boolean
        }
        Insert: {
          avatar_file_id?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          email_verified?: boolean
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
          whitelist?: boolean
        }
        Update: {
          avatar_file_id?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          email_verified?: boolean
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          whitelist?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_avatar_file_id_fkey"
            columns: ["avatar_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
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
      signature_audit_log: {
        Row: {
          actor_user_id: string | null
          entry_hash: string
          event_type: Database["public"]["Enums"]["signature_audit_log_event_type_enum"]
          id: string
          occurred_at: string
          organization_id: string
          payload: Json
          prev_hash: string | null
          request_id: string
          seq: number
          signer_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          entry_hash: string
          event_type: Database["public"]["Enums"]["signature_audit_log_event_type_enum"]
          id?: string
          occurred_at?: string
          organization_id: string
          payload?: Json
          prev_hash?: string | null
          request_id: string
          seq: number
          signer_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          entry_hash?: string
          event_type?: Database["public"]["Enums"]["signature_audit_log_event_type_enum"]
          id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
          prev_hash?: string | null
          request_id?: string
          seq?: number
          signer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_captures: {
        Row: {
          capture_method: Database["public"]["Enums"]["signature_captures_capture_method_enum"]
          captured_at: string
          captured_ip: unknown
          captured_user_agent: string | null
          id: string
          request_id: string
          signature_file_id: string | null
          signature_r2_key: string
          signature_sha256: string
          signer_id: string
          signer_user_id: string | null
          superseded_at: string | null
        }
        Insert: {
          capture_method: Database["public"]["Enums"]["signature_captures_capture_method_enum"]
          captured_at?: string
          captured_ip?: unknown
          captured_user_agent?: string | null
          id?: string
          request_id: string
          signature_file_id?: string | null
          signature_r2_key: string
          signature_sha256: string
          signer_id: string
          signer_user_id?: string | null
          superseded_at?: string | null
        }
        Update: {
          capture_method?: Database["public"]["Enums"]["signature_captures_capture_method_enum"]
          captured_at?: string
          captured_ip?: unknown
          captured_user_agent?: string | null
          id?: string
          request_id?: string
          signature_file_id?: string | null
          signature_r2_key?: string
          signature_sha256?: string
          signer_id?: string
          signer_user_id?: string | null
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_captures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_captures_signature_file_id_fkey"
            columns: ["signature_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_captures_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "signature_request_signers"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_request_signers: {
        Row: {
          auth_method:
            | Database["public"]["Enums"]["signature_requests_signer_auth_enum"]
            | null
          changes_requested_reason: string | null
          created_at: string
          decline_reason: string | null
          field_values: Json
          id: string
          last_reminded_at: string | null
          notified_at: string | null
          organization_id: string
          recipient_type: Database["public"]["Enums"]["signature_request_signers_recipient_type_enum"]
          reminder_count: number
          request_id: string
          require_identity_check: boolean | null
          role_id: string | null
          signed_at: string | null
          signer_email: string
          signer_name: string
          signer_order: number
          signer_phone: string | null
          signer_user_id: string | null
          status: Database["public"]["Enums"]["signature_request_signers_status_enum"]
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          auth_method?:
            | Database["public"]["Enums"]["signature_requests_signer_auth_enum"]
            | null
          changes_requested_reason?: string | null
          created_at?: string
          decline_reason?: string | null
          field_values?: Json
          id?: string
          last_reminded_at?: string | null
          notified_at?: string | null
          organization_id: string
          recipient_type?: Database["public"]["Enums"]["signature_request_signers_recipient_type_enum"]
          reminder_count?: number
          request_id: string
          require_identity_check?: boolean | null
          role_id?: string | null
          signed_at?: string | null
          signer_email: string
          signer_name: string
          signer_order: number
          signer_phone?: string | null
          signer_user_id?: string | null
          status?: Database["public"]["Enums"]["signature_request_signers_status_enum"]
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          auth_method?:
            | Database["public"]["Enums"]["signature_requests_signer_auth_enum"]
            | null
          changes_requested_reason?: string | null
          created_at?: string
          decline_reason?: string | null
          field_values?: Json
          id?: string
          last_reminded_at?: string | null
          notified_at?: string | null
          organization_id?: string
          recipient_type?: Database["public"]["Enums"]["signature_request_signers_recipient_type_enum"]
          reminder_count?: number
          request_id?: string
          require_identity_check?: boolean | null
          role_id?: string | null
          signed_at?: string | null
          signer_email?: string
          signer_name?: string
          signer_order?: number
          signer_phone?: string | null
          signer_user_id?: string | null
          status?: Database["public"]["Enums"]["signature_request_signers_status_enum"]
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_request_signers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_request_signers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_requests: {
        Row: {
          certificate_chain_intact: boolean | null
          certificate_events_root_hash: string | null
          certificate_events_seq: number | null
          certificate_generated_at: string | null
          certificate_r2_key: string | null
          certificate_sha256: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          current_order: number
          entity_id: string | null
          expires_at: string | null
          id: string
          organization_id: string
          prefilled_values: Json
          reminder_days: number[]
          require_identity_check: boolean
          sent_at: string | null
          signed_pdf_file_id: string | null
          signed_pdf_r2_key: string | null
          signed_pdf_sha256: string | null
          signer_auth: Database["public"]["Enums"]["signature_requests_signer_auth_enum"]
          source_pdf_file_id: string | null
          source_pdf_r2_key: string
          source_pdf_sha256: string
          status: Database["public"]["Enums"]["signature_requests_status_enum"]
          template_id: string | null
          template_snapshot: Json | null
          template_version_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          certificate_chain_intact?: boolean | null
          certificate_events_root_hash?: string | null
          certificate_events_seq?: number | null
          certificate_generated_at?: string | null
          certificate_r2_key?: string | null
          certificate_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_order?: number
          entity_id?: string | null
          expires_at?: string | null
          id?: string
          organization_id: string
          prefilled_values?: Json
          reminder_days?: number[]
          require_identity_check?: boolean
          sent_at?: string | null
          signed_pdf_file_id?: string | null
          signed_pdf_r2_key?: string | null
          signed_pdf_sha256?: string | null
          signer_auth?: Database["public"]["Enums"]["signature_requests_signer_auth_enum"]
          source_pdf_file_id?: string | null
          source_pdf_r2_key: string
          source_pdf_sha256: string
          status?: Database["public"]["Enums"]["signature_requests_status_enum"]
          template_id?: string | null
          template_snapshot?: Json | null
          template_version_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          certificate_chain_intact?: boolean | null
          certificate_events_root_hash?: string | null
          certificate_events_seq?: number | null
          certificate_generated_at?: string | null
          certificate_r2_key?: string | null
          certificate_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_order?: number
          entity_id?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          prefilled_values?: Json
          reminder_days?: number[]
          require_identity_check?: boolean
          sent_at?: string | null
          signed_pdf_file_id?: string | null
          signed_pdf_r2_key?: string | null
          signed_pdf_sha256?: string | null
          signer_auth?: Database["public"]["Enums"]["signature_requests_signer_auth_enum"]
          source_pdf_file_id?: string | null
          source_pdf_r2_key?: string
          source_pdf_sha256?: string
          status?: Database["public"]["Enums"]["signature_requests_status_enum"]
          template_id?: string | null
          template_snapshot?: Json | null
          template_version_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signature_requests_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_signed_pdf_file_id_fkey"
            columns: ["signed_pdf_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_source_pdf_file_id_fkey"
            columns: ["source_pdf_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "contract_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      signer_access_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          embed_origin: string | null
          expires_at: string
          id: string
          last_used_at: string | null
          last_used_ip: unknown
          max_uses: number
          organization_id: string
          otp_verified_at: string | null
          otp_verified_ip: unknown
          purpose: Database["public"]["Enums"]["signer_access_tokens_purpose_enum"]
          request_id: string
          revoked_at: string | null
          signer_id: string
          token_hash: string
          updated_at: string
          use_count: number
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          embed_origin?: string | null
          expires_at: string
          id?: string
          last_used_at?: string | null
          last_used_ip?: unknown
          max_uses?: number
          organization_id?: string
          otp_verified_at?: string | null
          otp_verified_ip?: unknown
          purpose?: Database["public"]["Enums"]["signer_access_tokens_purpose_enum"]
          request_id: string
          revoked_at?: string | null
          signer_id: string
          token_hash: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          embed_origin?: string | null
          expires_at?: string
          id?: string
          last_used_at?: string | null
          last_used_ip?: unknown
          max_uses?: number
          organization_id?: string
          otp_verified_at?: string | null
          otp_verified_ip?: unknown
          purpose?: Database["public"]["Enums"]["signer_access_tokens_purpose_enum"]
          request_id?: string
          revoked_at?: string | null
          signer_id?: string
          token_hash?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "signer_access_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_access_tokens_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_access_tokens_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "signature_request_signers"
            referencedColumns: ["id"]
          },
        ]
      }
      signer_ai_document_context: {
        Row: {
          char_count: number
          context_sha256: string | null
          created_at: string
          document_text: string
          extraction_error: string | null
          extraction_method: string
          extraction_status: string
          id: string
          organization_id: string
          page_count: number
          pages: Json
          request_id: string
          source_pdf_sha256: string
          updated_at: string
        }
        Insert: {
          char_count?: number
          context_sha256?: string | null
          created_at?: string
          document_text?: string
          extraction_error?: string | null
          extraction_method?: string
          extraction_status?: string
          id?: string
          organization_id?: string
          page_count?: number
          pages?: Json
          request_id: string
          source_pdf_sha256: string
          updated_at?: string
        }
        Update: {
          char_count?: number
          context_sha256?: string | null
          created_at?: string
          document_text?: string
          extraction_error?: string | null
          extraction_method?: string
          extraction_status?: string
          id?: string
          organization_id?: string
          page_count?: number
          pages?: Json
          request_id?: string
          source_pdf_sha256?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signer_ai_document_context_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_ai_document_context_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      signer_ai_messages: {
        Row: {
          answer: string | null
          answered_at: string | null
          asked_ip: unknown
          citations: Json
          created_at: string
          failure_reason: string | null
          grounded: boolean | null
          id: string
          model: string | null
          organization_id: string
          question: string
          refusal_reason: string | null
          request_id: string
          session_id: string
          status: string
          token_id: string
          turn_index: number
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          asked_ip?: unknown
          citations?: Json
          created_at?: string
          failure_reason?: string | null
          grounded?: boolean | null
          id?: string
          model?: string | null
          organization_id?: string
          question: string
          refusal_reason?: string | null
          request_id: string
          session_id: string
          status?: string
          token_id: string
          turn_index: number
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          asked_ip?: unknown
          citations?: Json
          created_at?: string
          failure_reason?: string | null
          grounded?: boolean | null
          id?: string
          model?: string | null
          organization_id?: string
          question?: string
          refusal_reason?: string | null
          request_id?: string
          session_id?: string
          status?: string
          token_id?: string
          turn_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "signer_ai_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_ai_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_ai_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "signer_ai_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_ai_messages_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "signer_access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      signer_ai_sessions: {
        Row: {
          created_at: string
          id: string
          last_asked_at: string | null
          organization_id: string
          request_id: string
          signer_id: string
          token_id: string
          turn_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_asked_at?: string | null
          organization_id?: string
          request_id: string
          signer_id: string
          token_id: string
          turn_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_asked_at?: string | null
          organization_id?: string
          request_id?: string
          signer_id?: string
          token_id?: string
          turn_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signer_ai_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_ai_sessions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_ai_sessions_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "signature_request_signers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_ai_sessions_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: true
            referencedRelation: "signer_access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      signer_identity_checks: {
        Row: {
          expires_at: string | null
          id: string
          organization_id: string
          provider: string
          provider_session_id: string
          rejection_reason: string | null
          request_id: string
          resolved_at: string | null
          resolved_ip: unknown
          score: number | null
          signer_id: string
          started_at: string
          started_ip: unknown
          status: Database["public"]["Enums"]["signer_identity_checks_status_enum"]
          token_id: string | null
        }
        Insert: {
          expires_at?: string | null
          id?: string
          organization_id?: string
          provider: string
          provider_session_id: string
          rejection_reason?: string | null
          request_id: string
          resolved_at?: string | null
          resolved_ip?: unknown
          score?: number | null
          signer_id: string
          started_at?: string
          started_ip?: unknown
          status?: Database["public"]["Enums"]["signer_identity_checks_status_enum"]
          token_id?: string | null
        }
        Update: {
          expires_at?: string | null
          id?: string
          organization_id?: string
          provider?: string
          provider_session_id?: string
          rejection_reason?: string | null
          request_id?: string
          resolved_at?: string | null
          resolved_ip?: unknown
          score?: number | null
          signer_id?: string
          started_at?: string
          started_ip?: unknown
          status?: Database["public"]["Enums"]["signer_identity_checks_status_enum"]
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signer_identity_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_identity_checks_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_identity_checks_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "signature_request_signers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_identity_checks_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "signer_access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      signer_otp_challenges: {
        Row: {
          attempts: number
          channel: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          max_attempts: number
          organization_id: string
          request_id: string
          requested_ip: unknown
          signer_id: string
          token_id: string
        }
        Insert: {
          attempts?: number
          channel?: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          max_attempts?: number
          organization_id?: string
          request_id: string
          requested_ip?: unknown
          signer_id: string
          token_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          organization_id?: string
          request_id?: string
          requested_ip?: unknown
          signer_id?: string
          token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signer_otp_challenges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_otp_challenges_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_otp_challenges_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "signature_request_signers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signer_otp_challenges_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "signer_access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      user_signatures: {
        Row: {
          capture_method: Database["public"]["Enums"]["signature_captures_capture_method_enum"]
          created_at: string
          file_id: string | null
          id: string
          is_default: boolean
          name: string | null
          r2_key: string
          sha256: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capture_method: Database["public"]["Enums"]["signature_captures_capture_method_enum"]
          created_at?: string
          file_id?: string | null
          id?: string
          is_default?: boolean
          name?: string | null
          r2_key: string
          sha256?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          capture_method?: Database["public"]["Enums"]["signature_captures_capture_method_enum"]
          created_at?: string
          file_id?: string | null
          id?: string
          is_default?: boolean
          name?: string | null
          r2_key?: string
          sha256?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_signatures_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_signatures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verify_rate_limits: {
        Row: {
          attempt_count: number
          client_key: string
          window_start: string
        }
        Insert: {
          attempt_count?: number
          client_key: string
          window_start?: string
        }
        Update: {
          attempt_count?: number
          client_key?: string
          window_start?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event_id: string
          event_type: Database["public"]["Enums"]["webhook_endpoints_events_enum"]
          id: string
          last_error: string | null
          last_status_code: number | null
          next_attempt_at: string
          organization_id: string
          payload: Json
          request_id: string | null
          status: Database["public"]["Enums"]["webhook_deliveries_status_enum"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event_id: string
          event_type: Database["public"]["Enums"]["webhook_endpoints_events_enum"]
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          next_attempt_at?: string
          organization_id?: string
          payload: Json
          request_id?: string | null
          status?: Database["public"]["Enums"]["webhook_deliveries_status_enum"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["webhook_endpoints_events_enum"]
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          next_attempt_at?: string
          organization_id?: string
          payload?: Json
          request_id?: string | null
          status?: Database["public"]["Enums"]["webhook_deliveries_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          consecutive_failures: number
          created_at: string
          created_by_user_id: string | null
          disabled_at: string | null
          disabled_reason: string | null
          events: Database["public"]["Enums"]["webhook_endpoints_events_enum"][]
          id: string
          is_enabled: boolean
          name: string
          organization_id: string
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          created_by_user_id?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          events: Database["public"]["Enums"]["webhook_endpoints_events_enum"][]
          id?: string
          is_enabled?: boolean
          name: string
          organization_id: string
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          created_by_user_id?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          events?: Database["public"]["Enums"]["webhook_endpoints_events_enum"][]
          id?: string
          is_enabled?: boolean
          name?: string
          organization_id?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whitelist: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          note: string | null
          pattern: Database["public"]["Enums"]["whitelist_pattern_enum"]
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          note?: string | null
          pattern: Database["public"]["Enums"]["whitelist_pattern_enum"]
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          note?: string | null
          pattern?: Database["public"]["Enums"]["whitelist_pattern_enum"]
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { invitation_token: string }; Returns: Json }
      api_idempotency_claim: {
        Args: {
          p_api_key_id: string
          p_endpoint: string
          p_fingerprint: string
          p_key: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
          response_body: Json
          response_status: number
        }[]
      }
      api_idempotency_complete: {
        Args: {
          p_body: Json
          p_endpoint: string
          p_key: string
          p_organization_id: string
          p_status: number
        }
        Returns: boolean
      }
      api_idempotency_prune: {
        Args: {
          p_completed_older_than?: string
          p_in_flight_older_than?: string
        }
        Returns: number
      }
      api_key_issue: {
        Args: {
          p_allowed_embed_origins?: string[]
          p_expires_at?: string
          p_name: string
          p_organization_id: string
          p_scopes: Database["public"]["Enums"]["api_keys_scopes_enum"][]
        }
        Returns: {
          api_key: string
          api_key_id: string
          key_prefix: string
        }[]
      }
      api_key_resolve: {
        Args: { p_ip?: string; p_key_hash: string; p_max_per_hr?: number }
        Returns: {
          allowed_embed_origins: string[]
          api_key_id: string
          created_by_user_id: string
          name: string
          organization_id: string
          scopes: Database["public"]["Enums"]["api_keys_scopes_enum"][]
          throttled: boolean
        }[]
      }
      api_key_revoke: { Args: { p_api_key_id: string }; Returns: boolean }
      api_keys_list: {
        Args: { p_organization_id: string }
        Returns: {
          allowed_embed_origins: string[]
          created_at: string
          created_by_user_id: string
          expires_at: string
          id: string
          key_prefix: string
          last_used_at: string
          name: string
          revoked_at: string
          scopes: Database["public"]["Enums"]["api_keys_scopes_enum"][]
        }[]
      }
      clean_old_realtime_events: { Args: never; Returns: undefined }
      cleanup_expired_auth_tokens: { Args: never; Returns: undefined }
      create_organization: { Args: { org_name: string }; Returns: string }
      cron_dispatch: { Args: { p_function_name: string }; Returns: number }
      ensure_personal_organization: { Args: never; Returns: string }
      files_content_type_for_key: {
        Args: { p_r2_key: string }
        Returns: string
      }
      files_ensure: {
        Args: {
          p_content_type?: string
          p_organization_id?: string
          p_r2_key: string
          p_size?: number
          p_uploaded_by?: string
        }
        Returns: string
      }
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
      get_my_org_capabilities: { Args: { org_id: string }; Returns: Json }
      get_organization_id_for_change: {
        Args: { p_record_data: Json; p_table_name: string }
        Returns: string
      }
      get_organization_person: {
        Args: { org_id: string; target_user_id: string }
        Returns: Json
      }
      get_organization_role: { Args: { org_id: string }; Returns: string }
      has_org_permission: {
        Args: { org_id: string; perm: string }
        Returns: boolean
      }
      has_pending_invitation: { Args: { org_id: string }; Returns: boolean }
      is_admin_or_owner: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      is_whitelisted: { Args: never; Returns: boolean }
      mask_email: { Args: { p_email: string }; Returns: string }
      notifications_mark_all_read: {
        Args: { p_organization_id?: string }
        Returns: number
      }
      oauth_avatar_source: { Args: { p_user_id: string }; Returns: string }
      remove_from_organization: {
        Args: { org_id: string; target_user_id: string }
        Returns: Json
      }
      set_default_signature: {
        Args: { p_signature_id: string }
        Returns: undefined
      }
      set_member_permissions: {
        Args: {
          org_id: string
          p_can_manage_templates: boolean
          p_can_send_documents: boolean
          target_user_id: string
        }
        Returns: Json
      }
      set_organization_role: {
        Args: { new_role: string; org_id: string; target_user_id: string }
        Returns: Json
      }
      signature_advance_after_signature: {
        Args: { p_request_id: string; p_signer_id: string }
        Returns: {
          next_order: number
          outcome: string
        }[]
      }
      signature_audit_append: {
        Args: {
          p_actor_user_id: string
          p_event_type: string
          p_organization_id: string
          p_payload: Json
          p_request_id: string
          p_signer_id: string
        }
        Returns: string
      }
      signature_audit_entry_hash: {
        Args: {
          p_actor_user_id: string
          p_event_type: string
          p_occurred_at: string
          p_payload: Json
          p_prev_hash: string
          p_request_id: string
          p_seq: number
          p_signer_id: string
        }
        Returns: string
      }
      signature_claim_turn: {
        Args: { p_request_id: string; p_signer_id: string }
        Returns: boolean
      }
      signature_mark_viewed: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      signature_mark_viewed_by_signer: {
        Args: { p_signer_id: string }
        Returns: undefined
      }
      signature_release_finalize: {
        Args: { p_request_id: string; p_signer_id: string }
        Returns: boolean
      }
      signature_release_turn: {
        Args: { p_request_id: string; p_signer_id: string }
        Returns: undefined
      }
      signature_request_changes: {
        Args: { p_reason: string; p_request_id: string; p_signer_id: string }
        Returns: {
          outcome: string
          rewound_to: number
          superseded_capture_id: string
        }[]
      }
      signature_request_verify_by_hash: {
        Args: { p_client_key?: string; p_max_per_hr?: number; p_sha256: string }
        Returns: {
          document_title: string
          finished_at: string
          matched_artifact: string
          organization_name: string
          signer_count: number
          signers: Json
        }[]
      }
      signature_verify_chain: {
        Args: { p_request_id: string }
        Returns: {
          broken_at_seq: number
          chain_intact: boolean
          entries_checked: number
        }[]
      }
      signature_verify_chain_for_member: {
        Args: { p_request_id: string }
        Returns: {
          broken_at_seq: number
          chain_intact: boolean
          entries_checked: number
        }[]
      }
      signer_ai_message_begin: {
        Args: { p_ip?: string; p_question: string; p_token_id: string }
        Returns: {
          message_id: string
          retry_after_seconds: number
          session_id: string
          status: string
          turn_index: number
          turns_remaining: number
        }[]
      }
      signer_ai_message_complete: {
        Args: {
          p_answer: string
          p_citations?: Json
          p_grounded?: boolean
          p_message_id: string
          p_model?: string
          p_refusal_reason?: string
          p_status: string
        }
        Returns: undefined
      }
      signer_ai_message_fail: {
        Args: { p_message_id: string; p_reason?: string }
        Returns: undefined
      }
      signer_identity_record_verdict: {
        Args: {
          p_check_id: string
          p_ip?: string
          p_rejection_reason?: string
          p_score?: number
          p_status: string
        }
        Returns: {
          provider: string
          request_id: string
          signer_id: string
          status: string
        }[]
      }
      signer_identity_start: {
        Args: {
          p_ip?: string
          p_provider: string
          p_provider_session_id: string
          p_token_id: string
          p_ttl_minutes?: number
        }
        Returns: {
          check_id: string
          expires_at: string
          retry_after_seconds: number
          status: string
        }[]
      }
      signer_otp_issue: {
        Args: { p_ip?: string; p_token_id: string; p_ttl_minutes?: number }
        Returns: {
          challenge_id: string
          code: string
          expires_at: string
          retry_after_seconds: number
          status: string
        }[]
      }
      signer_otp_verify: {
        Args: { p_code: string; p_ip?: string; p_token_id: string }
        Returns: {
          attempts_remaining: number
          status: string
        }[]
      }
      signer_token_consume: { Args: { p_token_id: string }; Returns: undefined }
      signer_token_issue: {
        Args: { p_purpose?: string; p_signer_id: string; p_ttl_hours?: number }
        Returns: {
          expires_at: string
          token: string
          token_id: string
        }[]
      }
      signer_token_issue_embed: {
        Args: {
          p_max_uses?: number
          p_origin: string
          p_signer_id: string
          p_ttl_seconds?: number
        }
        Returns: {
          expires_at: string
          token: string
          token_id: string
        }[]
      }
      signer_token_redeem: {
        Args: { p_count_use?: boolean; p_ip?: string; p_token_hash: string }
        Returns: {
          organization_id: string
          otp_verified_at: string
          purpose: Database["public"]["Enums"]["signer_access_tokens_purpose_enum"]
          request_id: string
          signer_id: string
          token_id: string
          use_count: number
        }[]
      }
      signer_token_revoke_for_request: {
        Args: { p_request_id: string }
        Returns: number
      }
      signer_token_revoke_for_signer: {
        Args: { p_signer_id: string }
        Returns: number
      }
      transfer_organization_ownership: {
        Args: { new_owner_user_id: string; org_id: string }
        Returns: Json
      }
      webhook_deliveries_list: {
        Args: { p_endpoint_id: string; p_limit?: number }
        Returns: {
          attempt_count: number
          created_at: string
          delivered_at: string
          event_id: string
          event_type: Database["public"]["Enums"]["webhook_endpoints_events_enum"]
          id: string
          last_error: string
          last_status_code: number
          next_attempt_at: string
          request_id: string
          status: Database["public"]["Enums"]["webhook_deliveries_status_enum"]
        }[]
      }
      webhook_endpoint_create: {
        Args: {
          p_events: Database["public"]["Enums"]["webhook_endpoints_events_enum"][]
          p_name: string
          p_organization_id: string
          p_url: string
        }
        Returns: {
          endpoint_id: string
          signing_secret: string
        }[]
      }
      webhook_endpoint_delete: {
        Args: { p_endpoint_id: string }
        Returns: boolean
      }
      webhook_endpoint_rotate_secret: {
        Args: { p_endpoint_id: string }
        Returns: string
      }
      webhook_endpoint_update: {
        Args: {
          p_endpoint_id: string
          p_events?: Database["public"]["Enums"]["webhook_endpoints_events_enum"][]
          p_is_enabled?: boolean
          p_name?: string
          p_url?: string
        }
        Returns: boolean
      }
      webhook_endpoints_list: {
        Args: { p_organization_id: string }
        Returns: {
          consecutive_failures: number
          created_at: string
          disabled_at: string
          disabled_reason: string
          events: Database["public"]["Enums"]["webhook_endpoints_events_enum"][]
          failed_count: number
          id: string
          is_enabled: boolean
          last_delivery_at: string
          name: string
          pending_count: number
          url: string
        }[]
      }
      webhook_event_for_audit_event: {
        Args: { p_event_type: string }
        Returns: Database["public"]["Enums"]["webhook_endpoints_events_enum"]
      }
      whitelist_matches: { Args: { p_email: string }; Returns: boolean }
    }
    Enums: {
      api_keys_scopes_enum: "member" | "send_documents" | "manage_templates"
      contract_template_type_enum: "tiptap" | "pdf"
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
      notifications_type_enum:
        | "admin_invitation"
        | "employee_onboarding_invitation"
        | "signature_request_invitation"
        | "signature_request_copy"
        | "signature_request_declined"
        | "signature_request_reminder"
        | "signature_request_expired"
        | "signature_request_changes_requested"
        | "envelope_completed"
        | "envelope_voided"
        | "envelope_signed_by_party"
        | "organization_invitation"
        | "webhook_endpoint_disabled"
      realtime_table_events_event_type_enum: "INSERT" | "UPDATE" | "DELETE"
      signature_audit_log_event_type_enum:
        | "request_created"
        | "request_sent"
        | "signer_notified"
        | "signer_viewed"
        | "signer_signed"
        | "signer_declined"
        | "request_completed"
        | "request_cancelled"
        | "document_burned"
        | "integrity_verified"
        | "signer_token_issued"
        | "signer_token_redeemed"
        | "signer_access_denied"
        | "signer_fields_saved"
        | "document_signed"
        | "request_expired"
        | "signer_reminded"
        | "cc_notified"
        | "sender_requested_changes"
        | "capture_superseded"
        | "signer_token_revoked"
        | "request_updated"
        | "signer_otp_issued"
        | "signer_otp_verified"
        | "signer_otp_failed"
        | "signer_identity_started"
        | "signer_identity_verified"
        | "signer_identity_failed"
        | "certificate_generated"
        | "signer_ai_question_asked"
      signature_captures_capture_method_enum: "drawn" | "uploaded" | "typed"
      signature_request_signers_recipient_type_enum: "signer" | "cc"
      signature_request_signers_status_enum:
        | "pending"
        | "notified"
        | "viewed"
        | "signed"
        | "declined"
        | "changes_requested"
      signature_requests_signer_auth_enum: "account" | "email_otp"
      signature_requests_status_enum:
        | "draft"
        | "in_progress"
        | "completed"
        | "declined"
        | "cancelled"
        | "expired"
      signer_access_tokens_purpose_enum: "sign" | "view"
      signer_identity_checks_status_enum: "pending" | "approved" | "rejected"
      webhook_deliveries_status_enum:
        | "pending"
        | "delivering"
        | "delivered"
        | "failed"
      webhook_endpoints_events_enum:
        | "envelope.sent"
        | "envelope.recipient_viewed"
        | "envelope.recipient_signed"
        | "envelope.recipient_declined"
        | "envelope.changes_requested"
        | "envelope.completed"
        | "envelope.expired"
        | "envelope.voided"
      whitelist_pattern_enum: "exact" | "domain" | "wildcard"
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
      api_keys_scopes_enum: ["member", "send_documents", "manage_templates"],
      contract_template_type_enum: ["tiptap", "pdf"],
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
      notifications_type_enum: [
        "admin_invitation",
        "employee_onboarding_invitation",
        "signature_request_invitation",
        "signature_request_copy",
        "signature_request_declined",
        "signature_request_reminder",
        "signature_request_expired",
        "signature_request_changes_requested",
        "envelope_completed",
        "envelope_voided",
        "envelope_signed_by_party",
        "organization_invitation",
        "webhook_endpoint_disabled",
      ],
      realtime_table_events_event_type_enum: ["INSERT", "UPDATE", "DELETE"],
      signature_audit_log_event_type_enum: [
        "request_created",
        "request_sent",
        "signer_notified",
        "signer_viewed",
        "signer_signed",
        "signer_declined",
        "request_completed",
        "request_cancelled",
        "document_burned",
        "integrity_verified",
        "signer_token_issued",
        "signer_token_redeemed",
        "signer_access_denied",
        "signer_fields_saved",
        "document_signed",
        "request_expired",
        "signer_reminded",
        "cc_notified",
        "sender_requested_changes",
        "capture_superseded",
        "signer_token_revoked",
        "request_updated",
        "signer_otp_issued",
        "signer_otp_verified",
        "signer_otp_failed",
        "signer_identity_started",
        "signer_identity_verified",
        "signer_identity_failed",
        "certificate_generated",
        "signer_ai_question_asked",
      ],
      signature_captures_capture_method_enum: ["drawn", "uploaded", "typed"],
      signature_request_signers_recipient_type_enum: ["signer", "cc"],
      signature_request_signers_status_enum: [
        "pending",
        "notified",
        "viewed",
        "signed",
        "declined",
        "changes_requested",
      ],
      signature_requests_signer_auth_enum: ["account", "email_otp"],
      signature_requests_status_enum: [
        "draft",
        "in_progress",
        "completed",
        "declined",
        "cancelled",
        "expired",
      ],
      signer_access_tokens_purpose_enum: ["sign", "view"],
      signer_identity_checks_status_enum: ["pending", "approved", "rejected"],
      webhook_deliveries_status_enum: [
        "pending",
        "delivering",
        "delivered",
        "failed",
      ],
      webhook_endpoints_events_enum: [
        "envelope.sent",
        "envelope.recipient_viewed",
        "envelope.recipient_signed",
        "envelope.recipient_declined",
        "envelope.changes_requested",
        "envelope.completed",
        "envelope.expired",
        "envelope.voided",
      ],
      whitelist_pattern_enum: ["exact", "domain", "wildcard"],
    },
  },
} as const

