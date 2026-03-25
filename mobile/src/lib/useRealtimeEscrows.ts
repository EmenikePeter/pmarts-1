import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { Escrow, User } from './types';
import dlog, { derror } from './dlog';
import { getBestAuthTokenFromSupabase } from './appSession';
import { getApiEndpoint } from './api';

type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Escrow;
  old: Escrow | null;
};

export function useRealtimeEscrows(userId: string) {
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);

  // Check if this is a mock/dev user (non-UUID format)
  const isMockUser = userId.startsWith('mock_') || !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // Fetch initial escrows
  const fetchEscrows = useCallback(async () => {
    setLoading(true);
    
    // Skip database query for mock users - they'll use mock data in HomeScreen
    if (isMockUser) {
      setEscrows([]);
      setLoading(false);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('escrows')
        .select('*, sender:users!sender_id(*), recipient:users!recipient_id(*)')
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        setEscrows(data);
        return;
      }

      const token = await getBestAuthTokenFromSupabase(supabase);
      if (token) {
        const response = await fetch(getApiEndpoint(`/api/escrow/v2/user/${userId}?limit=100`), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }).catch(() => null);

        const payload = response ? await response.json().catch(() => null) : null;
        if (response?.ok && payload?.success && Array.isArray(payload?.escrows)) {
          setEscrows(payload.escrows);
          return;
        }
      }

      if (error) throw error;
      setEscrows(data || []);
    } catch (err) {
      derror('Error fetching escrows:', err);
      setEscrows([]);
    } finally {
      setLoading(false);
    }
  }, [userId, isMockUser]);

  useEffect(() => {
    fetchEscrows();

    // Skip realtime subscription for mock users
    if (isMockUser) return;

    // Subscribe to realtime changes
    const channel = supabase
      .channel('escrows-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'escrows',
          filter: `sender_id=eq.${userId}`,
        },
        (payload: any) => handleRealtimeUpdate(payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'escrows',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload: any) => handleRealtimeUpdate(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchEscrows]);

  const handleRealtimeUpdate = (payload: RealtimePayload) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    setEscrows((current) => {
      switch (eventType) {
        case 'INSERT':
          // Add new escrow at the beginning
          return [newRecord, ...current];

        case 'UPDATE':
          // Update existing escrow
          return current.map((escrow) =>
            escrow.id === newRecord.id ? { ...escrow, ...newRecord } : escrow
          );

        case 'DELETE':
          // Remove deleted escrow
          return current.filter((escrow) => escrow.id !== oldRecord?.id);

        default:
          return current;
      }
    });
  };

  return { escrows, loading, refetch: fetchEscrows };
}

// Hook for single escrow realtime updates
export function useRealtimeEscrow(escrowId: string) {
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEscrow = async () => {
      try {
        const { data, error } = await supabase
          .from('escrows')
          .select('*, sender:users!sender_id(*), recipient:users!recipient_id(*)')
          .eq('id', escrowId)
          .maybeSingle();

        if (error) throw error;
        setEscrow(data);
      } catch (err) {
        derror('Error fetching escrow:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchEscrow();

    // Subscribe to changes on this specific escrow
    const channel = supabase
      .channel(`escrow-${escrowId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'escrows',
          filter: `id=eq.${escrowId}`,
        },
        (payload: any) => {
          setEscrow((current) => (current ? { ...current, ...payload.new } : payload.new));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [escrowId]);

  return { escrow, loading };
}

// Hook for realtime notifications
export function useRealtimeNotifications(userId: string) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Check if this is a mock/dev user (non-UUID format)
  const isMockUser = userId.startsWith('mock_') || !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  useEffect(() => {
    // Skip database query for mock users
    if (isMockUser) return;

    const fetchNotifications = async () => {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        setNotifications(data || []);
        setUnreadCount(data?.filter((n: any) => !n.is_read).length || 0);
      } catch (err) {
        derror('Error fetching notifications:', err);
      }
    };

    fetchNotifications();

    // Subscribe to new notifications
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          setNotifications((current) => [payload.new, ...current]);
          setUnreadCount((count) => count + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, isMockUser]);

  const markAsRead = async (notificationId: string) => {
    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      setNotifications((current) =>
        current.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) {
      derror('Error marking notification as read:', err);
    }
  };

  return { notifications, unreadCount, markAsRead };
}

