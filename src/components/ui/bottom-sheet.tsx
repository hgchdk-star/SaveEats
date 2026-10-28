import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, spacing, text } from '@/theme';

import { PrimaryButton, SecondaryButton } from './button';
import { DangerButton } from './danger-button';

type SheetAction = { label: string; onPress: () => void };

type ConfirmSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 큰 한 줄 문구 (다른 가게 담기 확인처럼 제목 없이 문장만 쓸 때) */
  message?: string;
  title?: string;
  descriptions?: string[];
  secondary: SheetAction;
  primary: SheetAction;
  /** 되돌리기 어려운 행동(회원 탈퇴)이면 확인 버튼을 DangerButton으로 */
  danger?: boolean;
};

/**
 * 하단 확인 시트: 취소 / 확인 두 버튼.
 * 시트 뒤 어두운 영역을 누르면 닫힌다.
 */
export function ConfirmSheet({ visible, onClose, message, title, descriptions = [], secondary, primary, danger = false }: ConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable accessibilityLabel="닫기" accessibilityRole="button" style={styles.dim} onPress={onClose} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + spacing[5] }]}>
          <View style={styles.handle} />
          <SheetBody message={message} title={title} descriptions={descriptions}>
            <View style={styles.buttons}>
              <View style={styles.secondary}>
                <SecondaryButton size="lg" block onPress={secondary.onPress}>
                  {secondary.label}
                </SecondaryButton>
              </View>
              <View style={styles.primary}>
                {danger ? (
                  <DangerButton block onPress={primary.onPress}>
                    {primary.label}
                  </DangerButton>
                ) : (
                  <PrimaryButton size="lg" block onPress={primary.onPress}>
                    {primary.label}
                  </PrimaryButton>
                )}
              </View>
            </View>
          </SheetBody>
        </View>
      </View>
    </Modal>
  );
}

function SheetBody({ message, title, descriptions, children }: { message?: string; title?: string; descriptions: string[]; children: ReactNode }) {
  return (
    <View style={styles.body}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {descriptions.map((d) => (
        <Text key={d} style={styles.description}>
          {d}
        </Text>
      ))}
      {children}
    </View>
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
  body: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
  },
  title: {
    ...text.h2,
    color: colors.ink,
  },
  message: {
    ...text.h3,
    color: colors.ink,
    marginTop: spacing[2],
  },
  description: {
    ...text.body2,
    color: colors.inkSecondary,
    marginTop: spacing[1],
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[6],
  },
  secondary: {
    flex: 1,
  },
  primary: {
    flex: 2,
  },
});
