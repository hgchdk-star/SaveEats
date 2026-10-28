import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, shadow, size, spacing, text } from '@/theme';

import { Icon } from './icon';

type Bank = { bankCode: string; bankName: string };

type BankSelectFieldProps = {
  label: string;
  placeholder: string;
  sheetTitle: string;
  banks: readonly Bank[];
  selectedCode: string | null;
  error?: string;
  disabled?: boolean;
  onSelect: (bank: Bank) => void;
};

/** 은행 선택 칸. 누르면 은행 목록 시트가 열린다 */
export function BankSelectField({ label, placeholder, sheetTitle, banks, selectedCode, error, disabled = false, onSelect }: BankSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selected = banks.find((b) => b.bankCode === selectedCode);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected ? selected.bankName : placeholder}`}
        accessibilityHint="은행 목록을 엽니다"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.box, !!error && styles.boxError]}>
        <Text style={[styles.value, !selected && styles.placeholder]}>{selected ? selected.bankName : placeholder}</Text>
        <Icon name="chevronDown" size={20} color={colors.inkSecondary} />
      </Pressable>
      {error ? (
        <View accessibilityRole="alert" style={styles.message}>
          <Icon name="alert" size={16} color={colors.danger} />
          <Text style={[styles.messageText, { color: colors.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={styles.root}>
          <Pressable accessibilityLabel="닫기" accessibilityRole="button" style={styles.dim} onPress={() => setOpen(false)} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + spacing[5] }]}>
            <View style={styles.handle} />
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {sheetTitle}
            </Text>
            <ScrollView accessibilityRole="radiogroup" style={styles.list}>
              {banks.map((bank) => {
                const on = bank.bankCode === selectedCode;
                return (
                  <Pressable
                    key={bank.bankCode}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => {
                      setOpen(false);
                      onSelect(bank);
                    }}
                    style={styles.row}>
                    <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{bank.bankName}</Text>
                    {on ? <Icon name="check" size={20} color={colors.actionText} strokeWidth={2.25} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing[2],
  },
  label: {
    ...text.label,
    color: colors.ink,
  },
  box: {
    height: size.control,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  boxError: {
    borderColor: colors.danger,
  },
  value: {
    ...text.body1,
    color: colors.ink,
  },
  placeholder: {
    color: colors.inkTertiary,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  messageText: {
    ...text.caption,
    color: colors.inkTertiary,
  },
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    boxShadow: shadow.sheet,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    alignSelf: 'center',
    marginTop: spacing[2],
  },
  sheetTitle: {
    ...text.h2,
    color: colors.ink,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  list: {
    paddingHorizontal: spacing[5],
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: {
    ...text.body1,
    color: colors.ink,
  },
  rowLabelOn: {
    ...font('700'),
    color: colors.actionText,
  },
});
