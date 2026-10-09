import { useState } from 'react';
import { StyleSheet, Text, TextInput as RNTextInput, View, type KeyboardTypeOptions } from 'react-native';

import { colors, font, radius, size, spacing, text } from '@/theme';

import { Icon } from './icon';

type TextInputProps = {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  /** 입력 아래 도움말 */
  helper?: string;
  /** 오류가 있으면 테두리가 danger 색이 되고, 아이콘 + 문구로 알린다 */
  error?: string;
  disabled?: boolean;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'email' | 'password' | 'new-password' | 'off';
  autoCapitalize?: 'none' | 'sentences';
  maxLength?: number;
  onSubmitEditing?: () => void;
  returnKeyType?: 'next' | 'done' | 'go';
};

/** 라벨이 있는 한 줄 입력. 포커스일 때 테두리가 ink 색으로 바뀐다 */
export function TextInput({
  label,
  value,
  onChangeText,
  placeholder,
  helper,
  error,
  disabled = false,
  secure = false,
  keyboardType,
  autoComplete,
  autoCapitalize = 'none',
  maxLength,
  onSubmitEditing,
  returnKeyType,
}: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, focused && styles.boxFocus, !!error && styles.boxError, disabled && styles.boxDisabled]}>
        <RNTextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkTertiary}
          editable={!disabled}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          maxLength={maxLength}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, disabled && styles.inputDisabled]}
        />
      </View>
      {error ? (
        <View accessibilityRole="alert" style={styles.message}>
          <Icon name="alert" size={16} color={colors.danger} />
          <Text style={[styles.messageText, { color: colors.danger }]}>{error}</Text>
        </View>
      ) : helper ? (
        <Text style={styles.messageText}>{helper}</Text>
      ) : null}
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
    justifyContent: 'center',
  },
  boxFocus: {
    borderColor: colors.ink,
  },
  boxError: {
    borderColor: colors.danger,
  },
  boxDisabled: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.line,
  },
  input: {
    ...text.body1,
    padding: 0,
    color: colors.ink,
  },
  inputDisabled: {
    color: colors.inkDisabled,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  messageText: {
    ...text.caption,
    ...font('400'),
    color: colors.inkTertiary,
  },
});
