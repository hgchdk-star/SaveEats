import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useCartStore } from '@/features/cart/cart-store';
import { useRecentViewedStore } from '@/features/home/recent-viewed-store';
import { colors, fontAssets } from '@/theme';

SplashScreen.preventAutoHideAsync();

/**
 * 루트 스택. 하단 탭은 `(tabs)` 안에서만 보이고, 그 밖의 화면은 탭 없이 위에 쌓인다.
 * 글꼴과 기기에 저장된 값(장바구니·최근 본 항목)을 읽은 뒤에 첫 화면을 보여준다.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const cartStatus = useCartStore((s) => s.status);

  useEffect(() => {
    void useCartStore.getState().hydrate();
    void useRecentViewedStore.getState().hydrate();
  }, []);

  // 글꼴을 못 불러와도 앱은 시스템 글꼴로 열린다
  const ready = (fontsLoaded || fontError) && cartStatus !== 'HYDRATING';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </SafeAreaProvider>
  );
}
