import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme';

/**
 * 루트 스택. 하단 탭은 `(tabs)` 안에서만 보이고, 그 밖의 화면은 탭 없이 위에 쌓인다.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </>
  );
}
