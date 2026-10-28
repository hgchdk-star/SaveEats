import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useCartStore } from '@/features/cart/cart-store';
import { useRecentViewedStore } from '@/features/home/recent-viewed-store';
import { recoverOnStart } from '@/features/order/recovery';
import { ReturnCoordinator } from '@/features/order/return-coordinator';
import { LaunchGate } from '@/features/start/launch-gate';
import { colors, fontAssets } from '@/theme';

SplashScreen.preventAutoHideAsync();

/** 딥링크로 안쪽 화면에 바로 들어와도 뒤로 가면 홈(탭)이 나오게 한다 */
export const unstable_settings = { anchor: '(tabs)' };

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

  // 장바구니를 읽은 뒤에 한 번: 기기에 남은 완료 확인 큐·결과를 모르는 주문 생성 시도를 정리하고 내역 점을 맞춘다
  useEffect(() => {
    if (cartStatus !== 'HYDRATING') void recoverOnStart();
  }, [cartStatus]);

  // 글꼴을 못 불러와도 앱은 시스템 글꼴로 열린다
  const ready = (fontsLoaded || fontError) && cartStatus !== 'HYDRATING';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ReturnCoordinator />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        {/* 목록의 첫 화면이 앱의 시작 화면이 된다(주소 없이 QR로 열 때). 반드시 탭(홈)을 맨 앞에 둔다 */}
        <Stack.Screen name="(tabs)" />
        {/* 주문 결과 화면은 밀어서 뒤로 가지 못하게 한다. 닫기·내역 보기 같은 버튼으로만 나간다 */}
        <Stack.Screen name="order/return-check" options={{ gestureEnabled: false }} />
        <Stack.Screen name="order/question" options={{ gestureEnabled: false }} />
        <Stack.Screen name="order/done" options={{ gestureEnabled: false }} />
        <Stack.Screen name="order/cancelled" options={{ gestureEnabled: false }} />
        <Stack.Screen name="order/not-yet" options={{ gestureEnabled: false }} />
        <Stack.Screen name="order/status-error" options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack>
      <LaunchGate />
    </SafeAreaProvider>
  );
}
