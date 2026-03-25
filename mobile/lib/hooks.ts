import { useState, useEffect, useCallback } from 'react';
import { supabase, Database, EscrowStatus } from './supabase';

type User = Database['public']['Tables']['users']['Row'];
type Escrow = Database['public']['Tables']['escrows']['Row'];

// Extended escrow with user info
export type EscrowWithUsers = Escrow & {
  sender?: User;
  recipient?: User;
};

// Demo user for MVP (replace with Pi auth later)
export const DEMO_USER: User = {
  id: 'demo-user-1',
  pi_uid: null,
  username: 'demo_user',
  trust_id: 'TL-000001',
  trust_score: 4.8,
  total_escrows: 12,
  completed_escrows: 10,
  disputes: 1,
  created_at: new Date().toISOString(),
};

// Generate escrow ID
export const generateEscrowId = (): string => {
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ESC-${random}`;
};

// Generate Trust ID
export const generateTrustId = (): string => {
  const random = Math.floor(100000 + Math.random() * 900000);
  return `TL-${random}`;
};

// Format Pi amount
export const formatPi = (amount: number): string => {
  return `${amount.toFixed(2)} π`;
};

// Get status color
export const getStatusColor = (status: EscrowStatus): string => {
  const colors: Record<EscrowStatus, string> = {
    held: '#EAB308',      // Yellow
    released: '#22C55E',  // Green
    disputed: '#EF4444',  // Red
    cancelled: '#9CA3AF', // Gray
    expired: '#9CA3AF',   // Gray
  };
  return colors[status];
};

// Get status label
export const getStatusLabel = (status: EscrowStatus): string => {
  const labels: Record<EscrowStatus, string> = {
    held: 'Held',
    released: 'Released',
    disputed: 'Disputed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  return labels[status];
};

// Current user state (MVP: use demo user, later: Pi auth)
export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(DEMO_USER);
  const [loading, setLoading] = useState(false);

  return { user, loading, setUser };
}

// Fetch user's escrows
export function useEscrows(userId: string | undefined) {
  const [incoming, setIncoming] = useState<EscrowWithUsers[]>([]);
  const [outgoing, setOutgoing] = useState<EscrowWithUsers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEscrows = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // For MVP, use mock data
      const mockEscrows: EscrowWithUsers[] = [
        {
          id: '1',
          escrow_id: 'ESC-ABC123',
          sender_id: 'other-user',
          recipient_id: userId,
          amount: 5,
          reference_id: 'ORDER-449',
          note: 'Payment for logo design',
          status: 'held',
          created_at: new Date().toISOString(),
          released_at: null,
          deadline: null,
          sender: {
            id: 'other-user',
            pi_uid: null,
            username: 'john_dev',
            trust_id: 'TL-948238',
            trust_score: 4.2,
            total_escrows: 45,
            completed_escrows: 42,
            disputes: 2,
            created_at: new Date().toISOString(),
          },
        },
        {
          id: '2',
          escrow_id: 'ESC-DEF456',
          sender_id: userId,
          recipient_id: 'other-user-2',
          amount: 3,
          reference_id: 'LOGO-22',
          note: 'App icon design',
          status: 'released',
          created_at: new Date(Date.now() - 86400000).toISOString(),
          released_at: new Date().toISOString(),
          deadline: null,
          recipient: {
            id: 'other-user-2',
            pi_uid: null,
            username: 'sarah_art',
            trust_id: 'TL-123456',
            trust_score: 4.9,
            total_escrows: 132,
            completed_escrows: 130,
            disputes: 0,
            created_at: new Date().toISOString(),
          },
        },
        {
          id: '3',
          escrow_id: 'ESC-GHI789',
          sender_id: userId,
          recipient_id: 'other-user-3',
          amount: 7,
          reference_id: 'WEB-101',
          note: 'Website landing page',
          status: 'held',
          created_at: new Date(Date.now() - 3600000).toISOString(),
          released_at: null,
          deadline: null,
          recipient: {
            id: 'other-user-3',
            pi_uid: null,
            username: 'mike_web',
            trust_id: 'TL-789012',
            trust_score: 4.5,
            total_escrows: 78,
            completed_escrows: 75,
            disputes: 1,
            created_at: new Date().toISOString(),
          },
        },
      ];

      setIncoming(mockEscrows.filter(e => e.recipient_id === userId));
      setOutgoing(mockEscrows.filter(e => e.sender_id === userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch escrows');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchEscrows();
  }, [fetchEscrows]);

  return { incoming, outgoing, loading, error, refetch: fetchEscrows };
}

// Calculate escrow balance (total held)
export function useEscrowBalance(userId: string | undefined) {
  const { outgoing, loading } = useEscrows(userId);
  
  const balance = outgoing
    .filter(e => e.status === 'held')
    .reduce((sum, e) => sum + e.amount, 0);

  return { balance, loading };
}

// Recent escrows for home screen
export function useRecentEscrows(userId: string | undefined, limit = 5) {
  const { incoming, outgoing, loading, error, refetch } = useEscrows(userId);
  
  const recent = [...incoming, ...outgoing]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  return { recent, loading, error, refetch };
}

// Create new escrow
export async function createEscrow(
  senderId: string,
  recipientTrustId: string,
  amount: number,
  referenceId: string,
  note?: string
): Promise<{ success: boolean; escrowId?: string; error?: string }> {
  try {
    // In real app, look up recipient by trust_id
    // For MVP, simulate success
    const escrowId = generateEscrowId();
    
    // Here you would:
    // 1. Lookup recipient by trust_id
    // 2. Create escrow record
    // 3. Trigger Pi payment
    
    return { success: true, escrowId };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Failed to create escrow' 
    };
  }
}

// Release escrow payment
export async function releaseEscrow(
  escrowId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // In real app:
    // 1. Verify user is sender
    // 2. Update status to 'released'
    // 3. Transfer Pi to recipient
    
    return { success: true };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Failed to release escrow' 
    };
  }
}

// Open dispute
export async function openDispute(
  escrowId: string,
  userId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // In real app:
    // 1. Update status to 'disputed'
    // 2. Create dispute record
    // 3. Notify admin
    
    return { success: true };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Failed to open dispute' 
    };
  }
}

