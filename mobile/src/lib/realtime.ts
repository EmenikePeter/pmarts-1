import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { Escrow, Notification } from './types';

type EscrowCallback = (escrow: Escrow) => void;
type NotificationCallback = (notification: Notification) => void;

// Helper to check if user ID is a mock/dev user (non-UUID format)
const isMockUser = (userId: string) => 
  userId.startsWith('mock_') || !userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/**
 * Subscribe to realtime escrow updates for a user (as sender or recipient)
 * Fires callback on INSERT (new deposit) or UPDATE (release/refund)
 */
export function useEscrowRealtime(userId: string, onUpdate: EscrowCallback) {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  useEffect(() => {
    // Skip subscription for mock users or missing userId
    if (!userId || isMockUser(userId)) return;

    // Simple debounce map to avoid spamming the callback for the same escrow
    const lastCalled: Record<string, number> = {};
    const DEBOUNCE_MS = 3000;

    const channel = supabase
      .channel(`escrows-user-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'escrows',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload: any) => {
          try {
            const id = (payload.new as Escrow)?.id;
            const now = Date.now();
            if (id) {
              const last = lastCalled[id] || 0;
              if (now - last < DEBOUNCE_MS) return;
              lastCalled[id] = now;
            }
          } catch (e) {
            // ignore
          }
          callbackRef.current(payload.new as Escrow);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'escrows',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload: any) => {
          try {
            const id = (payload.new as Escrow)?.id;
            const now = Date.now();
            if (id) {
              const last = lastCalled[id] || 0;
              if (now - last < DEBOUNCE_MS) return;
              lastCalled[id] = now;
            }
          } catch (e) {
            // ignore
          }
          callbackRef.current(payload.new as Escrow);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'escrows',
          filter: `sender_id=eq.${userId}`,
        },
        (payload: any) => {
          try {
            const id = (payload.new as Escrow)?.id;
            const now = Date.now();
            if (id) {
              const last = lastCalled[id] || 0;
              if (now - last < DEBOUNCE_MS) return;
              lastCalled[id] = now;
            }
          } catch (e) {
            // ignore
          }
          callbackRef.current(payload.new as Escrow);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'escrows',
          filter: `sender_id=eq.${userId}`,
        },
        (payload: any) => {
          try {
            const id = (payload.new as Escrow)?.id;
            const now = Date.now();
            if (id) {
              const last = lastCalled[id] || 0;
              if (now - last < DEBOUNCE_MS) return;
              lastCalled[id] = now;
            }
          } catch (e) {
            // ignore
          }
          callbackRef.current(payload.new as Escrow);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

/**
 * Subscribe to realtime notification updates for a user
 * Fires callback on INSERT (new notification)
 */
export function useNotificationRealtime(userId: string, onNotify: NotificationCallback) {
  const callbackRef = useRef(onNotify);
  callbackRef.current = onNotify;

  useEffect(() => {
    // Skip subscription for mock users or missing userId
    if (!userId || isMockUser(userId)) return;

    const channel = supabase
      .channel(`notifications-user-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          callbackRef.current(payload.new as Notification);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

/**
 * Subscribe to realtime rating updates for a user
 * Fires when user receives a new rating
 */
export function useRatingRealtime(userId: string, onRating: (rating: any) => void) {
  const callbackRef = useRef(onRating);
  callbackRef.current = onRating;

  useEffect(() => {
    // Skip subscription for mock users or missing userId
    if (!userId || isMockUser(userId)) return;

    const channel = supabase
      .channel(`ratings-user-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ratings',
          filter: `rated_id=eq.${userId}`,
        },
        (payload: any) => {
          callbackRef.current(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

