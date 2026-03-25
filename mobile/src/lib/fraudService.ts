/**
 * PMARTS Fraud Detection Service
 * Configurable rules engine for fraud prevention
 */

import { supabase } from './supabase';
import { getUserById } from './userResolver';

// ============================================
// Types
// ============================================

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'blocked';

export interface FraudRule {
  id: string;
  rule_name: string;
  rule_code: string;
  description?: string;
  rule_type: 'velocity' | 'amount' | 'pattern' | 'reputation' | 'network' | 'composite';
  parameters: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'flag' | 'alert' | 'block' | 'require_approval' | 'suspend_user';
  is_active: boolean;
}

export interface FraudMatch {
  id: string;
  rule_id: string;
  rule_code?: string;
  user_id: string;
  escrow_id?: string;
  match_details: Record<string, any>;
  action_taken: string;
  reviewed: boolean;
  false_positive?: boolean;
  created_at: string;
}

export interface UserRiskProfile {
  user_id: string;
  risk_score: number;
  risk_level: RiskLevel;
  fraud_flags_count: number;
  disputes_as_sender: number;
  disputes_as_recipient: number;
  disputes_lost: number;
  identity_verified: boolean;
  phone_verified: boolean;
  email_verified: boolean;
  requires_manual_review: boolean;
  custom_transaction_limit?: number;
  custom_daily_limit?: number;
}

export interface RiskCheck {
  allowed: boolean;
  risk_level: RiskLevel;
  risk_score: number;
  flags: string[];
  requires_approval: boolean;
  block_reason?: string;
}

// ============================================
// Fraud Detection Service
// ============================================

class FraudDetectionService {
  /**
   * Check transaction risk before allowing escrow
   */
  async checkTransactionRisk(params: {
    userId: string;
    amount: number;
    recipientId?: string;
    escrowId?: string;
  }): Promise<RiskCheck> {
    const flags: string[] = [];
    let requiresApproval = false;
    let blocked = false;
    let blockReason: string | undefined;

    try {
      // Get user risk profile
      const profile = await this.getUserRiskProfile(params.userId);
      
      // Get active fraud rules
      const { data: rules } = await supabase
        .from('fraud_rules')
        .select('*')
        .eq('is_active', true);

      if (rules) {
        for (const rule of rules) {
          const match = await this.evaluateRule(rule, params);
          
          if (match.triggered) {
            flags.push(rule.rule_code);
            
            // Record the match
            await this.recordMatch({
              ruleId: rule.id,
              userId: params.userId,
              escrowId: params.escrowId,
              matchDetails: match.details,
              actionTaken: rule.action,
            });

            // Apply action
            switch (rule.action) {
              case 'block':
                blocked = true;
                blockReason = rule.rule_name;
                break;
              case 'require_approval':
                requiresApproval = true;
                break;
              case 'suspend_user':
                blocked = true;
                blockReason = 'Account suspended due to suspicious activity';
                await this.suspendUser(params.userId, rule.rule_code);
                break;
            }
          }
        }
      }

      // Check custom limits
      if (profile.profile) {
        if (profile.profile.requires_manual_review) {
          requiresApproval = true;
        }
        if (profile.profile.custom_transaction_limit && 
            params.amount > profile.profile.custom_transaction_limit) {
          requiresApproval = true;
          flags.push('EXCEEDS_CUSTOM_LIMIT');
        }
      }

      const riskLevel = profile.profile?.risk_level || 'low';
      const riskScore = profile.profile?.risk_score || 0;

      return {
        allowed: !blocked,
        risk_level: riskLevel,
        risk_score: riskScore,
        flags,
        requires_approval: requiresApproval,
        block_reason: blockReason,
      };
    } catch (err) {
      // On error, allow with flag
      return {
        allowed: true,
        risk_level: 'low',
        risk_score: 0,
        flags: ['RISK_CHECK_ERROR'],
        requires_approval: false,
      };
    }
  }

  /**
   * Evaluate a single fraud rule
   */
  private async evaluateRule(
    rule: FraudRule,
    params: { userId: string; amount: number; recipientId?: string }
  ): Promise<{ triggered: boolean; details: Record<string, any> }> {
    const ruleParams = rule.parameters;

    switch (rule.rule_type) {
      case 'velocity':
        return this.checkVelocity(params.userId, ruleParams);
      
      case 'amount':
        return this.checkAmount(params.amount, ruleParams);
      
      case 'composite':
        return this.checkComposite(params.userId, params.amount, ruleParams);
      
      case 'reputation':
        return this.checkReputation(params.userId, ruleParams);
      
      case 'pattern':
        return this.checkPattern(params.userId, params.amount, ruleParams);
      
      case 'network':
        return this.checkNetwork(params.userId, params.recipientId, ruleParams);
      
      default:
        return { triggered: false, details: {} };
    }
  }

  /**
   * Check velocity (rate) based rules
   */
  private async checkVelocity(
    userId: string,
    params: { max_count?: number; time_window_minutes?: number; volume_multiplier?: number; baseline_days?: number }
  ): Promise<{ triggered: boolean; details: Record<string, any> }> {
    const timeWindow = params.time_window_minutes || 10;
    const maxCount = params.max_count || 5;

    const { count } = await supabase
      .from('escrows')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', userId)
      .gte('created_at', new Date(Date.now() - timeWindow * 60 * 1000).toISOString());

    const currentCount = count || 0;
    const triggered = currentCount >= maxCount;

    return {
      triggered,
      details: { current_count: currentCount, max_count: maxCount, time_window_minutes: timeWindow },
    };
  }

  /**
   * Check amount based rules
   */
  private async checkAmount(
    amount: number,
    params: { max_amount?: number; min_amount?: number }
  ): Promise<{ triggered: boolean; details: Record<string, any> }> {
    const triggered = 
      (params.max_amount && amount > params.max_amount) ||
      (params.min_amount && amount < params.min_amount);

    return {
      triggered: !!triggered,
      details: { amount, max_amount: params.max_amount, min_amount: params.min_amount },
    };
  }

  /**
   * Check composite rules (multiple conditions)
   */
  private async checkComposite(
    userId: string,
    amount: number,
    params: { max_amount?: number; min_completed_escrows?: number; account_age_days?: number; volume_threshold?: number }
  ): Promise<{ triggered: boolean; details: Record<string, any> }> {
    const { data: user } = await getUserById<{ completed_escrows: number; created_at: string }>(userId, 'completed_escrows, created_at');

    if (!user) {
      return { triggered: false, details: {} };
    }

    const accountAgeDays = Math.floor(
      (Date.now() - new Date(user.created_at).getTime()) / (24 * 60 * 60 * 1000)
    );

    // Large first transaction check
    if (params.min_completed_escrows !== undefined && params.max_amount) {
      if (user.completed_escrows <= params.min_completed_escrows && amount > params.max_amount) {
        return {
          triggered: true,
          details: {
            completed_escrows: user.completed_escrows,
            amount,
            threshold: params.max_amount,
            rule: 'large_first_transaction',
          },
        };
      }
    }

    // New account high volume check
    if (params.account_age_days && params.volume_threshold) {
      if (accountAgeDays < params.account_age_days) {
        const { data: volumeData } = await supabase
          .from('escrows')
          .select('amount')
          .eq('sender_id', userId);

        const totalVolume = volumeData?.reduce((sum: number, e: any) => sum + parseFloat(e.amount), 0) || 0;

        if (totalVolume + amount > params.volume_threshold) {
          return {
            triggered: true,
            details: {
              account_age_days: accountAgeDays,
              total_volume: totalVolume,
              threshold: params.volume_threshold,
              rule: 'new_account_high_volume',
            },
          };
        }
      }
    }

    return { triggered: false, details: {} };
  }

  /**
   * Check reputation based rules
   */
  private async checkReputation(
    userId: string,
    params: { dispute_count?: number; time_window_days?: number }
  ): Promise<{ triggered: boolean; details: Record<string, any> }> {
    const timeWindow = params.time_window_days || 30;
    const maxDisputes = params.dispute_count || 3;

    const { count } = await supabase
      .from('dispute_cases')
      .select('*', { count: 'exact', head: true })
      .or(`opened_by.eq.${userId},respondent_id.eq.${userId}`)
      .gte('created_at', new Date(Date.now() - timeWindow * 24 * 60 * 60 * 1000).toISOString());

    const disputeCount = count || 0;
    const triggered = disputeCount >= maxDisputes;

    return {
      triggered,
      details: { dispute_count: disputeCount, max_disputes: maxDisputes, time_window_days: timeWindow },
    };
  }

  /**
   * Check pattern based rules
   */
  private async checkPattern(
    userId: string,
    amount: number,
    params: { consecutive_round_amounts?: number }
  ): Promise<{ triggered: boolean; details: Record<string, any> }> {
    const consecutiveThreshold = params.consecutive_round_amounts || 3;

    // Check for round amount pattern
    const { data: recentEscrows } = await supabase
      .from('escrows')
      .select('amount')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(consecutiveThreshold);

    if (!recentEscrows || recentEscrows.length < consecutiveThreshold - 1) {
      return { triggered: false, details: {} };
    }

    // Check if all amounts including current are round numbers
    const amounts = [...recentEscrows.map((e: any) => parseFloat(e.amount)), amount];
    const roundAmounts = amounts.filter(a => a % 10 === 0 || a % 5 === 0);

    const triggered = roundAmounts.length >= consecutiveThreshold;

    return {
      triggered,
      details: { 
        round_amounts: roundAmounts.length, 
        threshold: consecutiveThreshold,
        amounts 
      },
    };
  }

  /**
   * Check network/relationship based rules
   */
  private async checkNetwork(
    userId: string,
    recipientId: string | undefined,
    params: { same_device_threshold?: number }
  ): Promise<{ triggered: boolean; details: Record<string, any> }> {
    if (!recipientId) {
      return { triggered: false, details: {} };
    }

    // Self-dealing check
    if (userId === recipientId) {
      return {
        triggered: true,
        details: { rule: 'self_dealing', user_id: userId },
      };
    }

    // Check for circular transactions (A -> B -> A pattern)
    const { data: reverseTransactions } = await supabase
      .from('escrows')
      .select('id')
      .eq('sender_id', recipientId)
      .eq('recipient_id', userId)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(3);

    if (reverseTransactions && reverseTransactions.length >= 2) {
      return {
        triggered: true,
        details: { 
          rule: 'circular_transactions',
          reverse_count: reverseTransactions.length,
        },
      };
    }

    return { triggered: false, details: {} };
  }

  /**
   * Record a fraud rule match
   */
  private async recordMatch(params: {
    ruleId: string;
    userId: string;
    escrowId?: string;
    matchDetails: Record<string, any>;
    actionTaken: string;
  }): Promise<void> {
    await supabase.from('fraud_rule_matches').insert({
      rule_id: params.ruleId,
      user_id: params.userId,
      escrow_id: params.escrowId,
      match_details: params.matchDetails,
      action_taken: params.actionTaken,
    });

    // Update user risk profile
    await supabase.rpc('calculate_user_risk_score', { p_user_id: params.userId });

    // Create security alert for high severity matches
    const { data: rule } = await supabase
      .from('fraud_rules')
      .select('severity, rule_name')
      .eq('id', params.ruleId)
      .single();

    if (rule && ['high', 'critical'].includes(rule.severity)) {
      await supabase.from('security_alerts').insert({
        alert_type: 'suspicious_activity',
        severity: rule.severity,
        user_id: params.userId,
        escrow_id: params.escrowId,
        description: `Fraud rule triggered: ${rule.rule_name}`,
        evidence: params.matchDetails,
      });
    }
  }

  /**
   * Suspend user due to fraud
   */
  private async suspendUser(userId: string, reason: string): Promise<void> {
    await supabase
      .from('user_risk_profiles')
      .upsert({
        user_id: userId,
        risk_level: 'blocked',
        risk_score: 100,
        requires_manual_review: true,
      });

    await supabase.from('audit_logs').insert({
      action: 'user_suspended',
      user_id: userId,
      metadata: { reason, suspended_at: new Date().toISOString() },
    });
  }

  /**
   * Get user risk profile
   */
  async getUserRiskProfile(userId: string): Promise<{
    success: boolean;
    profile?: UserRiskProfile;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('user_risk_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = not found, which is OK
        return { success: false, error: error.message };
      }

      if (!data) {
        // Create default profile
        const defaultProfile: UserRiskProfile = {
          user_id: userId,
          risk_score: 0,
          risk_level: 'low',
          fraud_flags_count: 0,
          disputes_as_sender: 0,
          disputes_as_recipient: 0,
          disputes_lost: 0,
          identity_verified: false,
          phone_verified: false,
          email_verified: false,
          requires_manual_review: false,
        };
        return { success: true, profile: defaultProfile };
      }

      return { success: true, profile: data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Calculate user risk score
   */
  async calculateRiskScore(userId: string): Promise<{
    success: boolean;
    score?: number;
    level?: RiskLevel;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('calculate_user_risk_score', {
        p_user_id: userId,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      const score = parseFloat(data) || 0;
      const level: RiskLevel = 
        score >= 80 ? 'critical' :
        score >= 60 ? 'high' :
        score >= 40 ? 'medium' : 'low';

      return { success: true, score, level };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get fraud matches for review
   */
  async getUnreviewedMatches(limit = 50): Promise<{
    success: boolean;
    matches?: FraudMatch[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('fraud_rule_matches')
        .select(`
          *,
          rule:fraud_rules(rule_name, rule_code, severity),
          user:users(username, pi_id)
        `)
        .eq('reviewed', false)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        return { success: false, error: error.message };
      }

      const matches = data?.map((m: any) => ({
        ...m,
        rule_code: (m.rule as any)?.rule_code,
      }));

      return { success: true, matches };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Mark match as reviewed
   */
  async reviewMatch(
    matchId: string,
    reviewerId: string,
    isFalsePositive: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('fraud_rule_matches')
        .update({
          reviewed: true,
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
          false_positive: isFalsePositive,
        })
        .eq('id', matchId);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get reputation score for API
   */
  async getReputationScore(userId: string): Promise<{
    success: boolean;
    reputation?: {
      trust_score: number;
      completed_transactions: number;
      risk_level: RiskLevel;
      dispute_rate: number;
      account_age_days: number;
    };
    error?: string;
  }> {
    try {
      const { data: user } = await getUserById<{
        trust_score: number;
        completed_escrows: number;
        total_escrows: number;
        disputes: number;
        created_at: string;
      }>(userId, 'trust_score, completed_escrows, total_escrows, disputes, created_at');

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const { profile } = await this.getUserRiskProfile(userId);

      const accountAgeDays = Math.floor(
        (Date.now() - new Date(user.created_at).getTime()) / (24 * 60 * 60 * 1000)
      );

      const disputeRate = user.total_escrows > 0 
        ? (user.disputes / user.total_escrows) * 100 
        : 0;

      return {
        success: true,
        reputation: {
          trust_score: user.trust_score,
          completed_transactions: user.completed_escrows,
          risk_level: profile?.risk_level || 'low',
          dispute_rate: Math.round(disputeRate * 10) / 10,
          account_age_days: accountAgeDays,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export const fraudService = new FraudDetectionService();

