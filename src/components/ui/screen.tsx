import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

import { ToastHost } from './toast';

type ScreenProps = {
  top?: ReactNode;
  bottom?: ReactNode;
  children: ReactNode;
  /** 입력칸이 있는 화면: 키보드가 올라와도 아래 버튼이 가려지지 않게 한다 */
  avoidKeyboard?: boolean;
};

/**
 * 화면 바탕. 위(상단 바) - 가운데(본문) - 아래(CTA 바)를 세로로 쌓는다.
 * 안전 영역은 상단 바와 아래 바가 각자 처리한다.
 * 토스트는 본문 아래쪽에 뜨기 때문에 CTA 바나 하단 탭을 가리지 않는다.
 */
export function Screen({ top, bottom, children, avoidKeyboard = false }: ScreenProps) {
  const content = (
    <>
      {top}
      <View style={styles.body}>
        {children}
        <ToastHost />
      </View>
      {bottom}
    </>
  );
  if (!avoidKeyboard) return <View style={styles.screen}>{content}</View>;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}>
      {content}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
  },
});
