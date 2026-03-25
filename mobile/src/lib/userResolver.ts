import { supabase } from './supabase';
import type { User } from '../types/database';

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getUserById<T = User>(
  userId: string,
  columns = '*',
  options: { maybeSingle?: boolean } = {}
): Promise<{ data: T | null; error: any }> {
  const { maybeSingle = false } = options;
  const query = supabase.from('users').select(columns).eq('id', userId);
  return (maybeSingle ? query.maybeSingle() : query.single()) as Promise<{ data: T | null; error: any }>;
}

export async function updateUserById<T = User>(
  userId: string,
  values: Record<string, any>,
  options: { select?: string; maybeSingle?: boolean } = {}
): Promise<{ data: T | null; error: any }> {
  const { select, maybeSingle = false } = options;
  let query: any = supabase.from('users').update(values).eq('id', userId);
  if (select) {
    query = query.select(select);
    return (maybeSingle ? query.maybeSingle() : query.single()) as Promise<{ data: T | null; error: any }>;
  }
  return query as Promise<{ data: T | null; error: any }>;
}

export async function resolveUserByIdOrPiId(identifier: string): Promise<User | null> {
  if (!identifier) return null;

  if (isUuid(identifier)) {
    const { data } = await getUserById<User>(identifier, '*', { maybeSingle: true });
    if (data) return data as User;
  }

  const { data } = await supabase.from('users').select('*').eq('pi_id', identifier).maybeSingle();
  return (data as User) || null;
}
