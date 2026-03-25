/**
 * PMARTS Transaction Type Selector
 *
 * Allows user to select the type of transaction when creating escrow.
 * Each type has its own completion method.
 *
 * Transaction Types:
 * - Physical Product → Delivery Code
 * - Digital Product → Sender Release
 * - Service → Service Approval
 * - Trade Agreement → Receipt Evidence
 * - Other → Sender Release
 *
 * @module TransactionTypeSelector
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';

// ============================================
// TYPES
// ============================================

export type TransactionType =
  | 'physical_product'
  | 'digital_product'
  | 'service'
  | 'currency_exchange'
  | 'instant'
  | 'donation'
  | 'custom'
  | 'other';

interface TransactionTypeOption {
  type: TransactionType;
  label: string;
  description: string;
  icon: string;
  completionMethod: string;
}

interface TransactionTypeSelectorProps {
  value?: TransactionType;
  onChange: (type: TransactionType) => void;
  disabled?: boolean;
}

// ============================================
// TRANSACTION TYPE OPTIONS
// ============================================

const TRANSACTION_TYPES: TransactionTypeOption[] = [
  {
    type: 'physical_product',
    label: 'Physical Product',
    description: 'Items with delivery (phone, clothes, etc.)',
    icon: '📦',
    completionMethod: 'Delivery Code',
  },
  {
    type: 'instant',
    label: 'Instant Transfer',
    description: 'Instant handoff (quick pickup or direct delivery)',
    icon: '⚡',
    completionMethod: 'Auto Release',
  },
  {
    type: 'digital_product',
    label: 'Digital Product',
    description: 'Digital goods (software, game assets, domains)',
    icon: '💾',
    completionMethod: 'Manual Release',
  },
  {
    type: 'service',
    label: 'Service',
    description: 'Freelance, tutoring, consulting',
    icon: '🛠️',
    completionMethod: 'Service Approval',
  },
  {
    type: 'donation',
    label: 'Donation',
    description: 'Support or tip with no dispute required',
    icon: '🙏',
    completionMethod: 'Auto Release',
  },
  {
    type: 'currency_exchange',
    label: 'Trade Agreement',
    description: 'External Payment Arrangement (outside platform)',
    icon: '💱',
    completionMethod: 'Receipt Evidence',
  },
  {
    type: 'custom',
    label: 'Custom Agreement',
    description: 'Flexible terms defined by both parties',
    icon: '🧩',
    completionMethod: 'Manual Release',
  },
  {
    type: 'other',
    label: 'Other',
    description: 'Custom agreements',
    icon: '📝',
    completionMethod: 'Manual Release',
  },
];

// ============================================
// COMPONENT
// ============================================

export function TransactionTypeSelector({
  value,
  onChange,
  disabled = false,
}: TransactionTypeSelectorProps) {
  const [selectedType, setSelectedType] = useState<TransactionType | undefined>(value);

  const handleSelect = (type: TransactionType) => {
    if (disabled) return;
    setSelectedType(type);
    onChange(type);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Transaction Type</Text>
      <Text style={styles.subtitle}>
        Choose the type that best describes your transaction
      </Text>

      <ScrollView
        style={styles.optionsContainer}
        showsVerticalScrollIndicator={false}
      >
        {TRANSACTION_TYPES.map((option) => (
          <TouchableOpacity
            key={option.type}
            style={[
              styles.option,
              selectedType === option.type && styles.optionSelected,
              disabled && styles.optionDisabled,
            ]}
            onPress={() => handleSelect(option.type)}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <View style={styles.optionHeader}>
              <Text style={styles.optionIcon}>{option.icon}</Text>
              <View style={styles.optionTextContainer}>
                <Text
                  style={[
                    styles.optionLabel,
                    selectedType === option.type && styles.optionLabelSelected,
                  ]}
                >
                  {option.label}
                </Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </View>
              {selectedType === option.type && (
                <View style={styles.checkmark}>
                  <Text style={styles.checkmarkText}>✓</Text>
                </View>
              )}
            </View>

            {/* Completion method badge */}
            <View style={styles.completionBadge}>
              <Text style={styles.completionBadgeText}>
                Completion: {option.completionMethod}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
  },
  optionsContainer: {
    flex: 1,
  },
  option: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#E5E5E5',
  },
  optionSelected: {
    borderColor: '#E8A838',
    backgroundColor: '#FFF9F0',
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  optionIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  optionLabelSelected: {
    color: '#E8A838',
  },
  optionDescription: {
    fontSize: 13,
    color: '#666666',
    lineHeight: 18,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E8A838',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  completionBadge: {
    marginTop: 12,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  completionBadgeText: {
    fontSize: 12,
    color: '#888888',
  },
});

export default TransactionTypeSelector;

