require("dotenv").config();
const express = require("express");
const cors = require("cors");
const logger = require('./lib/logger');

// Routes
const authRoutes = require("./routes/auth");
const escrowRoutes = require("./routes/escrow");
const escrowV2Routes = require("./routes/escrowV2");
const completionRoutes = require("./routes/completion");
const userRoutes = require("./routes/user");
const notificationRoutes = require("./routes/notifications");
const notificationPreferencesRoutes = require('./routes/notificationPreferences');
const paymentRoutes = require("./routes/payments");
const piRoutes = require('./routes/pi');
const publicConfigRoutes = require('./routes/publicConfig');
const disputesRoutes = require('./routes/disputes');
const uploadsRoutes = require('./routes/uploads');
const refundEvidenceRoutes = require('./routes/refundEvidence');
const disputeRoutes = require("./routes/disputes");
const transactionRoutes = require("./routes/transactions");

// Services
const adminRoutes = require("./routes/admin");
const supportRoutes = require("./routes/support");
const messagesRoutes = require('./routes/messages');
const legalRoutes = require('./routes/legal');

const app = express();
const port = process.env.PORT || 4000;

// Global CORS safety middleware: ensure responses include CORS headers
// even if other middleware or error handlers run earlier. This helps when
// platform wrappers or serverless adapters short-circuit the request.
app.use((req, res, next) => {
  try {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    // Allow credentials if needed in future (not enabled now)
    // res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  } catch (e) {
    // best-effort; continue to next middleware
  }
  next();
});

// Enable CORS and reflect request origin (useful for preview URLs and localhost)
app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (curl, server-to-server)
      if (!origin) return callback(null, true);
      // For development and preview environments we allow the origin
      return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Ensure OPTIONS preflight returns CORS headers
app.options('*', cors());
app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.REQUEST_BODY_LIMIT || '10mb' }));

// Print Supabase URL at startup to verify which project the runtime uses
const supabaseClient = require('./lib/supabase');


app.get("/", (req, res) => {
  res.json({ 
    status: "PMARTS API running", 
    version: "2.1.0",
    features: [
      "escrow_wallet",
      "fraud_detection",
      "dispute_resolution",
      "auto_expiry",
      "multi_completion_methods",
      "delivery_code",
      "receipt_evidence"
    ]
  });
});

// Authentication routes
app.use("/api/auth", authRoutes);

// Legacy escrow routes (v1)
app.use("/api/escrow", escrowRoutes);

// Enhanced escrow routes (v2) with fraud detection & wallet
app.use("/api/escrow/v2", escrowV2Routes);

// Completion methods (delivery code, service approval, etc.)
app.use("/api/completion", completionRoutes);

app.use("/api/user", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.use('/api/notification-preferences', notificationPreferencesRoutes);
app.use("/api/payments", paymentRoutes);
app.use('/api/pi', piRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/admin", adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/legal', legalRoutes);

// Public runtime config (safe values intended for client-side use)
app.use('/api/public-config', publicConfigRoutes);
app.use('/api/disputes', disputesRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/refund-evidence', refundEvidenceRoutes);

// Graceful body size error handling
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    logger.warn('[request] payload too large', {
      path: req.originalUrl,
      method: req.method,
      limit: process.env.REQUEST_BODY_LIMIT || '10mb',
      ip: req.ip || null,
    });
    return res.status(413).json({
      success: false,
      error: 'Request payload too large',
      code: 'PAYLOAD_TOO_LARGE',
      limit: process.env.REQUEST_BODY_LIMIT || '10mb',
    });
  }
  return next(err);
});

app.listen(port, () => {
  logger.info('PMARTS API v2.1.0 listening on %s', port);
  logger.info('Features: Escrow Wallet, Fraud Detection, Dispute Resolution, Multi-Completion Methods');
  // Startup environment verification
  try {
    logger.info('[startup] SUPABASE_URL %s', process.env.SUPABASE_URL || '(not-set)');
  } catch (e) {
    logger.warn('[startup] Failed to read SUPABASE_URL %o', e?.message || e);
  }

  (async () => {
    try {
      // Best-effort: check if audit_logs table is accessible
      const { data, error } = await supabaseClient.from('audit_logs').select('id').limit(1);
      if (error) {
        logger.warn('[startup] audit_logs check error (non-fatal) %o', error?.message || error);
      } else {
        logger.info('[startup] audit_logs accessible, rows: %d', (data && data.length) || 0);
      }
      // Additional diagnostic: log masked service-role key prefix so we can verify runtime env
      try {
        const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        const prefix = svcKey ? svcKey.slice(0, 24) + '...' : '(not-set)';
        logger.info('[startup] SUPABASE_SERVICE_ROLE_KEY prefix %s', prefix);

        // Best-effort RPC health check: call the audit RPC (wrapped in try/catch so it is non-fatal)
        try {
          const rpcPayload = { p_action: 'health_check', p_entity_type: 'server_startup', p_metadata: { env: process.env.NODE_ENV || 'unknown' } };
          const { data: rpcData, error: rpcErr } = await supabaseClient.rpc('fn_insert_audit_log', rpcPayload);
          if (rpcErr) {
            logger.warn('[startup] supabase RPC health_check error (non-fatal) %o', rpcErr?.message || rpcErr);
          } else {
            logger.info('[startup] supabase RPC health_check succeeded %o', rpcData || '(no data)');
          }
        } catch (rpcEx) {
          logger.warn('[startup] supabase RPC health_check exception (non-fatal) %o', rpcEx?.message || rpcEx);
        }
      } catch (keyEx) {
        logger.warn('[startup] failed to read SUPABASE_SERVICE_ROLE_KEY for diagnostics %o', keyEx?.message || keyEx);
      }
    } catch (err) {
      logger.warn('[startup] audit_logs check exception (non-fatal) %o', err?.message || err);
    }

      // Pi API diagnostics: ensure PI config is visible at startup
      try {
        const piEnv = process.env.PI_ENV || 'testnet';
        const piTestUrl = process.env.PI_TESTNET_API_URL || '';
        const piMainUrl = process.env.PI_MAINNET_API_URL || '';
        const piTestKey = process.env.PI_TESTNET_API_KEY || '';
        const piMainKey = process.env.PI_MAINNET_API_KEY || '';

        logger.info('[startup] PI_ENV %s', piEnv);
        logger.info('[startup] PI_TESTNET_API_URL %s', piTestUrl || '(not-set)');
        logger.info('[startup] PI_MAINNET_API_URL %s', piMainUrl || '(not-set)');

        if (!piTestUrl && !piMainUrl) {
          logger.warn('[startup] No PI API base URLs configured (PI_TESTNET_API_URL / PI_MAINNET_API_URL)');
        }
        if (!piTestKey && !piMainKey) {
          logger.warn('[startup] No PI API keys configured (PI_TESTNET_API_KEY / PI_MAINNET_API_KEY)');
        }
        // In production, fail fast if PI config is missing to avoid obscure runtime errors
        try {
          if ((process.env.NODE_ENV === 'production')) {
              const missingUrls = !piTestUrl && !piMainUrl;
              const missingKeys = !piTestKey && !piMainKey;
              if (missingUrls || missingKeys) {
                logger.error('[startup] PI configuration incomplete - missingUrls=%s missingKeys=%s', missingUrls, missingKeys);
                logger.error('[startup] Required environment variables: PI_TESTNET_API_URL, PI_MAINNET_API_URL, PI_TESTNET_API_KEY, PI_MAINNET_API_KEY');
                // Historically we exited here to fail fast in production, but that
                // can cause the deployment to return 500/failed fetch for clients
                // when envs are missing. Make this opt-in via FAIL_ON_MISSING_PI
                // so deployments won't hard-fail unless explicitly requested.
                if (process.env.FAIL_ON_MISSING_PI === 'true') {
                  logger.error('[startup] FAIL_ON_MISSING_PI=true; exiting process due to missing PI config');
                  process.exit(1);
                } else {
                  logger.warn('[startup] Missing PI config but FAIL_ON_MISSING_PI not set; continuing startup');
                }
              }
            }
        } catch (guardEx) {
          logger.warn('[startup] PI config guard check failed %o', guardEx?.message || guardEx);
        }
      } catch (piEx) {
        logger.warn('[startup] PI config diagnostic failed %o', piEx?.message || piEx);
      }
  })();
});
