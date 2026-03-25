import React from 'react';
import { Text, TouchableOpacity, Linking, Platform, StyleSheet } from 'react-native';
import { debugWarn } from '../src/lib/debugLogger';

export function ExternalLink({ href, children, style }: { href: string; children?: React.ReactNode; style?: any }) {
  const open = async () => {
    try {
      if (Platform.OS === 'web') {
        window.open(href, '_blank');
      } else {
        const supported = await Linking.canOpenURL(href);
        if (supported) await Linking.openURL(href);
      }
    } catch (e) {
      debugWarn('Failed to open external link', { href, error: e });
    }
  };

  return (
    <TouchableOpacity onPress={open}>
      <Text style={[styles.link, style]}>{children ?? href}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  link: { color: '#2563EB', textDecorationLine: 'underline' },
});

