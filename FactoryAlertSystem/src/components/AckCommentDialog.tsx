/**
 * Factory Alert System - Ack Comment Dialog (doc 27 MB6)
 *
 * Shown when acknowledging an alert from the detail screen: quick-reason
 * chips + optional free text. The comment is stored locally on the alert
 * and synced to the server (acknowledge-v2 → ackComment column).
 */

import React, { useCallback, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../context';
import { TRANSLATIONS } from '../utils/constants';
import { Language } from '../types';

export interface AckCommentDialogProps {
  visible: boolean;
  language: Language;
  onConfirm: (comment?: string) => void;
  onCancel: () => void;
}

const AckCommentDialog: React.FC<AckCommentDialogProps> = ({ visible, language, onConfirm, onCancel }) => {
  const { theme } = useTheme();
  const t = TRANSLATIONS[language];

  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');

  const quickReasons: Array<{ key: string; label: string }> = [
    { key: 'false_alarm', label: t.ackReasonFalseAlarm },
    { key: 'known_issue', label: t.ackReasonKnownIssue },
    { key: 'investigating', label: t.ackReasonInvestigating },
    { key: 'fixed_on_site', label: t.ackReasonFixedOnSite },
  ];

  const reset = useCallback(() => {
    setSelectedReason(null);
    setFreeText('');
  }, []);

  const buildComment = useCallback((): string | undefined => {
    const reasonLabel = quickReasons.find((r) => r.key === selectedReason)?.label;
    const parts = [reasonLabel, freeText.trim()].filter(Boolean);
    return parts.length > 0 ? parts.join(' — ') : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReason, freeText, language]);

  const handleConfirm = useCallback(() => {
    onConfirm(buildComment());
    reset();
  }, [onConfirm, buildComment, reset]);

  const handleCancel = useCallback(() => {
    onCancel();
    reset();
  }, [onCancel, reset]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.headerRow}>
            <Icon name="check-decagram" size={22} color={theme.colors.primary} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{t.ackCommentTitle}</Text>
          </View>

          {/* Quick-reason chips */}
          <View style={styles.chipsWrap}>
            {quickReasons.map((reason) => {
              const active = selectedReason === reason.key;
              return (
                <TouchableOpacity
                  key={reason.key}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primary : 'transparent',
                    },
                  ]}
                  onPress={() => setSelectedReason(active ? null : reason.key)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  testID={`ack-reason-${reason.key}`}
                >
                  <Text style={[styles.chipText, { color: active ? '#FFFFFF' : theme.colors.textSecondary }]}>
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Free text */}
          <TextInput
            style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text }]}
            placeholder={t.ackCommentPlaceholder}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            numberOfLines={3}
            value={freeText}
            onChangeText={setFreeText}
            testID="ack-comment-input"
          />

          {/* Actions — 3F: ≥44dp targets + ripple on the primary confirm */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={handleCancel}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="ack-cancel"
            >
              <Text style={[styles.cancelText, { color: theme.colors.textSecondary }]}>{t.cancel}</Text>
            </TouchableOpacity>
            <Pressable
              style={({ pressed }) => [
                styles.confirmBtn,
                { backgroundColor: theme.colors.primary },
                pressed && { opacity: 0.85 },
              ]}
              onPress={handleConfirm}
              android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
              testID="ack-confirm"
            >
              <Icon name="check" size={16} color="#FFFFFF" />
              <Text style={styles.confirmText}>{t.ackConfirm}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 16,
    padding: 20,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 44,
  },
  confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});

export default AckCommentDialog;
