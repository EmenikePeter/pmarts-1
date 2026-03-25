import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const supabaseUrl = 'https://zlzepcizwditfxckyuwl.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemVwY2l6d2RpdGZ4Y2t5dXdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2ODUyNjgsImV4cCI6MjA4ODI2MTI2OH0.ITeotKblFmYymMWC32L6UvE1OmWUhulrn9asSb8-0QU';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Escrow status types
export type EscrowStatus = 'held' | 'released' | 'disputed' | 'cancelled' | 'expired';

// Trust Badge types
export type TrustBadge = 'elite' | 'trusted' | 'average' | 'risky';

export const getTrustBadge = (score: number): TrustBadge => {
  if (score >= 4.5) return 'elite';
  if (score >= 3.5) return 'trusted';
  if (score >= 2.5) return 'average';
  return 'risky';
};

export const getTrustLabel = (badge: TrustBadge): string => {
  const labels: Record<TrustBadge, string> = {
    elite: '⭐ 5.0 Elite',
    trusted: '⭐ 4.5+ Trusted',
    average: '⭐ 3.5+ Average',
    risky: '⚠️ Risky',
  };
  return labels[badge];
};

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          pi_uid: string | null;
          username: string;
          trust_id: string;
          trust_score: number;
          total_escrows: number;
          completed_escrows: number;
          disputes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          pi_uid?: string | null;
          username: string;
          trust_id?: string;
          trust_score?: number;
          total_escrows?: number;
          completed_escrows?: number;
          disputes?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          pi_uid?: string | null;
          username?: string;
          trust_id?: string;
          trust_score?: number;
          total_escrows?: number;
          completed_escrows?: number;
          disputes?: number;
          created_at?: string;
        };
      };
      escrows: {
        Row: {
          id: string;
          escrow_id: string;
          sender_id: string;
          recipient_id: string;
          amount: number;
          reference_id: string;
          note: string | null;
          status: EscrowStatus;
          created_at: string;
          released_at: string | null;
          deadline: string | null;
        };
        Insert: {
          id?: string;
          escrow_id?: string;
          sender_id: string;
          recipient_id: string;
          amount: number;
          reference_id: string;
          note?: string | null;
          status?: EscrowStatus;
          created_at?: string;
          released_at?: string | null;
          deadline?: string | null;
        };
        Update: {
          id?: string;
          escrow_id?: string;
          sender_id?: string;
          recipient_id?: string;
          amount?: number;
          reference_id?: string;
          note?: string | null;
          status?: EscrowStatus;
          created_at?: string;
          released_at?: string | null;
          deadline?: string | null;
        };
      };
      ratings: {
        Row: {
          id: string;
          escrow_id: string;
          from_user: string;
          to_user: string;
          rating: number;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          escrow_id: string;
          from_user: string;
          to_user: string;
          rating: number;
          comment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          escrow_id?: string;
          from_user?: string;
          to_user?: string;
          rating?: number;
          comment?: string | null;
          created_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          message: string;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          message: string;
          read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: string;
          message?: string;
          read?: boolean;
          created_at?: string;
        };
      };
    };
  };
};

