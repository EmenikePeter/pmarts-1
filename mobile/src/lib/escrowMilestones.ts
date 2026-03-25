import { supabase } from './supabase';
import { API_URL } from './api';
import type { EscrowMilestone } from './types';

export type CreateMilestoneInput = {
  title: string;
  amount: number;
};

export async function getEscrowMilestones(
  escrowId: string,
  userId: string
): Promise<EscrowMilestone[]> {
  try {
    const response = await fetch(
      `${API_URL}/api/completion/milestones/${escrowId}?userId=${userId}`
    );
    const result = await response.json();

    if (!result.success) {
      return [];
    }

    return result.milestones as EscrowMilestone[];
  } catch (error) {
    const { data, error: dbError } = await supabase
      .from('escrow_milestones')
      .select('*')
      .eq('escrow_id', escrowId)
      .order('position', { ascending: true });

    if (dbError || !data) return [];
    return data as EscrowMilestone[];
  }
}

export async function createEscrowMilestones(
  escrowId: string,
  milestones: CreateMilestoneInput[]
): Promise<boolean> {
  if (milestones.length === 0) return true;

  const payload = milestones.map((milestone, index) => ({
    escrow_id: escrowId,
    title: milestone.title,
    amount: milestone.amount,
    position: index + 1,
    status: 'pending',
  }));

  const { error } = await supabase.from('escrow_milestones').insert(payload);
  return !error;
}

export async function updateMilestoneStatus(
  escrowId: string,
  milestoneId: string,
  userId: string,
  status: EscrowMilestone['status']
): Promise<boolean> {
  const endpoint = status === 'completed'
    ? '/api/completion/milestone/complete'
    : status === 'approved'
      ? '/api/completion/milestone/approve'
      : null;

  if (!endpoint) return false;

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escrowId, milestoneId, userId }),
    });
    const result = await response.json();
    return Boolean(result.success);
  } catch (error) {
    return false;
  }
}

