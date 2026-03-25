import React from 'react';
import { View, Text, ActivityIndicator, Button, TouchableOpacity } from 'react-native';

export default function DepositPendingScreen({ route, navigation }: any) {
  const { escrowId, paymentAttemptId } = route.params || {};

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={{
          position: 'absolute',
          top: 18,
          left: 18,
          width: 40,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#1A3D7C', fontSize: 22, fontWeight: '700' }}>←</Text>
      </TouchableOpacity>
      <ActivityIndicator size="large" />
      <Text style={{ marginTop: 12, fontSize: 16 }}>Waiting for payment confirmation…</Text>
      <Text style={{ marginTop: 8, color: '#666' }}>Escrow: {escrowId || '—'}</Text>
      <View style={{ marginTop: 20, width: '100%' }}>
        <Button title="View Transaction" onPress={() => navigation.navigate('TransactionReceipt', { paymentAttemptId, escrowId })} />
      </View>
    </View>
  );
}
