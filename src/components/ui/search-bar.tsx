import type { ComponentRef, Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, size, spacing, text } from '@/theme';

import { Icon } from './icon';

type SearchBarButtonProps = {
  /** 기획서 11.4 확정 문구: "오늘은 뭐가 먹고 싶으세요?" */
  placeholder: string;
  onPress: () => void;
};

/**
 * 검색창 모양의 버튼. 홈에서는 입력하지 않고 누르면 검색 탭으로 간다 (FR-SRCH-001).
 * 입력할 수 있는 검색창은 아래 SearchBar다.
 */
export function SearchBarButton({ placeholder, onPress }: SearchBarButtonProps) {
  return (
    <Pressable accessibilityRole="search" accessibilityLabel={placeholder} onPress={onPress} style={styles.bar}>
      <Icon name="search" size={20} color={colors.inkSecondary} />
      <Text numberOfLines={1} style={styles.placeholder}>
        {placeholder}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: size.control,
    paddingLeft: spacing[4],
    paddingRight: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  placeholder: {
    ...text.body1,
    flex: 1,
    color: colors.inkTertiary,
  },
  input: {
    ...text.body1,
    flex: 1,
    height: size.control,
    padding: 0,
    color: colors.ink,
  },
  readOnlyText: {
    ...text.body1,
    flex: 1,
    color: colors.ink,
  },
  clear: {
    width: size.touch - 8,
    height: size.touch - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

type SearchBarProps = {
  value: string;
  placeholder: string;
  /** 입력할 수 있는 검색창에서 쓴다. readOnly에서는 쓰지 않는다 */
  onChangeText?: (next: string) => void;
  /** 엔터(검색 키) = 바로 검색 */
  onSubmit?: () => void;
  onClear: () => void;
  clearLabel: string;
  /** 입력 글자 수 상한 */
  maxLength: number;
  /** 입력창에 커서를 두려고 잡을 때 쓴다 */
  inputRef?: Ref<ComponentRef<typeof TextInput>>;
  /** 입력을 받지 않고 검색어만 보여준다. 바를 누르면 onOpen을 부른다 (검색 결과 상단 바) */
  readOnly?: boolean;
  onOpen?: () => void;
};

/**
 * 입력할 수 있는 검색창 (검색 탭). 입력 중에는 오른쪽에 지우기 버튼이 나온다.
 * readOnly이면 검색어를 보여주기만 하고, 누르면 onOpen, ✕를 누르면 onClear를 부른다 (검색 결과 상단 바).
 */
export function SearchBar({ value, placeholder, onChangeText, onSubmit, onClear, clearLabel, maxLength, inputRef, readOnly = false, onOpen }: SearchBarProps) {
  if (readOnly) {
    return (
      <Pressable accessibilityRole="search" accessibilityLabel={`검색어 ${value}. 눌러서 다시 검색`} onPress={onOpen} style={styles.bar}>
        <Icon name="search" size={20} color={colors.inkSecondary} />
        <Text numberOfLines={1} style={styles.readOnlyText}>
          {value}
        </Text>
        {value.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} hitSlop={8} onPress={onClear} style={styles.clear}>
            <Icon name="close" size={16} color={colors.inkSecondary} />
          </Pressable>
        ) : null}
      </Pressable>
    );
  }
  return (
    <View style={styles.bar}>
      <Icon name="search" size={20} color={colors.inkSecondary} />
      <TextInput
        ref={inputRef}
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.inkTertiary}
        returnKeyType="search"
        maxLength={maxLength}
        autoCorrect={false}
        style={styles.input}
      />
      {value.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} hitSlop={8} onPress={onClear} style={styles.clear}>
          <Icon name="close" size={16} color={colors.inkSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}
