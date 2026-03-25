import { supabase } from './supabase';
import type { TransactionType, CompletionMethod } from '../services/EscrowService';
import { debugWarn } from './debugLogger';

export type TransactionRule = {
  type: TransactionType;
  completion_method: CompletionMethod;
  confirmation_method?: string | null;
  dispute_allowed?: boolean | null;
  timeout_hours?: number | null;
};

const DEFAULT_RULES: TransactionRule[] = [
  {
    type: 'physical_product',
    completion_method: 'delivery_code',
    confirmation_method: 'delivery_code',
    dispute_allowed: true,
    timeout_hours: 168,
  },
  {
    type: 'digital_product',
    completion_method: 'sender_release',
    confirmation_method: 'manual',
    dispute_allowed: true,
    timeout_hours: 0,
  },
  {
    type: 'service',
    completion_method: 'service_approval',
    confirmation_method: 'manual',
    dispute_allowed: true,
    timeout_hours: 72,
  },
  {
    type: 'currency_exchange',
    completion_method: 'receipt_evidence',
    confirmation_method: 'receipt_upload',
    dispute_allowed: true,
    timeout_hours: 24,
  },
  {
    type: 'instant',
    completion_method: 'sender_release',
    confirmation_method: 'auto',
    dispute_allowed: true,
    timeout_hours: 0,
  },
  {
    type: 'donation',
    completion_method: 'sender_release',
    confirmation_method: 'auto',
    dispute_allowed: false,
    timeout_hours: 0,
  },
  {
    type: 'custom',
    completion_method: 'sender_release',
    confirmation_method: 'manual',
    dispute_allowed: true,
    timeout_hours: 72,
  },
  {
    type: 'other',
    completion_method: 'sender_release',
    confirmation_method: 'manual',
    dispute_allowed: true,
    timeout_hours: 72,
  },
];

export async function fetchTransactionRules(): Promise<TransactionRule[]> {
  try {
    const { data, error } = await supabase
      .from('transaction_rules')
      .select('*')
      .order('type');

    if (error || !data || data.length === 0) {
      return DEFAULT_RULES;
    }

    return data as TransactionRule[];
  } catch (error) {
    debugWarn('[transactionRules] Falling back to defaults:', error);
    return DEFAULT_RULES;
  }
}

export function resolveCompletionMethod(
  type: TransactionType,
  rules: TransactionRule[]
): CompletionMethod {
  const rule = rules.find((item) => item.type === type);
  return rule?.completion_method || 'sender_release';
}

