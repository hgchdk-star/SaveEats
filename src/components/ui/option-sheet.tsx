import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, shadow, spacing, text } from '@/theme';

import { Icon } from './icon';

type OptionSheetProps = {
  visible: boolean;
  title: string;
  options: { title: string; sub?: string; onPress: () => void }[];
  onClose: () => void;
};

/** 선택지가 줄로 나열되는 하단 시트 (다른 방법으로 주문하기) */
export function OptionSheet({ visible, title, options, onClose }: OptionSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable accessibilityLabel="닫기" accessibilityRole="button" style={styles.dim} onPress={onClose} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + spacing[5] }]}>
          <View style={styles.handle} />
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <View style={styles.list}>
            {options.map((option) => (
              <Pressable key={option.title} accessibilityRole="button" onPress={option.onPress} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  {option.sub ? <Text style={styles.optionSub}>{option.sub}</Text> : null}
                </View>
                <Icon name="chevronRight" size={20} color={colors.inkTertiary} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
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
  title: {
    ...text.h2,
    color: colors.ink,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
  },
  list: {
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
  },
  option: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    ...font('600'),
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  optionSub: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
});
