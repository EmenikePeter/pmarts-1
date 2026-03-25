// Ensure Pi SDK posts messages to our dev origin when running locally.
// This must run before the Pi SDK script loads in the page.
try {
  if (typeof window !== 'undefined') {
    if (process.env.NODE_ENV === 'development' || (window.location && window.location.search && window.location.search.includes('debug=1'))) {
      // Set a well-known global the Pi SDK checks for to override target origin
      window.__PI_SDK_TARGET_ORIGIN__ = window.location.origin;
      try {
        const { debugLog } = require('./src/lib/debugLogger');
        debugLog('[bootstrap] Set __PI_SDK_TARGET_ORIGIN__ to', window.location.origin);
      } catch (e) {
        // fallback
        // eslint-disable-next-line no-console
        console.debug('[bootstrap] Set __PI_SDK_TARGET_ORIGIN__ to', window.location.origin);
      }
    }
  }
} catch (e) {
  // ignore
}

// Dev-only: tolerate Pi SDK postMessage target mismatches by rewriting targetOrigin
try {
  if (typeof window !== 'undefined' && (process.env.NODE_ENV === 'development' || (window.location && window.location.search && window.location.search.includes('debug=1')))) {
    const origPost = window.postMessage.bind(window);
    window.postMessage = function (message, targetOrigin, transfer) {
      try {
        // If SDK tries to post to Pi CDN origin while running locally, rewrite to our origin
        if (typeof targetOrigin === 'string' && targetOrigin.includes('app-cdn.minepi.com')) {
          try {
            const { debugLog } = require('./src/lib/debugLogger');
            debugLog('[bootstrap] Rewriting postMessage targetOrigin', { from: targetOrigin, to: window.location.origin });
          } catch (e) {
            // fallback
            // eslint-disable-next-line no-console
            console.debug('[bootstrap] Rewriting postMessage targetOrigin', targetOrigin, '->', window.location.origin);
          }
          targetOrigin = window.location.origin;
        }
      } catch (e) {
        // ignore
      }
      // Call original
      return origPost(message, targetOrigin, transfer);
    };
  }
} catch (e) {
  // ignore
}

import { registerRootComponent } from 'expo';
import { LogBox, Platform } from 'react-native';

// Global error handler for uncaught errors (helps debug production crashes)
if (!__DEV__) {
  // Override console.error to prevent crashes from uncaught promises
  const originalConsoleError = console.error;
  console.error = (...args) => {
    // Log but don't crash
    originalConsoleError.apply(console, args);
  };
  
  // Handle unhandled promise rejections
  if (Platform.OS !== 'web') {
    const RNPromise = global.Promise;
    global.Promise = class extends RNPromise {
      constructor(executor) {
        super((resolve, reject) => {
          executor(resolve, (error) => {
            try {
              const { debugWarn } = require('./src/lib/debugLogger');
              debugWarn('Unhandled Promise rejection:', error);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('Unhandled Promise rejection:', error);
            }
            reject(error);
          });
        });
      }
    };
  }
}

import App from './App';

registerRootComponent(App);

