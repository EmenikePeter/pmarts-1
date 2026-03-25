import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { debugWarn } from '../lib/debugLogger';

export default function SpeedInsightsWrapper(): React.ReactElement | null {
  const [Cmp, setCmp] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (process.env.NODE_ENV !== 'production') return;

    let mounted = true;
    import('@vercel/speed-insights/react')
      .then((mod) => {
        if (mounted && mod && (mod as any).SpeedInsights) {
          setCmp(() => (mod as any).SpeedInsights as React.ComponentType);
        }
      })
      .catch((err) => {
        // Non-fatal: package may not be installed yet (safe fallback)
        // eslint-disable-next-line no-console
        debugWarn('[SpeedInsights] failed to load', err);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!Cmp) return null;
  return <Cmp />;
}
