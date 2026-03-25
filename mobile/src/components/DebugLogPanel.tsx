import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import {
  DebugLogEntry,
  isDebugEnabled,
  subscribeDebugEntries,
} from '../lib/debugLogger';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';

type DebugLogPanelProps = {
  title?: string;
  maxHeight?: number;
};

export default function DebugLogPanel({
  title = 'Debug Logs',
  maxHeight = 220,
}: DebugLogPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);

  const enabled = useMemo(() => isDebugEnabled(), []);

  useEffect(() => {
    if (!enabled) return;
    return subscribeDebugEntries(setEntries);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setIsOpen(!isOpen)} style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.toggle}>{isOpen ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>

      {isOpen && (
        <ScrollView style={[styles.logContainer, { maxHeight }]}>
          {entries.length === 0 && (
            <Text style={styles.empty}>No logs yet</Text>
          )}
          {entries.map((entry) => (
            <View key={entry.id} style={styles.logRow}>
              <Text style={[styles.level, styles[entry.level]]}>{entry.level.toUpperCase()}</Text>
              <Text style={styles.message}>{entry.message}</Text>
              {entry.data !== undefined && (
                <Text style={styles.data}>{safeStringify(entry.data)}</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.primary,
  },
  title: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  toggle: {
    color: COLORS.secondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  logContainer: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  logRow: {
    marginBottom: SPACING.sm,
  },
  level: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  message: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
  },
  data: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  log: {
    color: COLORS.success,
  },
  warn: {
    color: COLORS.warning,
  },
  error: {
    color: COLORS.error,
  },
  empty: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
});
