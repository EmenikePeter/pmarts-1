import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

export type MobileToast = { id: string; type?: 'info' | 'success' | 'error' | 'warn'; message: string };

const ToastContext = createContext<{ push: (t: Omit<MobileToast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<MobileToast[]>([]);

  const push = useCallback((t: Omit<MobileToast, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 9);
    const toast = { id, ...t } as MobileToast;
    setToasts((s) => [...s, toast]);
    setTimeout(() => {
      setToasts((s) => s.filter((x) => x.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <View style={[styles.container, { pointerEvents: 'box-none' }]}>
        {toasts.map((t) => (
          <View key={t.id} style={[styles.toast, t.type === 'success' ? styles.success : t.type === 'error' ? styles.error : styles.info]}>
            <Text style={styles.text}>{t.message}</Text>
          </View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 40,
    zIndex: 1000,
  },
  toast: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 8,
    elevation: 4,
    boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
  },
  text: {
    color: '#ffffff',
  },
  success: { backgroundColor: '#10B981' },
  error: { backgroundColor: '#EF4444' },
  info: { backgroundColor: '#374151' },
});

export default ToastProvider;
