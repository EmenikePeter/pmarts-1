import React from 'react';
import { StatusBar, LogBox, Platform, StyleSheet, Text, View } from 'react-native';
// Sentry for error and performance monitoring
import setupSentry from './src/lib/sentrySetup';
import * as Sentry from '@sentry/react-native';
import { debugWarn } from './src/lib/debugLogger';

// Initialize Sentry and global handlers
try {
  setupSentry();
} catch (e) {
  debugWarn('[Sentry] setupSentry error', e);
}
import Constants from 'expo-constants';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components';
import { PiAuthProvider, usePiAuth } from './src/context/PiAuthContext';
import ToastProvider from './src/components/Toast';
import SpeedInsightsWrapper from './src/components/SpeedInsightsWrapper';

const appTextDefaults = Text as unknown as {
  defaultProps?: {
    style?: import('react-native').StyleProp<import('react-native').TextStyle>;
  };
};

appTextDefaults.defaultProps = appTextDefaults.defaultProps || {};
appTextDefaults.defaultProps.style = [
  { color: '#000000', fontWeight: '500' },
  ...(Array.isArray(appTextDefaults.defaultProps.style)
    ? appTextDefaults.defaultProps.style
    : appTextDefaults.defaultProps.style
    ? [appTextDefaults.defaultProps.style]
    : []),
];

// Suppress non-critical warnings in production
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'VirtualizedLists should never be nested',
]);

export default Sentry.wrap(function App() {
  return (
    <ErrorBoundary>
      <StatusBar barStyle="light-content" backgroundColor="#1A3D7C" />
      <PiAuthProvider>
        <PiBrowserGate>
          <ToastProvider>
            <SpeedInsightsWrapper />
            <AppNavigator />
          </ToastProvider>
        </PiBrowserGate>
      </PiAuthProvider>
    </ErrorBoundary>
  );
});

function PiBrowserGate({ children }: { children: React.ReactNode }) {
  const { isInPiBrowser, isLoading } = usePiAuth();
  const allowNonPiWebEnv =
    Constants.expoConfig?.extra?.allowWebNonPi === true ||
    process.env.EXPO_PUBLIC_ALLOW_WEB_NON_PI === 'true';

  // Allowlist for specific hostnames (useful for prod domains and previews)
  let allowHost = false;
  try {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const hostname = (window.location.hostname || '').toLowerCase();
      const allowedHosts = ['pmarts.org', 'www.pmarts.org'];
      // Allow vercel preview hostnames (e.g. pmarts.vercel.app) for testing
      if (hostname.endsWith('.vercel.app')) {
        allowHost = true;
      } else if (hostname === 'localhost' || hostname === '127.0.0.1') {
        // allow local dev host
        allowHost = true;
      } else {
        allowHost = allowedHosts.includes(hostname);
      }
    }
  } catch (e) {
    // ignore
  }

  const allowNonPiWeb =
    allowNonPiWebEnv ||
    allowHost ||
    (typeof window !== 'undefined' && window.location?.search?.includes('debug=1')) ||
    process.env.NODE_ENV === 'development';

  if (Platform.OS !== 'web' || isLoading || isInPiBrowser || allowNonPiWeb) {
    return <>{children}</>;
  }

  return (
    <View style={styles.gateContainer}>
      <View style={styles.gateCard}>
        <Text style={styles.gateTitle}>Open in Pi Browser</Text>
        <Text style={styles.gateBody}>
          PMARTS runs as a Pi Network dApp. Please open this site inside the Pi Browser to
          sign in and make payments.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gateContainer: {
    flex: 1,
    backgroundColor: '#1A3D7C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  gateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    maxWidth: 420,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    boxShadow: '0 6px 10px rgba(0,0,0,0.12)',
  },
  gateTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  gateBody: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    textAlign: 'center',
  },
});
