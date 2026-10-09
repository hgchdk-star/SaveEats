import { useState } from 'react';
import { StyleSheet, Text, TextInput as RNTextInput, View } from 'react-native';

import { colors, radius, spacing, tabularNums, text } from '@/theme';

import { Icon } from './icon';

type TextAreaProps = {
  /** 라벨은 화면 쪽에서 따로 그린다. 여기서는 접근성 이름으로만 쓴다 */
  accessibilityLabel: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  /** 글자 수 줄 ("12/500"). 항상 보인다 */
  counter: string;
  counterOver?: boolean;
  error?: string;
  disabled?: boolean;
};

/** 여러 줄 입력. 테두리와 오류 색은 한 줄 입력(TextInput)과 같다 */
export function TextArea({ accessibilityLabel, value, onChangeText, placeholder, counter, counterOver = false, error, disabled = false }: TextAreaProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <RNTextInput
        accessibilityLabel={accessibilityLabel}
        multiline
        textAlignVertical="top"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkTertiary}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, focused && styles.focus, !!error && styles.error, disabled && styles.disabled]}
      />
      <View style={styles.meta}>
        {error ? (
          <View accessibilityRole="alert" style={styles.errorRow}>
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <View />
        )}
        <Text style={[styles.counter, counterOver && styles.counterOver]}>{counter}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
  },
  input: {
    ...text.body1,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 148,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  focus: {
    borderColor: colors.ink,
  },
  error: {
    borderColor: colors.danger,
  },
  disabled: {
    backgroundColor: colors.surfaceMuted,
    color: colors.inkDisabled,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[2],
    minHeight: 18,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  errorText: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
  },
  counter: {
    ...text.caption,
    ...tabularNums,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
    marginLeft: 'auto',
  },
  counterOver: {
    color: colors.danger,
  },
});
