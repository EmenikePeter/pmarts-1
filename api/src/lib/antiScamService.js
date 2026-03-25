const logger = require('./logger');

/**
 * PMARTS Anti-Scam Service
 * 
 * 5 Real Fintech Anti-Scam Systems:
 * 1. Velocity Check - Detect rapid transaction patterns
 * 2. Device Fingerprinting - Track suspicious device changes
 * 3. Behavioral Analysis - Unusual user behavior patterns
 * 4. Network Analysis - Linked account detection
 * 5. Risk Scoring Engine - Real-time fraud probability
 * 
 * Used by real escrow platforms to prevent:
 * - Deposit-then-cancel attacks
 * - Fake dispute claims
 * - Account takeovers
 * - Money mule operations
 */

const supabase = require('./supabase');
const { getUserById } = require('./userResolver');

/**
 * Risk level thresholds
 */
const RISK_LEVELS = {
  LOW: { min: 0, max: 30, action: 'allow' },
  MEDIUM: { min: 31, max: 60, action: 'review' },
  HIGH: { min: 61, max: 80, action: 'delay' },
  CRITICAL: { min: 81, max: 100, action: 'block' },
};

/**
 * Fraud flag types
 */
const FLAG_TYPES = {
  VELOCITY_EXCEEDED: 'velocity_exceeded',
  SUSPICIOUS_PATTERN: 'suspicious_pattern',
  LINKED_FRAUD_ACCOUNT: 'linked_fraud_account',
  DEVICE_MISMATCH: 'device_mismatch',
  BEHAVIORAL_ANOMALY: 'behavioral_anomaly',
  DISPUTE_ABUSE: 'dispute_abuse',
  NEW_ACCOUNT_HIGH_VALUE: 'new_account_high_value',
  RAPID_ESCROW_CREATION: 'rapid_escrow_creation',
  SELF_TRANSACTION: 'self_transaction',
};

// ============================================
// SYSTEM 1: VELOCITY CHECKS
// ============================================

/**
 * Check transaction velocity (speed/frequency of transactions)
 * Prevents rapid-fire transactions used in fraud attacks
 * 
 * @param {string} userId - User ID
 * @param {number} amount - Transaction amount
 * @returns {Promise<Object>} Velocity check result
 */
async function checkVelocity(userId, amount) {
  const result = { passed: true, flags: [], riskScore: 0 };

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Check hourly transaction count
    const { count: hourlyCount } = await supabase
      .from('escrows')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', userId)
      .gte('created_at', oneHourAgo.toISOString());

    // Check daily transaction count
    const { count: dailyCount } = await supabase
      .from('escrows')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', userId)
      .gte('created_at', oneDayAgo.toISOString());

    // Check daily volume
    const { data: dailyTransactions } = await supabase
      .from('escrows')
      .select('amount')
      .eq('sender_id', userId)
      .gte('created_at', oneDayAgo.toISOString());

    const dailyVolume = dailyTransactions?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0;

    // Velocity limits
    const HOURLY_LIMIT = 5;
    const DAILY_LIMIT = 20;
    const DAILY_VOLUME_LIMIT = 1000; // Pi

    if (hourlyCount >= HOURLY_LIMIT) {
      result.flags.push({
        type: FLAG_TYPES.VELOCITY_EXCEEDED,
        message: `Hourly limit exceeded: ${hourlyCount}/${HOURLY_LIMIT}`,
        severity: 'high',
      });
      result.riskScore += 30;
    }

    if (dailyCount >= DAILY_LIMIT) {
      result.flags.push({
        type: FLAG_TYPES.VELOCITY_EXCEEDED,
        message: `Daily limit exceeded: ${dailyCount}/${DAILY_LIMIT}`,
        severity: 'critical',
      });
      result.riskScore += 40;
    }

    if (dailyVolume + amount > DAILY_VOLUME_LIMIT) {
      result.flags.push({
        type: FLAG_TYPES.VELOCITY_EXCEEDED,
        message: `Daily volume limit: ${dailyVolume + amount}/${DAILY_VOLUME_LIMIT} Pi`,
        severity: 'high',
      });
      result.riskScore += 25;
    }

    result.passed = result.riskScore < RISK_LEVELS.HIGH.min;

  } catch (error) {
    logger.error('Velocity check error:', error);
    // Fail open with medium risk
    result.riskScore = 20;
  }

  return result;
}

// ============================================
// SYSTEM 2: DEVICE FINGERPRINTING
// ============================================

/**
 * Check device consistency
 * Detects account takeover attempts
 * 
 * @param {string} userId - User ID
 * @param {Object} deviceInfo - Current device information
 * @returns {Promise<Object>} Device check result
 */
async function checkDeviceConsistency(userId, deviceInfo = {}) {
  const result = { passed: true, flags: [], riskScore: 0 };

  try {
    // Get user's known devices
    const { data: user } = await getUserById(userId, 'known_devices, last_login_device, device_change_count');

    if (!user) {
      return result; // New user, no history
    }

    const knownDevices = user.known_devices || [];
    const currentFingerprint = generateDeviceFingerprint(deviceInfo);

    // Check if device is known
    const isKnownDevice = knownDevices.some(d => d.fingerprint === currentFingerprint);

    if (!isKnownDevice && knownDevices.length > 0) {
      result.flags.push({
        type: FLAG_TYPES.DEVICE_MISMATCH,
        message: 'New device detected',
        severity: 'medium',
      });
      result.riskScore += 15;

      // Check rapid device changes (suspicious)
      if (user.device_change_count > 3) {
        result.flags.push({
          type: FLAG_TYPES.DEVICE_MISMATCH,
          message: `Frequent device changes: ${user.device_change_count}`,
          severity: 'high',
        });
        result.riskScore += 25;
      }
    }

    result.passed = result.riskScore < RISK_LEVELS.HIGH.min;

  } catch (error) {
    logger.error('Device check error:', error);
  }

  return result;
}

/**
 * Generate device fingerprint
 */
function generateDeviceFingerprint(deviceInfo) {
  const { platform, version, userAgent, screenSize } = deviceInfo;
  const data = `${platform || 'unknown'}-${version || 'unknown'}-${screenSize || 'unknown'}`;
  return Buffer.from(data).toString('base64');
}

// ============================================
// SYSTEM 3: BEHAVIORAL ANALYSIS
// ============================================

/**
 * Analyze user behavior for anomalies
 * Detects patterns inconsistent with user history
 * 
 * @param {string} userId - User ID
 * @param {Object} action - Current action details
 * @returns {Promise<Object>} Behavioral analysis result
 */
async function analyzeBehavior(userId, action) {
  const result = { passed: true, flags: [], riskScore: 0 };

  try {
    // Get user profile and history
    const { data: user } = await getUserById(userId);

    if (!user) return result;

    // Get transaction history
    const { data: history } = await supabase
      .from('escrows')
      .select('amount, created_at')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    const avgAmount = history?.length > 0
      ? history.reduce((sum, t) => sum + t.amount, 0) / history.length
      : 0;

    // Check: Amount significantly higher than average
    if (action.amount && avgAmount > 0 && action.amount > avgAmount * 3) {
      result.flags.push({
        type: FLAG_TYPES.BEHAVIORAL_ANOMALY,
        message: `Amount ${action.amount} is 3x+ average (${avgAmount.toFixed(2)})`,
        severity: 'medium',
      });
      result.riskScore += 15;
    }

    // Check: New account making high-value transaction
    const accountAgeDays = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < 7 && action.amount > 50) {
      result.flags.push({
        type: FLAG_TYPES.NEW_ACCOUNT_HIGH_VALUE,
        message: `New account (${accountAgeDays.toFixed(1)} days) attempting ${action.amount} Pi`,
        severity: 'high',
      });
      result.riskScore += 25;
    }

    // Check: User has high dispute ratio
    const disputeRatio = user.disputes_opened / Math.max(1, user.completed_transactions);
    if (disputeRatio > 0.3 && user.completed_transactions > 3) {
      result.flags.push({
        type: FLAG_TYPES.DISPUTE_ABUSE,
        message: `High dispute ratio: ${(disputeRatio * 100).toFixed(1)}%`,
        severity: 'high',
      });
      result.riskScore += 30;
    }

    result.passed = result.riskScore < RISK_LEVELS.HIGH.min;

  } catch (error) {
    logger.error('Behavioral analysis error:', error);
  }

  return result;
}

// ============================================
// SYSTEM 4: NETWORK ANALYSIS
// ============================================

/**
 * Detect linked fraud accounts
 * Prevents money mule networks
 * 
 * @param {string} senderId - Sender ID
 * @param {string} recipientId - Recipient ID
 * @returns {Promise<Object>} Network analysis result
 */
async function analyzeNetwork(senderId, recipientId) {
  const result = { passed: true, flags: [], riskScore: 0 };

  try {
    // Check: Self-transaction
    if (senderId === recipientId) {
      result.flags.push({
        type: FLAG_TYPES.SELF_TRANSACTION,
        message: 'Self-transaction detected',
        severity: 'critical',
      });
      result.riskScore += 50;
      result.passed = false;
      return result;
    }

    // Check: Recipient has fraud flags
    const { data: recipientFlags } = await supabase
      .from('fraud_flags')
      .select('*')
      .eq('user_id', recipientId)
      .eq('resolved', false);

    if (recipientFlags?.length > 0) {
      result.flags.push({
        type: FLAG_TYPES.LINKED_FRAUD_ACCOUNT,
        message: `Recipient has ${recipientFlags.length} active fraud flag(s)`,
        severity: 'critical',
      });
      result.riskScore += 40;
    }

    // Check: Circular transaction pattern (A→B→A)
    const { data: reverseTransactions } = await supabase
      .from('escrows')
      .select('*')
      .eq('sender_id', recipientId)
      .eq('recipient_id', senderId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (reverseTransactions?.length > 0) {
      result.flags.push({
        type: FLAG_TYPES.SUSPICIOUS_PATTERN,
        message: 'Circular transaction pattern detected',
        severity: 'high',
      });
      result.riskScore += 30;
    }

    result.passed = result.riskScore < RISK_LEVELS.HIGH.min;

  } catch (error) {
    logger.error('Network analysis error:', error);
  }

  return result;
}

// ============================================
// SYSTEM 5: RISK SCORING ENGINE
// ============================================

/**
 * Calculate comprehensive risk score
 * Combines all fraud signals into action recommendation
 * 
 * @param {Object} params - Transaction parameters
 * @returns {Promise<Object>} Risk assessment result
 */
async function calculateRiskScore(params) {
  const { senderId, recipientId, amount, deviceInfo = {} } = params;

  const results = {
    velocity: await checkVelocity(senderId, amount),
    device: await checkDeviceConsistency(senderId, deviceInfo),
    behavior: await analyzeBehavior(senderId, { amount }),
    network: await analyzeNetwork(senderId, recipientId),
  };

  // Aggregate scores
  let totalRiskScore = 0;
  const allFlags = [];

  for (const [check, result] of Object.entries(results)) {
    totalRiskScore += result.riskScore;
    allFlags.push(...result.flags.map(f => ({ ...f, check })));
  }

  // Cap at 100
  totalRiskScore = Math.min(100, totalRiskScore);

  // Determine risk level and action
  let riskLevel = 'LOW';
  let action = 'allow';

  for (const [level, config] of Object.entries(RISK_LEVELS)) {
    if (totalRiskScore >= config.min && totalRiskScore <= config.max) {
      riskLevel = level;
      action = config.action;
      break;
    }
  }

  // Record fraud assessment
  if (totalRiskScore > 30 || allFlags.length > 0) {
    await recordFraudAssessment(params, { totalRiskScore, riskLevel, allFlags });
  }

  return {
    riskScore: totalRiskScore,
    riskLevel,
    action,
    flags: allFlags,
    checks: {
      velocity: results.velocity.passed,
      device: results.device.passed,
      behavior: results.behavior.passed,
      network: results.network.passed,
    },
  };
}

/**
 * Record fraud assessment for audit
 */
async function recordFraudAssessment(params, assessment) {
  try {
    await supabase
      .from('fraud_assessments')
      .insert({
        user_id: params.senderId,
        transaction_type: 'escrow_create',
        amount: params.amount,
        risk_score: assessment.totalRiskScore,
        risk_level: assessment.riskLevel,
        flags: assessment.allFlags,
        action_taken: assessment.riskLevel === 'CRITICAL' ? 'blocked' : 'logged',
      });
  } catch (error) {
    logger.error('Failed to record fraud assessment:', error);
  }
}

/**
 * Create fraud flag for user
 */
async function createFraudFlag(userId, flagType, reason, severity = 'high') {
  try {
    await supabase
      .from('fraud_flags')
      .insert({
        user_id: userId,
        flag_type: flagType,
        reason,
        severity,
        resolved: false,
      });

    logger.info(`Fraud flag created: ${userId} - ${flagType}`);
  } catch (error) {
    logger.error('Failed to create fraud flag:', error);
  }
}

/**
 * Run pre-transaction fraud check
 * Main entry point for escrow creation checks
 */
async function preTransactionCheck(params) {
  const riskAssessment = await calculateRiskScore(params);

  return {
    approved: riskAssessment.action !== 'block',
    requiresReview: riskAssessment.action === 'review',
    delayMinutes: riskAssessment.action === 'delay' ? 30 : 0,
    ...riskAssessment,
  };
}

module.exports = {
  checkVelocity,
  checkDeviceConsistency,
  analyzeBehavior,
  analyzeNetwork,
  calculateRiskScore,
  preTransactionCheck,
  createFraudFlag,
  FLAG_TYPES,
  RISK_LEVELS,
};

