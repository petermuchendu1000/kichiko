// AUTO-GENERATED from live Supabase schema. Do not edit by hand.
// Regenerate with: python3 scripts/gen_supabase_types.py <DB_URL>

export type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      payment_gateways: {
        Row: {
          id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          country_code: string | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          label: string
          environment: string
          is_enabled: boolean
          priority: number
          config: Json
          secret_ref: Json
          min_amount: number | null
          max_amount: number | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          provider: Database["public"]["Enums"]["payment_provider"]
          country_code?: string | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          label: string
          environment?: string
          is_enabled?: boolean
          priority?: number
          config?: Json
          secret_ref?: Json
          min_amount?: number | null
          max_amount?: number | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          country_code?: string | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          label?: string
          environment?: string
          is_enabled?: boolean
          priority?: number
          config?: Json
          secret_ref?: Json
          min_amount?: number | null
          max_amount?: number | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      gateway_secrets: {
        Row: {
          gateway_id: string
          key: string
          ciphertext: string
          last4: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          gateway_id: string
          key: string
          ciphertext: string
          last4?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          gateway_id?: string
          key?: string
          ciphertext?: string
          last4?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gateway_health: {
        Row: {
          id: string
          gateway_id: string | null
          ok: boolean
          latency_ms: number | null
          detail: string | null
          checked_by: string | null
          checked_at: string
        }
        Insert: {
          id?: string
          gateway_id?: string | null
          ok: boolean
          latency_ms?: number | null
          detail?: string | null
          checked_by?: string | null
          checked_at?: string
        }
        Update: {
          id?: string
          gateway_id?: string | null
          ok?: boolean
          latency_ms?: number | null
          detail?: string | null
          checked_by?: string | null
          checked_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          value: Json
          is_public: boolean
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          key: string
          value: Json
          is_public?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          key?: string
          value?: Json
          is_public?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      admin_user_notes: {
        Row: {
          id: string
          user_id: string
          author_id: string | null
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          author_id?: string | null
          note: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          author_id?: string | null
          note?: string
          created_at?: string
        }
        Relationships: []
      }
      impersonation_sessions: {
        Row: {
          id: string
          admin_id: string
          target_user_id: string
          reason: string | null
          started_at: string
          expires_at: string
          ended_at: string | null
          ip_address: string | null
          user_agent: string | null
        }
        Insert: {
          id?: string
          admin_id: string
          target_user_id: string
          reason?: string | null
          started_at?: string
          expires_at: string
          ended_at?: string | null
          ip_address?: string | null
          user_agent?: string | null
        }
        Update: {
          id?: string
          admin_id?: string
          target_user_id?: string
          reason?: string | null
          started_at?: string
          expires_at?: string
          ended_at?: string | null
          ip_address?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          role: Database["public"]["Enums"]["user_role"]
          capability: string
          created_at: string
        }
        Insert: {
          role: Database["public"]["Enums"]["user_role"]
          capability: string
          created_at?: string
        }
        Update: {
          role?: Database["public"]["Enums"]["user_role"]
          capability?: string
          created_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          actor_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          old_data: Json | null
          new_data: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          actor_id?: string | null
          action: string
          entity_type?: string | null
          entity_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          actor_id?: string | null
          action?: string
          entity_type?: string | null
          entity_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      comments: {
        Row: {
          id: string
          market_id: string
          user_id: string
          parent_id: string | null
          content: string
          is_deleted: boolean | null
          like_count: number | null
          report_count: number | null
          is_flagged: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          market_id: string
          user_id: string
          parent_id?: string | null
          content: string
          is_deleted?: boolean | null
          like_count?: number | null
          report_count?: number | null
          is_flagged?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          market_id?: string
          user_id?: string
          parent_id?: string | null
          content?: string
          is_deleted?: boolean | null
          like_count?: number | null
          report_count?: number | null
          is_flagged?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      deposits: {
        Row: {
          id: string
          user_id: string
          wallet_id: string
          transaction_id: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          provider: Database["public"]["Enums"]["payment_provider"]
          amount: number
          currency: Database["public"]["Enums"]["currency_code"]
          phone_number: string
          checkout_request_id: string | null
          merchant_request_id: string | null
          mtn_reference_id: string | null
          airtel_reference: string | null
          pesapal_order_id: string | null
          provider_receipt: string | null
          exchange_rate_to_usd: number | null
          retry_count: number | null
          expires_at: string | null
          initiated_at: string | null
          confirmed_at: string | null
          failed_at: string | null
          failure_reason: string | null
          raw_callback: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          wallet_id: string
          transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          provider: Database["public"]["Enums"]["payment_provider"]
          amount: number
          currency: Database["public"]["Enums"]["currency_code"]
          phone_number: string
          checkout_request_id?: string | null
          merchant_request_id?: string | null
          mtn_reference_id?: string | null
          airtel_reference?: string | null
          pesapal_order_id?: string | null
          provider_receipt?: string | null
          exchange_rate_to_usd?: number | null
          retry_count?: number | null
          expires_at?: string | null
          initiated_at?: string | null
          confirmed_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          raw_callback?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          wallet_id?: string
          transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          amount?: number
          currency?: Database["public"]["Enums"]["currency_code"]
          phone_number?: string
          checkout_request_id?: string | null
          merchant_request_id?: string | null
          mtn_reference_id?: string | null
          airtel_reference?: string | null
          pesapal_order_id?: string | null
          provider_receipt?: string | null
          exchange_rate_to_usd?: number | null
          retry_count?: number | null
          expires_at?: string | null
          initiated_at?: string | null
          confirmed_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          raw_callback?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          }
        ]
      }
      exchange_rates: {
        Row: {
          id: string
          from_currency: Database["public"]["Enums"]["currency_code"]
          to_currency: Database["public"]["Enums"]["currency_code"]
          rate: number
          source: string | null
          fetched_at: string | null
        }
        Insert: {
          id?: string
          from_currency: Database["public"]["Enums"]["currency_code"]
          to_currency?: Database["public"]["Enums"]["currency_code"]
          rate: number
          source?: string | null
          fetched_at?: string | null
        }
        Update: {
          id?: string
          from_currency?: Database["public"]["Enums"]["currency_code"]
          to_currency?: Database["public"]["Enums"]["currency_code"]
          rate?: number
          source?: string | null
          fetched_at?: string | null
        }
        Relationships: []
      }
      kyc_documents: {
        Row: {
          id: string
          user_id: string
          document_type: string
          document_number: string | null
          front_image_url: string | null
          back_image_url: string | null
          selfie_image_url: string | null
          country_of_issue: string | null
          expiry_date: string | null
          status: Database["public"]["Enums"]["kyc_status"] | null
          reviewed_by: string | null
          reviewed_at: string | null
          rejection_reason: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          document_type: string
          document_number?: string | null
          front_image_url?: string | null
          back_image_url?: string | null
          selfie_image_url?: string | null
          country_of_issue?: string | null
          expiry_date?: string | null
          status?: Database["public"]["Enums"]["kyc_status"] | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          document_type?: string
          document_number?: string | null
          front_image_url?: string | null
          back_image_url?: string | null
          selfie_image_url?: string | null
          country_of_issue?: string | null
          expiry_date?: string | null
          status?: Database["public"]["Enums"]["kyc_status"] | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kyc_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      market_activity: {
        Row: {
          id: string
          market_id: string
          user_id: string
          action: string
          amount_usd: number | null
          side: Database["public"]["Enums"]["order_side"] | null
          price: number | null
          metadata: Json | null
          created_at: string | null
          market_option_id: string | null
        }
        Insert: {
          id?: string
          market_id: string
          user_id: string
          action: string
          amount_usd?: number | null
          side?: Database["public"]["Enums"]["order_side"] | null
          price?: number | null
          metadata?: Json | null
          created_at?: string | null
          market_option_id?: string | null
        }
        Update: {
          id?: string
          market_id?: string
          user_id?: string
          action?: string
          amount_usd?: number | null
          side?: Database["public"]["Enums"]["order_side"] | null
          price?: number | null
          metadata?: Json | null
          created_at?: string | null
          market_option_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_activity_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      market_options: {
        Row: {
          id: string
          market_id: string
          label: string
          description: string | null
          price: number | null
          volume_usd: number | null
          is_winner: boolean | null
          display_order: number | null
          created_at: string | null
          q_shares: number | null
          total_invested_usd: number | null
          is_active: boolean | null
          updated_at: string | null
          image_url: string | null
          entity_kind: string | null
          entity_ref: string | null
          q_yes: number | null
          q_no: number | null
          yes_price: number | null
          no_price: number | null
        }
        Insert: {
          id?: string
          market_id: string
          label: string
          description?: string | null
          price?: number | null
          volume_usd?: number | null
          is_winner?: boolean | null
          display_order?: number | null
          created_at?: string | null
          q_shares?: number | null
          total_invested_usd?: number | null
          is_active?: boolean | null
          updated_at?: string | null
          image_url?: string | null
          entity_kind?: string | null
          entity_ref?: string | null
          q_yes?: number | null
          q_no?: number | null
          yes_price?: number | null
          no_price?: number | null
        }
        Update: {
          id?: string
          market_id?: string
          label?: string
          description?: string | null
          price?: number | null
          volume_usd?: number | null
          is_winner?: boolean | null
          display_order?: number | null
          created_at?: string | null
          q_shares?: number | null
          total_invested_usd?: number | null
          is_active?: boolean | null
          updated_at?: string | null
          image_url?: string | null
          entity_kind?: string | null
          entity_ref?: string | null
          q_yes?: number | null
          q_no?: number | null
          yes_price?: number | null
          no_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_options_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          }
        ]
      }
      markets: {
        Row: {
          id: string
          slug: string
          title: string
          description: string
          category: Database["public"]["Enums"]["market_category"]
          resolution_type: Database["public"]["Enums"]["market_resolution_type"] | null
          creator_id: string
          creator_reward_rate: number | null
          status: Database["public"]["Enums"]["market_status"] | null
          opens_at: string | null
          closes_at: string
          resolves_at: string | null
          resolved_at: string | null
          resolver_id: string | null
          resolution_source: string | null
          resolution_criteria: string
          pricing_engine: string
          resolved_outcome: Database["public"]["Enums"]["order_side"] | null
          resolution_notes: string | null
          yes_price: number | null
          no_price: number | null
          liquidity_pool_usd: number | null
          initial_liquidity_usd: number | null
          total_volume_usd: number | null
          yes_volume_usd: number | null
          no_volume_usd: number | null
          total_bets: number | null
          unique_bettors: number | null
          platform_fee_rate: number | null
          is_featured: boolean | null
          is_trending: boolean | null
          is_hidden: boolean
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          featured_order: number | null
          tags: string[] | null
          cover_image_url: string | null
          allowed_countries: string[] | null
          view_count: number | null
          comment_count: number | null
          share_count: number | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
          resolved_option_id: string | null
          options_pricing_mode: string | null
        }
        Insert: {
          id?: string
          slug: string
          title: string
          description: string
          category?: Database["public"]["Enums"]["market_category"]
          resolution_type?: Database["public"]["Enums"]["market_resolution_type"] | null
          creator_id: string
          creator_reward_rate?: number | null
          status?: Database["public"]["Enums"]["market_status"] | null
          opens_at?: string | null
          closes_at: string
          resolves_at?: string | null
          resolved_at?: string | null
          resolver_id?: string | null
          resolution_source?: string | null
          resolution_criteria: string
          resolved_outcome?: Database["public"]["Enums"]["order_side"] | null
          resolution_notes?: string | null
          yes_price?: number | null
          no_price?: number | null
          liquidity_pool_usd?: number | null
          initial_liquidity_usd?: number | null
          total_volume_usd?: number | null
          yes_volume_usd?: number | null
          no_volume_usd?: number | null
          total_bets?: number | null
          unique_bettors?: number | null
          platform_fee_rate?: number | null
          is_featured?: boolean | null
          is_trending?: boolean | null
          is_hidden?: boolean
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          featured_order?: number | null
          tags?: string[] | null
          cover_image_url?: string | null
          allowed_countries?: string[] | null
          view_count?: number | null
          comment_count?: number | null
          share_count?: number | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
          resolved_option_id?: string | null
          options_pricing_mode?: string | null
        }
        Update: {
          id?: string
          slug?: string
          title?: string
          description?: string
          category?: Database["public"]["Enums"]["market_category"]
          resolution_type?: Database["public"]["Enums"]["market_resolution_type"] | null
          creator_id?: string
          creator_reward_rate?: number | null
          status?: Database["public"]["Enums"]["market_status"] | null
          opens_at?: string | null
          closes_at?: string
          resolves_at?: string | null
          resolved_at?: string | null
          resolver_id?: string | null
          resolution_source?: string | null
          resolution_criteria?: string
          resolved_outcome?: Database["public"]["Enums"]["order_side"] | null
          resolution_notes?: string | null
          yes_price?: number | null
          no_price?: number | null
          liquidity_pool_usd?: number | null
          initial_liquidity_usd?: number | null
          total_volume_usd?: number | null
          yes_volume_usd?: number | null
          no_volume_usd?: number | null
          total_bets?: number | null
          unique_bettors?: number | null
          platform_fee_rate?: number | null
          is_featured?: boolean | null
          is_trending?: boolean | null
          is_hidden?: boolean
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          featured_order?: number | null
          tags?: string[] | null
          cover_image_url?: string | null
          allowed_countries?: string[] | null
          view_count?: number | null
          comment_count?: number | null
          share_count?: number | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
          resolved_option_id?: string | null
          options_pricing_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "markets_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "markets_resolver_id_fkey"
            columns: ["resolver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          title: string
          body: string
          data: Json | null
          is_read: boolean | null
          read_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          title: string
          body: string
          data?: Json | null
          is_read?: boolean | null
          read_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: Database["public"]["Enums"]["notification_type"]
          title?: string
          body?: string
          data?: Json | null
          is_read?: boolean | null
          read_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      orders: {
        Row: {
          id: string
          market_id: string
          user_id: string
          wallet_id: string
          side: Database["public"]["Enums"]["order_side"]
          type: Database["public"]["Enums"]["order_type"] | null
          status: Database["public"]["Enums"]["order_status"] | null
          amount_usd: number
          filled_usd: number | null
          remaining_usd: number | null
          currency: Database["public"]["Enums"]["currency_code"]
          amount_local: number
          exchange_rate_to_usd: number
          limit_price: number | null
          avg_fill_price: number | null
          shares: number | null
          potential_payout_usd: number | null
          fee_usd: number | null
          fee_local: number | null
          expires_at: string | null
          transaction_id: string | null
          client_order_id: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
          market_option_id: string | null
        }
        Insert: {
          id?: string
          market_id: string
          user_id: string
          wallet_id: string
          side: Database["public"]["Enums"]["order_side"]
          type?: Database["public"]["Enums"]["order_type"] | null
          status?: Database["public"]["Enums"]["order_status"] | null
          amount_usd: number
          filled_usd?: number | null
          remaining_usd?: number | null
          currency: Database["public"]["Enums"]["currency_code"]
          amount_local: number
          exchange_rate_to_usd: number
          limit_price?: number | null
          avg_fill_price?: number | null
          shares?: number | null
          potential_payout_usd?: number | null
          fee_usd?: number | null
          fee_local?: number | null
          expires_at?: string | null
          transaction_id?: string | null
          client_order_id?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
          market_option_id?: string | null
        }
        Update: {
          id?: string
          market_id?: string
          user_id?: string
          wallet_id?: string
          side?: Database["public"]["Enums"]["order_side"]
          type?: Database["public"]["Enums"]["order_type"] | null
          status?: Database["public"]["Enums"]["order_status"] | null
          amount_usd?: number
          filled_usd?: number | null
          remaining_usd?: number | null
          currency?: Database["public"]["Enums"]["currency_code"]
          amount_local?: number
          exchange_rate_to_usd?: number
          limit_price?: number | null
          avg_fill_price?: number | null
          shares?: number | null
          potential_payout_usd?: number | null
          fee_usd?: number | null
          fee_local?: number | null
          expires_at?: string | null
          transaction_id?: string | null
          client_order_id?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
          market_option_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          }
        ]
      }
      positions: {
        Row: {
          id: string
          user_id: string
          market_id: string
          wallet_id: string
          side: Database["public"]["Enums"]["position_side"]
          shares: number | null
          total_invested_usd: number | null
          avg_entry_price: number | null
          current_value_usd: number | null
          unrealized_pnl_usd: number | null
          realized_pnl_usd: number | null
          total_payout_usd: number | null
          is_active: boolean | null
          claimed_at: string | null
          created_at: string | null
          updated_at: string | null
          market_option_id: string | null
          reserved_shares: number | null
        }
        Insert: {
          id?: string
          user_id: string
          market_id: string
          wallet_id: string
          side: Database["public"]["Enums"]["position_side"]
          shares?: number | null
          total_invested_usd?: number | null
          avg_entry_price?: number | null
          current_value_usd?: number | null
          unrealized_pnl_usd?: number | null
          realized_pnl_usd?: number | null
          total_payout_usd?: number | null
          is_active?: boolean | null
          claimed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          market_option_id?: string | null
          reserved_shares?: number | null
        }
        Update: {
          id?: string
          user_id?: string
          market_id?: string
          wallet_id?: string
          side?: Database["public"]["Enums"]["position_side"]
          shares?: number | null
          total_invested_usd?: number | null
          avg_entry_price?: number | null
          current_value_usd?: number | null
          unrealized_pnl_usd?: number | null
          realized_pnl_usd?: number | null
          total_payout_usd?: number | null
          is_active?: boolean | null
          claimed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          market_option_id?: string | null
          reserved_shares?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          }
        ]
      }
      price_history: {
        Row: {
          id: string
          market_id: string
          yes_price: number
          no_price: number
          volume_usd: number | null
          recorded_at: string | null
          market_option_id: string | null
          price: number | null
        }
        Insert: {
          id?: string
          market_id: string
          yes_price: number
          no_price: number
          volume_usd?: number | null
          recorded_at?: string | null
          market_option_id?: string | null
          price?: number | null
        }
        Update: {
          id?: string
          market_id?: string
          yes_price?: number
          no_price?: number
          volume_usd?: number | null
          recorded_at?: string | null
          market_option_id?: string | null
          price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          id: string
          username: string | null
          display_name: string | null
          avatar_url: string | null
          bio: string | null
          phone_number: string | null
          country_code: string | null
          preferred_currency: Database["public"]["Enums"]["currency_code"] | null
          preferred_locale: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          kyc_status: Database["public"]["Enums"]["kyc_status"] | null
          kyc_completed_at: string | null
          account_status: Database["public"]["Enums"]["account_status"] | null
          referral_code: string | null
          referred_by: string | null
          referral_count: number | null
          total_volume_usd: number | null
          total_bets: number | null
          total_wins: number | null
          win_rate: number | null
          profit_loss_usd: number | null
          email_notifications: boolean | null
          sms_notifications: boolean | null
          push_notifications: boolean | null
          last_login_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          username?: string | null
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          phone_number?: string | null
          country_code?: string | null
          preferred_currency?: Database["public"]["Enums"]["currency_code"] | null
          preferred_locale?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"] | null
          kyc_completed_at?: string | null
          account_status?: Database["public"]["Enums"]["account_status"] | null
          referral_code?: string | null
          referred_by?: string | null
          referral_count?: number | null
          total_volume_usd?: number | null
          total_bets?: number | null
          total_wins?: number | null
          win_rate?: number | null
          profit_loss_usd?: number | null
          email_notifications?: boolean | null
          sms_notifications?: boolean | null
          push_notifications?: boolean | null
          last_login_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          username?: string | null
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          phone_number?: string | null
          country_code?: string | null
          preferred_currency?: Database["public"]["Enums"]["currency_code"] | null
          preferred_locale?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"] | null
          kyc_completed_at?: string | null
          account_status?: Database["public"]["Enums"]["account_status"] | null
          referral_code?: string | null
          referred_by?: string | null
          referral_count?: number | null
          total_volume_usd?: number | null
          total_bets?: number | null
          total_wins?: number | null
          win_rate?: number | null
          profit_loss_usd?: number | null
          email_notifications?: boolean | null
          sms_notifications?: boolean | null
          push_notifications?: boolean | null
          last_login_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      referrals: {
        Row: {
          id: string
          referrer_id: string
          referred_id: string
          referral_code: string
          status: string | null
          bonus_amount: number | null
          bonus_currency: Database["public"]["Enums"]["currency_code"] | null
          bonus_paid_at: string | null
          qualified_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          referrer_id: string
          referred_id: string
          referral_code: string
          status?: string | null
          bonus_amount?: number | null
          bonus_currency?: Database["public"]["Enums"]["currency_code"] | null
          bonus_paid_at?: string | null
          qualified_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          referrer_id?: string
          referred_id?: string
          referral_code?: string
          status?: string | null
          bonus_amount?: number | null
          bonus_currency?: Database["public"]["Enums"]["currency_code"] | null
          bonus_paid_at?: string | null
          qualified_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          wallet_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          status: Database["public"]["Enums"]["transaction_status"] | null
          amount: number
          currency: Database["public"]["Enums"]["currency_code"]
          amount_usd: number
          exchange_rate_to_usd: number
          fee_amount: number | null
          fee_currency: Database["public"]["Enums"]["currency_code"] | null
          net_amount: number | null
          balance_before: number
          balance_after: number
          order_id: string | null
          market_id: string | null
          payment_reference: string | null
          provider_reference: string | null
          idempotency_key: string | null
          payment_provider: Database["public"]["Enums"]["payment_provider"] | null
          payment_phone: string | null
          payment_metadata: Json | null
          description: string | null
          notes: string | null
          initiated_at: string | null
          completed_at: string | null
          failed_at: string | null
          created_at: string | null
          updated_at: string | null
          market_option_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          wallet_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          status?: Database["public"]["Enums"]["transaction_status"] | null
          amount: number
          currency: Database["public"]["Enums"]["currency_code"]
          amount_usd: number
          exchange_rate_to_usd: number
          fee_amount?: number | null
          fee_currency?: Database["public"]["Enums"]["currency_code"] | null
          net_amount?: number | null
          balance_before: number
          balance_after: number
          order_id?: string | null
          market_id?: string | null
          payment_reference?: string | null
          provider_reference?: string | null
          idempotency_key?: string | null
          payment_provider?: Database["public"]["Enums"]["payment_provider"] | null
          payment_phone?: string | null
          payment_metadata?: Json | null
          description?: string | null
          notes?: string | null
          initiated_at?: string | null
          completed_at?: string | null
          failed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          market_option_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          wallet_id?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          status?: Database["public"]["Enums"]["transaction_status"] | null
          amount?: number
          currency?: Database["public"]["Enums"]["currency_code"]
          amount_usd?: number
          exchange_rate_to_usd?: number
          fee_amount?: number | null
          fee_currency?: Database["public"]["Enums"]["currency_code"] | null
          net_amount?: number | null
          balance_before?: number
          balance_after?: number
          order_id?: string | null
          market_id?: string | null
          payment_reference?: string | null
          provider_reference?: string | null
          idempotency_key?: string | null
          payment_provider?: Database["public"]["Enums"]["payment_provider"] | null
          payment_phone?: string | null
          payment_metadata?: Json | null
          description?: string | null
          notes?: string | null
          initiated_at?: string | null
          completed_at?: string | null
          failed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          market_option_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          }
        ]
      }
      wallets: {
        Row: {
          id: string
          user_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          available_balance: number | null
          reserved_balance: number | null
          total_deposited: number | null
          total_withdrawn: number | null
          total_won: number | null
          total_lost: number | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          available_balance?: number | null
          reserved_balance?: number | null
          total_deposited?: number | null
          total_withdrawn?: number | null
          total_won?: number | null
          total_lost?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          available_balance?: number | null
          reserved_balance?: number | null
          total_deposited?: number | null
          total_withdrawn?: number | null
          total_won?: number | null
          total_lost?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      withdrawals: {
        Row: {
          id: string
          user_id: string
          wallet_id: string
          transaction_id: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          provider: Database["public"]["Enums"]["payment_provider"]
          amount: number
          currency: Database["public"]["Enums"]["currency_code"]
          phone_number: string
          provider_reference: string | null
          provider_receipt: string | null
          raw_response: Json | null
          exchange_rate_to_usd: number | null
          fee_amount: number | null
          net_amount: number | null
          requires_review: boolean | null
          reviewed_by: string | null
          reviewed_at: string | null
          review_notes: string | null
          initiated_at: string | null
          completed_at: string | null
          failed_at: string | null
          failure_reason: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          wallet_id: string
          transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          provider: Database["public"]["Enums"]["payment_provider"]
          amount: number
          currency: Database["public"]["Enums"]["currency_code"]
          phone_number: string
          provider_reference?: string | null
          provider_receipt?: string | null
          raw_response?: Json | null
          exchange_rate_to_usd?: number | null
          fee_amount?: number | null
          net_amount?: number | null
          requires_review?: boolean | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          initiated_at?: string | null
          completed_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          wallet_id?: string
          transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          amount?: number
          currency?: Database["public"]["Enums"]["currency_code"]
          phone_number?: string
          provider_reference?: string | null
          provider_receipt?: string | null
          raw_response?: Json | null
          exchange_rate_to_usd?: number | null
          fee_amount?: number | null
          net_amount?: number | null
          requires_review?: boolean | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          initiated_at?: string | null
          completed_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          }
        ]
      }
      creator_tiers: {
        Row: {
          key: string
          label: string
          reward_pct: number
          max_open_markets: number
          auto_publish: boolean
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          key: string
          label: string
          reward_pct?: number
          max_open_markets?: number
          auto_publish?: boolean
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          label?: string
          reward_pct?: number
          max_open_markets?: number
          auto_publish?: boolean
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      creator_profiles: {
        Row: {
          user_id: string
          tier: string
          reward_pct: number | null
          auto_publish: boolean
          max_open_markets: number | null
          status: string
          suspended_reason: string | null
          application_id: string | null
          approved_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          tier?: string
          reward_pct?: number | null
          auto_publish?: boolean
          max_open_markets?: number | null
          status?: string
          suspended_reason?: string | null
          application_id?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          tier?: string
          reward_pct?: number | null
          auto_publish?: boolean
          max_open_markets?: number | null
          status?: string
          suspended_reason?: string | null
          application_id?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      commission_plans: {
        Row: {
          key: string
          label: string
          plan: Json
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          key: string
          label: string
          plan?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          label?: string
          plan?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketer_profiles: {
        Row: {
          user_id: string
          tracking_code: string
          plan_key: string | null
          commission_plan: Json
          hold_days: number
          status: string
          suspended_reason: string | null
          application_id: string | null
          approved_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          tracking_code: string
          plan_key?: string | null
          commission_plan?: Json
          hold_days?: number
          status?: string
          suspended_reason?: string | null
          application_id?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          tracking_code?: string
          plan_key?: string | null
          commission_plan?: Json
          hold_days?: number
          status?: string
          suspended_reason?: string | null
          application_id?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_applications: {
        Row: {
          id: string
          user_id: string
          kind: string
          status: string
          message: string | null
          review_notes: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          kind: string
          status?: string
          message?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          kind?: string
          status?: string
          message?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          id: string
          code: string
          label: string
          marketer_id: string | null
          kind: string
          value_pct: number
          max_value_usd: number | null
          budget_usd: number | null
          spent_usd: number
          max_redemptions: number | null
          redemption_count: number
          per_user_limit: number
          starts_at: string | null
          ends_at: string | null
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          label: string
          marketer_id?: string | null
          kind: string
          value_pct?: number
          max_value_usd?: number | null
          budget_usd?: number | null
          spent_usd?: number
          max_redemptions?: number | null
          redemption_count?: number
          per_user_limit?: number
          starts_at?: string | null
          ends_at?: string | null
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          label?: string
          marketer_id?: string | null
          kind?: string
          value_pct?: number
          max_value_usd?: number | null
          budget_usd?: number | null
          spent_usd?: number
          max_redemptions?: number | null
          redemption_count?: number
          per_user_limit?: number
          starts_at?: string | null
          ends_at?: string | null
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaign_redemptions: {
        Row: {
          id: string
          campaign_id: string
          user_id: string
          amount_usd: number
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          user_id: string
          amount_usd?: number
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          user_id?: string
          amount_usd?: number
          created_at?: string
        }
        Relationships: []
      }
      payout_runs: {
        Row: {
          id: string
          kind: string
          period_start: string
          period_end: string
          status: string
          total_usd: number
          notes: string | null
          created_by: string | null
          computed_at: string | null
          approved_by: string | null
          approved_at: string | null
          disbursed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          kind: string
          period_start: string
          period_end: string
          status?: string
          total_usd?: number
          notes?: string | null
          created_by?: string | null
          computed_at?: string | null
          approved_by?: string | null
          approved_at?: string | null
          disbursed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          kind?: string
          period_start?: string
          period_end?: string
          status?: string
          total_usd?: number
          notes?: string | null
          created_by?: string | null
          computed_at?: string | null
          approved_by?: string | null
          approved_at?: string | null
          disbursed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      payout_items: {
        Row: {
          id: string
          run_id: string
          user_id: string
          amount_usd: number
          settlement: string
          status: string
          eligible_at: string | null
          tx_count: number
          transaction_id: string | null
          detail: Json
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          user_id: string
          amount_usd: number
          settlement?: string
          status?: string
          eligible_at?: string | null
          tx_count?: number
          transaction_id?: string | null
          detail?: Json
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          user_id?: string
          amount_usd?: number
          settlement?: string
          status?: string
          eligible_at?: string | null
          tx_count?: number
          transaction_id?: string | null
          detail?: Json
          created_at?: string
        }
        Relationships: []
      }
      content_reports: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          reporter_id: string | null
          reason: string
          details: string | null
          status: string
          resolution: string | null
          resolution_note: string | null
          handled_by: string | null
          handled_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_type: string
          entity_id: string
          reporter_id?: string | null
          reason: string
          details?: string | null
          status?: string
          resolution?: string | null
          resolution_note?: string | null
          handled_by?: string | null
          handled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_type?: string
          entity_id?: string
          reporter_id?: string | null
          reason?: string
          details?: string | null
          status?: string
          resolution?: string | null
          resolution_note?: string | null
          handled_by?: string | null
          handled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          id: string
          title: string
          body: string
          channels: string[]
          audience: Json
          status: string
          scheduled_at: string | null
          sent_at: string | null
          recipient_count: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          body: string
          channels?: string[]
          audience?: Json
          status?: string
          scheduled_at?: string | null
          sent_at?: string | null
          recipient_count?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          body?: string
          channels?: string[]
          audience?: Json
          status?: string
          scheduled_at?: string | null
          sent_at?: string | null
          recipient_count?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard: {
        Row: {
          id: string | null
          display_name: string | null
          username: string | null
          avatar_url: string | null
          total_bets: number | null
          total_wins: number | null
          win_rate: number | null
          profit_loss_usd: number | null
          total_volume_usd: number | null
          volume_rank: number | null
          winrate_rank: number | null
          pnl_rank: number | null
        }
        Relationships: []
      }
      market_search: {
        Row: {
          id: string | null
          slug: string | null
          title: string | null
          description: string | null
          category: Database["public"]["Enums"]["market_category"] | null
          status: Database["public"]["Enums"]["market_status"] | null
          yes_price: number | null
          no_price: number | null
          total_volume_usd: number | null
          unique_bettors: number | null
          closes_at: string | null
          is_featured: boolean | null
          is_trending: boolean | null
          tags: string[] | null
          cover_image_url: string | null
          created_at: string | null
          search_vector: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      announcement_recipients: {
        Args: { p_audience: Json }
        Returns: string[]
      }
      announcement_audience_count: {
        Args: { p_audience: Json }
        Returns: number
      }
      admin_moderate_content: {
        Args: {
          p_entity_type: string
          p_entity_id: string
          p_action: string
          p_reason?: string | null
        }
        Returns: Json
      }
      admin_resolve_report: {
        Args: {
          p_report_id: string
          p_status: string
          p_resolution?: string | null
          p_note?: string | null
        }
        Returns: Database["public"]["Tables"]["content_reports"]["Row"]
      }
      admin_upsert_announcement: {
        Args: {
          p_id: string | null
          p_title: string
          p_body: string
          p_channels?: string[]
          p_audience?: Json
          p_scheduled_at?: string | null
        }
        Returns: Database["public"]["Tables"]["announcements"]["Row"]
      }
      admin_send_announcement: {
        Args: { p_id: string }
        Returns: Database["public"]["Tables"]["announcements"]["Row"]
      }
      admin_set_announcement_status: {
        Args: { p_id: string; p_status: string }
        Returns: Database["public"]["Tables"]["announcements"]["Row"]
      }
      marketer_commission_usd: {
        Args: { p_plan: Json; p_activations: number; p_revenue_base: number }
        Returns: number
      }
      admin_upsert_creator_tier: {
        Args: {
          p_key: string
          p_label: string
          p_reward_pct: number
          p_max_open_markets: number
          p_auto_publish: boolean
          p_sort_order: number
          p_is_active: boolean
        }
        Returns: Database["public"]["Tables"]["creator_tiers"]["Row"]
      }
      admin_approve_creator: {
        Args: { p_user_id: string; p_tier?: string; p_notes?: string | null }
        Returns: Database["public"]["Tables"]["creator_profiles"]["Row"]
      }
      admin_update_creator: {
        Args: {
          p_user_id: string
          p_tier: string | null
          p_reward_pct: number | null
          p_auto_publish: boolean | null
          p_max_open_markets: number | null
        }
        Returns: Database["public"]["Tables"]["creator_profiles"]["Row"]
      }
      admin_set_creator_status: {
        Args: { p_user_id: string; p_status: string; p_reason?: string | null }
        Returns: Database["public"]["Tables"]["creator_profiles"]["Row"]
      }
      admin_reject_application: {
        Args: { p_application_id: string; p_reason?: string | null }
        Returns: Database["public"]["Tables"]["role_applications"]["Row"]
      }
      admin_upsert_commission_plan: {
        Args: { p_key: string; p_label: string; p_plan: Json; p_is_active: boolean }
        Returns: Database["public"]["Tables"]["commission_plans"]["Row"]
      }
      admin_approve_marketer: {
        Args: {
          p_user_id: string
          p_plan_key?: string | null
          p_plan?: Json | null
          p_hold_days?: number
          p_notes?: string | null
        }
        Returns: Database["public"]["Tables"]["marketer_profiles"]["Row"]
      }
      admin_update_marketer_plan: {
        Args: {
          p_user_id: string
          p_plan_key: string | null
          p_plan: Json | null
          p_hold_days: number | null
        }
        Returns: Database["public"]["Tables"]["marketer_profiles"]["Row"]
      }
      admin_set_marketer_status: {
        Args: { p_user_id: string; p_status: string; p_reason?: string | null }
        Returns: Database["public"]["Tables"]["marketer_profiles"]["Row"]
      }
      admin_regenerate_tracking_code: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Tables"]["marketer_profiles"]["Row"]
      }
      admin_upsert_campaign: {
        Args: {
          p_id: string | null
          p_code: string
          p_label: string
          p_marketer_id: string | null
          p_kind: string
          p_value_pct: number
          p_max_value_usd: number | null
          p_budget_usd: number | null
          p_max_redemptions: number | null
          p_per_user_limit: number
          p_starts_at: string | null
          p_ends_at: string | null
        }
        Returns: Database["public"]["Tables"]["campaigns"]["Row"]
      }
      admin_set_campaign_status: {
        Args: { p_id: string; p_status: string }
        Returns: Database["public"]["Tables"]["campaigns"]["Row"]
      }
      admin_create_payout_run: {
        Args: { p_kind: string; p_period_start: string; p_period_end: string; p_notes?: string | null }
        Returns: Database["public"]["Tables"]["payout_runs"]["Row"]
      }
      admin_compute_payout_run: {
        Args: { p_run_id: string }
        Returns: Database["public"]["Tables"]["payout_runs"]["Row"]
      }
      admin_approve_payout_run: {
        Args: { p_run_id: string }
        Returns: Database["public"]["Tables"]["payout_runs"]["Row"]
      }
      admin_disburse_payout_run: {
        Args: { p_run_id: string }
        Returns: Database["public"]["Tables"]["payout_runs"]["Row"]
      }
      admin_cancel_payout_run: {
        Args: { p_run_id: string; p_reason?: string | null }
        Returns: Database["public"]["Tables"]["payout_runs"]["Row"]
      }
      admin_clawback_payout_item: {
        Args: { p_item_id: string; p_reason: string }
        Returns: Database["public"]["Tables"]["payout_items"]["Row"]
      }
      admin_upsert_gateway: {
        Args: {
          p_id: string | null
          p_provider: Database["public"]["Enums"]["payment_provider"]
          p_country_code: string | null
          p_currency: Database["public"]["Enums"]["currency_code"] | null
          p_label: string
          p_environment: string
          p_priority: number | null
          p_config: Json
          p_min_amount: number | null
          p_max_amount: number | null
        }
        Returns: Database["public"]["Tables"]["payment_gateways"]["Row"]
      }
      admin_set_gateway_enabled: {
        Args: { p_id: string; p_enabled: boolean }
        Returns: Database["public"]["Tables"]["payment_gateways"]["Row"]
      }
      admin_delete_gateway: {
        Args: { p_id: string }
        Returns: Json
      }
      admin_rotate_gateway_secret: {
        Args: { p_gateway_id: string; p_key: string; p_value: string }
        Returns: Json
      }
      admin_clear_gateway_secret: {
        Args: { p_gateway_id: string; p_key: string }
        Returns: Json
      }
      admin_get_gateway_secret: {
        Args: { p_gateway_id: string; p_key: string }
        Returns: string
      }
      admin_record_gateway_health: {
        Args: {
          p_gateway_id: string
          p_ok: boolean
          p_latency_ms: number | null
          p_detail: string | null
        }
        Returns: Database["public"]["Tables"]["gateway_health"]["Row"]
      }
      admin_upsert_setting: {
        Args: { p_key: string; p_value: Json; p_is_public?: boolean }
        Returns: Database["public"]["Tables"]["platform_settings"]["Row"]
      }
      admin_upsert_exchange_rate: {
        Args: {
          p_from: Database["public"]["Enums"]["currency_code"]
          p_to: Database["public"]["Enums"]["currency_code"]
          p_rate: number
          p_source?: string
        }
        Returns: Database["public"]["Tables"]["exchange_rates"]["Row"]
      }
      admin_add_user_note: {
        Args: {
          p_user_id: string
          p_note: string
        }
        Returns: Json
      }
      admin_adjust_balance: {
        Args: {
          p_user_id: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_amount: number
          p_reason: string
          p_type?: Database["public"]["Enums"]["transaction_type"] | null
        }
        Returns: Json
      }
      admin_set_account_status: {
        Args: {
          p_user_id: string
          p_status: Database["public"]["Enums"]["account_status"]
          p_reason?: string | null
        }
        Returns: Json
      }
      admin_set_user_role: {
        Args: {
          p_user_id: string
          p_new_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: Json
      }
      has_capability: {
        Args: {
          cap: string
        }
        Returns: boolean
      }
      is_staff: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_superadmin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      admin_review_kyc: {
        Args: {
          p_doc_id: string
          p_status: Database["public"]["Enums"]["kyc_status"]
          p_reviewer_id: string
          p_rejection_reason?: string | null
        }
        Returns: Json
      }
      cancel_market: {
        Args: {
          p_market_id: string
          p_reason?: string | null
        }
        Returns: Json
      }
      handle_new_user: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      lmsr_cost_to_buy: {
        Args: {
          current_q_yes: number
          current_q_no: number
          delta_q_yes: number
          delta_q_no: number
          b?: number | null
        }
        Returns: number
      }
      lmsr_price: {
        Args: {
          q_yes: number
          q_no: number
          b?: number | null
        }
        Returns: Json
      }
      place_bet: {
        Args: {
          p_user_id: string
          p_market_id: string
          p_side: Database["public"]["Enums"]["order_side"]
          p_amount_local: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_order_type?: Database["public"]["Enums"]["order_type"] | null
          p_limit_price?: number | null
          p_client_order_id?: string | null
        }
        Returns: Json
      }
      place_bet_option: {
        Args: {
          p_user_id: string
          p_market_id: string
          p_option_id: string
          p_amount_local: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_client_order_id?: string | null
        }
        Returns: Json
      }
      resolve_market_options: {
        Args: {
          p_market_id: string
          p_winning_option_id: string
          p_resolver_id: string
          p_resolution_notes?: string | null
        }
        Returns: Json
      }
      place_bet_option_binary: {
        Args: {
          p_user_id: string
          p_market_id: string
          p_option_id: string
          p_side: Database["public"]["Enums"]["order_side"]
          p_amount_local: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_client_order_id?: string | null
        }
        Returns: Json
      }
      clob_place_order: {
        Args: {
          p_user_id: string
          p_market_id: string
          p_market_option_id: string
          p_outcome_side: Database["public"]["Enums"]["order_side"]
          p_action: "buy" | "sell"
          p_order_type: Database["public"]["Enums"]["order_type"]
          p_price_cents: number | null
          p_size: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_client_order_id?: string | null
          p_expires_at?: string | null
        }
        Returns: Json
      }
      clob_cancel_order: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: Json
      }
      clob_get_book: {
        Args: {
          p_market_id: string
          p_market_option_id: string
          p_outcome_side: Database["public"]["Enums"]["order_side"]
        }
        Returns: Json
      }
      resolve_market_options_binary: {
        Args: {
          p_market_id: string
          p_winning_option_id: string
          p_resolver_id: string
          p_resolution_notes?: string | null
        }
        Returns: Json
      }
      set_market_pricing_independent: {
        Args: { p_market_id: string }
        Returns: Json
      }
      admin_resolve_market_options: {
        Args: {
          p_market_id: string
          p_winning_option_id: string
          p_notes: string
        }
        Returns: Json
      }
      admin_resolve_market_options_binary: {
        Args: {
          p_market_id: string
          p_winning_option_id: string
          p_notes: string
        }
        Returns: Json
      }
      lmsr_price_multi: {
        Args: { q: number[]; b: number }
        Returns: number[]
      }
      seed_binary_options: {
        Args: { p_market_id: string }
        Returns: undefined
      }
      refresh_leaderboard: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      search_markets: {
        Args: {
          p_query?: string | null
          p_category?: string | null
          p_status?: string | null
          p_sort?: string | null
          p_limit?: number | null
          p_offset?: number | null
        }
        Returns: Json
      }
      get_my_profile: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Tables"]["profiles"]["Row"][]
      }
      get_leaderboard: {
        Args: {
          p_metric?: string | null
          p_period?: string | null
          p_limit?: number | null
        }
        Returns: Json
      }
      resolve_market: {
        Args: {
          p_market_id: string
          p_outcome: Database["public"]["Enums"]["order_side"]
          p_resolver_id: string
          p_resolution_notes?: string | null
        }
        Returns: Json
      }
      update_profile_stats: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "closed"
      currency_code: "KES" | "UGX" | "TZS" | "RWF" | "ZMW" | "ETB" | "BIF" | "USD"
      kyc_status: "unverified" | "pending" | "verified" | "rejected"
      market_category: "politics" | "sports" | "economics" | "crypto" | "technology" | "entertainment" | "weather" | "governance" | "elections" | "business" | "health" | "social" | "other"
      market_resolution_type: "binary" | "multiple_choice"
      market_status: "draft" | "pending" | "active" | "closed" | "resolved" | "disputed" | "cancelled"
      notification_type: "market_created" | "market_resolved" | "bet_filled" | "bet_won" | "bet_lost" | "deposit_completed" | "withdrawal_completed" | "withdrawal_failed" | "price_alert" | "market_closing_soon" | "referral_bonus" | "kyc_approved" | "kyc_rejected" | "system_announcement"
      order_side: "yes" | "no"
      order_status: "open" | "filled" | "partially_filled" | "cancelled" | "expired"
      order_type: "market" | "limit"
      payment_provider: "mpesa" | "mtn_momo" | "airtel_money" | "pesapal" | "bank_transfer" | "internal"
      position_side: "yes" | "no"
      transaction_status: "pending" | "processing" | "completed" | "failed" | "refunded"
      transaction_type: "deposit" | "withdrawal" | "bet_placed" | "bet_won" | "bet_lost" | "bet_refunded" | "fee" | "bonus" | "referral_bonus" | "creator_reward"
      user_role: "user" | "admin" | "moderator" | "resolver" | "creator" | "marketer" | "support" | "finance" | "superadmin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database['public']
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]

