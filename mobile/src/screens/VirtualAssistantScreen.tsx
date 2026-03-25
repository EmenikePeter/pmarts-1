import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, HEADER_TITLE_TEXT } from '../lib/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'VirtualAssistant'>;
};

export default function VirtualAssistantScreen({ navigation }: Props) {
  const [messages, setMessages] = useState<Array<{ id: string; from: 'user'|'bot'; text: string }>>([
    { id: '1', from: 'bot', text: 'Hi — I am PMARTS Assistant. How can I help you today?' }
  ]);
  const [text, setText] = useState('');

  function send() {
    if (!text.trim()) return;
    const id = Math.random().toString(36).slice(2,9);
    const userMsg = { id: id+'u', from: 'user' as const, text };
    setMessages((s) => [...s, userMsg]);
    setText('');
    // simple canned reply
    setTimeout(() => {
      const bot = {
        id: Math.random().toString(36).slice(2,9)+'b',
        from: 'bot' as const,
        text: 'Thanks — our support team will review this and respond within 24 hours. For urgent issues use Telegram.'
      };
      setMessages((s) => [...s, bot]);
    }, 700);
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Virtual Assistant</Text>
        <View style={{ width: 36 }} />
      </View>
      <FlatList
        data={messages}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.from === 'user' ? styles.user : styles.bot]}>
            <Text style={styles.msg}>{item.text}</Text>
          </View>
        )}
        contentContainerStyle={{ padding: SPACING.md }}
      />

      <View style={styles.inputRow}>
        <TextInput value={text} onChangeText={setText} placeholder="Ask the assistant..." style={styles.input} />
        <TouchableOpacity style={styles.btn} onPress={send}><Text style={{color:'#fff'}}>Send</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  backButtonText: {
    color: COLORS.primary,
    fontSize: 22,
    fontWeight: '700',
  },
  headerTitle: {
    color: COLORS.primary,
    ...HEADER_TITLE_TEXT,
  },
  bubble: { padding: SPACING.sm, borderRadius: BORDER_RADIUS.md, marginVertical: SPACING.xs, maxWidth: '80%' },
  user: { backgroundColor: COLORS.primary, alignSelf: 'flex-end' },
  bot: { backgroundColor: COLORS.card, alignSelf: 'flex-start' },
  msg: { color: '#111' },
  inputRow: { flexDirection: 'row', padding: SPACING.sm, borderTopWidth:1, borderTopColor: COLORS.border },
  input: { flex: 1, backgroundColor: '#fff', padding: 10, borderRadius: BORDER_RADIUS.md, marginRight: SPACING.sm },
  btn: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md, justifyContent:'center', borderRadius: BORDER_RADIUS.md }
});
