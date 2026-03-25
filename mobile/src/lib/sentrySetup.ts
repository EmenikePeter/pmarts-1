import * as Sentry from '@sentry/react-native';
import { debugLog, debugWarn } from './debugLogger';

export function setupSentry(dsn?: string) {
  try {
    const SENTRY_DSN = dsn || process.env.EXPO_PUBLIC_SENTRY_DSN || '';
    if (SENTRY_DSN) {
      Sentry.init({
        dsn: SENTRY_DSN,
        enableNative: true,
        enableAutoSessionTracking: true,
        tracesSampleRate: 0.2,
        debug: __DEV__,
      });
      debugLog('[Sentry] initialized via setupSentry');
    } else {
      debugLog('[Sentry] no DSN; skipping setup');
    }
  } catch (e) {
    debugWarn('[Sentry] setup error', e);
  }

  // Catch uncaught JS errors (React Native global handler)
  try {
    // Preserve existing handler if present
    // @ts-ignore
    const defaultHandler = (ErrorUtils && (ErrorUtils.getGlobalHandler ? ErrorUtils.getGlobalHandler() : null)) || null;
    // @ts-ignore
    if (ErrorUtils && ErrorUtils.setGlobalHandler) {
      // @ts-ignore
      ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        try { Sentry.captureException(error); } catch (e) {}
        if (defaultHandler) try { defaultHandler(error, isFatal); } catch (e) {}
      });
    }
  } catch (e) {
    // ignore
  }

  // Catch unhandled promise rejections (web / some RN runtimes)
  try {
    const addHandler = (target: any) => {
      if (typeof target.addEventListener === 'function') {
        target.addEventListener('unhandledrejection', (event: any) => {
          try { Sentry.captureException(event?.reason || event); } catch (e) {}
        });
      }
    };

    if (typeof global !== 'undefined') addHandler(global as any);
    if (typeof window !== 'undefined') addHandler(window as any);
  } catch (e) {
    // ignore
  }
}

export default setupSentry;
