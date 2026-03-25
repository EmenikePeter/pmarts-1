/**
 * PMARTS Audit Service
 * Complete audit trail for regulatory compliance
 */

import { supabase } from './supabase';
import type { AuditLog } from '../types/database';
import { debugError } from './debugLogger';

export type AuditAction = 
  | 'escrow_created'
  | 'escrow_updated'
  | 'deposit_initiated'
  | 'deposit_confirmed'
  | 'delivery_confirmed'
  | 'funds_released'
  | 'funds_refunded'
  | 'escrow_cancelled'
  | 'escrow_disputed'
  | 'dispute_opened'
  | 'dispute_updated'
  | 'dispute_resolved'
  | 'evidence_uploaded'
  | 'rating_submitted'
  | 'user_login'
  | 'user_logout'
  | 'user_suspended'
  | 'user_unsuspended'
  | 'admin_action'
  | 'api_call'
  | 'fraud_flag_created'
  | 'fraud_flag_resolved'
  | 'settings_changed'
  | 'system_event';

export interface AuditOptions {
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  requestId?: string;
}

class AuditService {
  /**
   * Log an audit event
   */
  async log(
    action: AuditAction,
    actorId: string | null,
    options: {
      entityType?: string;
      entityId?: string;
      userId?: string;
      oldData?: Record<string, any>;
      newData?: Record<string, any>;
      metadata?: Record<string, any>;
      actorType?: 'user' | 'system' | 'api';
    } & AuditOptions = {}
  ): Promise<AuditLog | null> {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .insert({
          action,
          actor_id: actorId,
          actor_type: options.actorType || 'user',
          user_id: options.userId || actorId,
          entity_type: options.entityType,
          entity_id: options.entityId,
          old_data: options.oldData || null,
          new_data: options.newData || null,
          metadata: options.metadata || {},
          ip_address: options.ipAddress,
          user_agent: options.userAgent,
          session_id: options.sessionId,
          request_id: options.requestId,
        })
        .select()
        .single();

      if (error) {
        debugError('Audit log failed:', error);
        return null;
      }

      return data;
    } catch (err) {
      debugError('Audit log error:', err);
      return null;
    }
  }

  /**
   * Log system event (no user)
   */
  async logSystem(
    action: AuditAction,
    entityType: string,
    entityId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log(action, null, {
      entityType,
      entityId,
      metadata,
      actorType: 'system',
    });
  }

  /**
   * Log API call
   */
  async logApiCall(
    appId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    options?: AuditOptions
  ): Promise<void> {
    await this.log('api_call', null, {
      entityType: 'api',
      entityId: appId,
      metadata: {
        endpoint,
        method,
        status_code: statusCode,
      },
      actorType: 'api',
      ...options,
    });
  }

  /**
   * Get audit logs for an entity
   */
  async getEntityLogs(
    entityType: string,
    entityId: string,
    limit: number = 50
  ): Promise<AuditLog[]> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get audit logs for a user
   */
  async getUserLogs(
    userId: string,
    limit: number = 100
  ): Promise<AuditLog[]> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .or(`user_id.eq.${userId},actor_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Search audit logs
   */
  async searchLogs(
    filters: {
      action?: AuditAction;
      actorId?: string;
      entityType?: string;
      startDate?: Date;
      endDate?: Date;
      ipAddress?: string;
    },
    limit: number = 100
  ): Promise<AuditLog[]> {
    let query = supabase
      .from('audit_logs')
      .select('*');

    if (filters.action) {
      query = query.eq('action', filters.action);
    }
    if (filters.actorId) {
      query = query.eq('actor_id', filters.actorId);
    }
    if (filters.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }
    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate.toISOString());
    }
    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate.toISOString());
    }
    if (filters.ipAddress) {
      query = query.eq('ip_address', filters.ipAddress);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get escrow activity timeline
   */
  async getEscrowTimeline(escrowId: string): Promise<{
    timestamp: string;
    action: string;
    actor: string | null;
    details: string;
  }[]> {
    const logs = await this.getEntityLogs('escrow', escrowId, 100);

    return logs.map(log => ({
      timestamp: log.created_at,
      action: log.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      actor: log.actor_id,
      details: this.formatLogDetails(log),
    }));
  }

  /**
   * Get daily audit summary
   */
  async getDailySummary(date?: Date): Promise<{
    date: string;
    total_events: number;
    escrow_events: number;
    dispute_events: number;
    user_events: number;
    api_events: number;
    fraud_events: number;
  }> {
    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from('audit_logs')
      .select('action')
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString());

    if (error) throw error;

    const logs = data || [];
    
    return {
      date: startOfDay.toISOString().split('T')[0],
      total_events: logs.length,
        escrow_events: logs.filter((l: any) => l.action.includes('escrow') || l.action.includes('deposit') || l.action.includes('release') || l.action.includes('refund')).length,
        dispute_events: logs.filter((l: any) => l.action.includes('dispute') || l.action.includes('evidence')).length,
        user_events: logs.filter((l: any) => l.action.includes('user') || l.action.includes('login') || l.action.includes('logout')).length,
        api_events: logs.filter((l: any) => l.action === 'api_call').length,
        fraud_events: logs.filter((l: any) => l.action.includes('fraud')).length,
    };
  }

  /**
   * Export audit logs for compliance
   */
  async exportLogs(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const logs = await this.searchLogs({
      startDate,
      endDate,
    }, 10000);

    if (format === 'csv') {
      const headers = [
        'id', 'timestamp', 'action', 'actor_id', 'user_id', 
        'entity_type', 'entity_id', 'ip_address'
      ].join(',');

      const rows = logs.map(log => [
        log.id,
        log.created_at,
        log.action,
        log.actor_id || '',
        log.user_id || '',
        log.entity_type || '',
        log.entity_id || '',
        log.ip_address || '',
      ].join(','));

      return [headers, ...rows].join('\n');
    }

    return JSON.stringify(logs, null, 2);
  }

  /**
   * Helper to format log details
   */
  private formatLogDetails(log: AuditLog): string {
    const metadata = log.metadata || {};
    
    switch (log.action) {
      case 'escrow_created':
        return `Created escrow for ${metadata.amount} Pi`;
      case 'deposit_confirmed':
        return `Deposit confirmed, tx: ${metadata.tx_hash?.slice(0, 10)}...`;
      case 'funds_released':
        return `Released ${metadata.net_amount} Pi (fee: ${metadata.fee} Pi)`;
      case 'funds_refunded':
        return `Refunded ${metadata.amount} Pi: ${metadata.reason || 'No reason'}`;
      case 'dispute_opened':
        return `Dispute opened: ${metadata.reason || 'Unknown'}`;
      case 'dispute_resolved':
        return `Resolved: ${metadata.resolution}`;
      default:
        return JSON.stringify(metadata);
    }
  }
}

export const auditService = new AuditService();

