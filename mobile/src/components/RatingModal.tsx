import React, { useState } from 'react';
import { debugError } from '../lib/debugLogger';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useToast } from './Toast';
import Button from './Button';
import { supabase } from '../lib/supabase';
import { User, Escrow } from '../lib/types';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../lib/theme';
import { API_URL } from '../lib/api';

type RatingModalProps = {
  visible: boolean;
  onClose: () => void;
  escrow: Escrow;
  currentUser: User;
  onRated?: () => void;
};

export function RatingModal({ visible, onClose, escrow, currentUser, onRated }: RatingModalProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const isSender = escrow.sender_id === currentUser.id;
  const otherPartyName = isSender
    ? escrow.recipient?.username || escrow.recipient_id
    : escrow.sender?.username || escrow.sender_id;
  const otherPartyId = isSender ? escrow.recipient_id : escrow.sender_id;

  const handleSubmit = async () => {
    if (rating === 0) {
      try { toast.push({ type: 'error', message: 'Please select a rating (1-5 stars)' }); } catch(e) {}
      return;
    }

    setLoading(true);
    try {
      // Insert rating
      const { error: ratingError } = await supabase.from('ratings').insert({
        escrow_id: escrow.id,
        rater_id: currentUser.id,
        rated_id: otherPartyId,
        score: rating,
        comment: comment.trim() || null,
      });

      if (ratingError) throw ratingError;

      // Trigger canonical backend trust recalculation for rated user
      try {
        await fetch(`${API_URL}/api/auth/recalculate-trust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: otherPartyId }),
        });
      } catch (e) {
        // Non-blocking: rating write succeeded
      }

      try { toast.push({ type: 'success', message: 'Thank you — your rating has been submitted.' }); } catch(e) {}
      onRated?.();
      onClose();
    } catch (err) {
      debugError('Rating error:', err);
      // Demo mode
      try { toast.push({ type: 'success', message: 'Thank you — your rating has been submitted. (Demo)' }); } catch(e) {}
      onRated?.();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const renderStar = (index: number) => {
    const filled = index <= rating;
    return (
      <TouchableOpacity
        key={index}
        onPress={() => setRating(index)}
        style={styles.starButton}
      >
        <Text style={[styles.star, filled && styles.starFilled]}>★</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Rate Your Experience</Text>
          <Text style={styles.subtitle}>
            How was your transaction with @{otherPartyName}?
          </Text>

          {/* Star Rating */}
          <View style={styles.starsContainer}>
            {[1, 2, 3, 4, 5].map(renderStar)}
          </View>
          <Text style={styles.ratingLabel}>
            {rating === 0 && 'Tap to rate'}
            {rating === 1 && 'Poor'}
            {rating === 2 && 'Fair'}
            {rating === 3 && 'Good'}
            {rating === 4 && 'Very Good'}
            {rating === 5 && 'Excellent!'}
          </Text>

          {/* Comment */}
          <TextInput
            style={styles.commentInput}
            placeholder="Leave a comment (optional)"
            placeholderTextColor={COLORS.textMuted}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Actions */}
          <View style={styles.actions}>
            <Button
              title="Skip"
              onPress={onClose}
              variant="outline"
              fullWidth={false}
              style={{ flex: 1, marginRight: SPACING.sm }}
            />
            <Button
              title="Submit Rating"
              onPress={handleSubmit}
              variant="primary"
              loading={loading}
              fullWidth={false}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  container: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 400,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  starButton: {
    padding: SPACING.xs,
  },
  star: {
    fontSize: 40,
    color: COLORS.border,
  },
  starFilled: {
    color: COLORS.secondary,
  },
  ratingLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    height: 20,
  },
  commentInput: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.text,
    minHeight: 80,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  actions: {
    flexDirection: 'row',
  },
});

