/**
 * Pi Platform API Integration
 * Server-side Pi Network API calls
 * 
 * This handles the server-to-server communication with Pi Platform
 * as required by Pi SDK payment flow.
 */

import dlog, { derror } from './dlog';

// Pi Platform API Base URL
const PI_API_BASE = 'https://api.minepi.com';

// Server API Key (set via environment variables)
const PI_API_KEY = process.env.PI_API_KEY || '';

interface PiPaymentDTO {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, any>;
  from_address: string;
  to_address: string;
  direction: 'user_to_app' | 'app_to_user';
  created_at: string;
  network: 'Pi Network' | 'Pi Testnet';
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction: {
    txid: string;
    verified: boolean;
    _link: string;
  } | null;
}

/**
 * Get payment details from Pi Platform
 */
export async function getPayment(paymentId: string): Promise<PiPaymentDTO | null> {
  try {
    const response = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get payment: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    derror('[Pi API] Get payment error:', error);
    return null;
  }
}

/**
 * Approve a payment (server-to-server)
 * Called when user approves payment in Pi Browser
 */
export async function approvePayment(paymentId: string): Promise<PiPaymentDTO | null> {
  try {
    const response = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to approve payment: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    derror('[Pi API] Approve payment error:', error);
    throw error;
  }
}

/**
 * Complete a payment (server-to-server)
 * Called after blockchain transaction is verified
 */
export async function completePayment(
  paymentId: string,
  txid: string
): Promise<PiPaymentDTO | null> {
  try {
    const response = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ txid }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to complete payment: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    derror('[Pi API] Complete payment error:', error);
    throw error;
  }
}

/**
 * Cancel a payment
 */
export async function cancelPayment(paymentId: string): Promise<boolean> {
  try {
    const response = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    return response.ok;
  } catch (error) {
    derror('[Pi API] Cancel payment error:', error);
    return false;
  }
}

/**
 * Verify user access token with Pi Platform
 */
export async function verifyUser(accessToken: string): Promise<{
  uid: string;
  username: string;
} | null> {
  try {
    const response = await fetch(`${PI_API_BASE}/v2/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to verify user');
    }

    return await response.json();
  } catch (error) {
    derror('[Pi API] Verify user error:', error);
    return null;
  }
}

/**
 * Create an A2U (App-to-User) payment
 * Used for releasing escrow funds to recipient
 */
export async function createA2UPayment(params: {
  amount: number;
  memo: string;
  metadata: Record<string, any>;
  uid: string; // Recipient Pi user UID
}): Promise<string | null> {
  try {
    const response = await fetch(`${PI_API_BASE}/v2/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payment: {
          amount: params.amount,
          memo: params.memo,
          metadata: params.metadata,
          uid: params.uid,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create A2U payment: ${errorText}`);
    }

    const data = await response.json();
    return data.identifier;
  } catch (error) {
    derror('[Pi API] Create A2U payment error:', error);
    return null;
  }
}

/**
 * Submit A2U payment to blockchain
 */
export async function submitA2UPayment(
  paymentId: string
): Promise<PiPaymentDTO | null> {
  try {
    const response = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to submit A2U payment: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    derror('[Pi API] Submit A2U payment error:', error);
    return null;
  }
}

