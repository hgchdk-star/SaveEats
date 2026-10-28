import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { colors, spacing, text } from '@/theme';

/**
 * 아직 디자인이 없는 화면의 공용 빈 화면.
 * 화면마다 라우트를 따로 두고 이 컴포넌트를 쓴다. 디자인이 나오면 그 라우트의 내용만 채운다.
 */
export function UnbuiltScreen() {
  const router = useRouter();

  return (
    <Screen top={<TopNavigation onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}>
      <View style={styles.body}>
        <Text style={styles.message}>{draftCopy.unbuiltScreen}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
  },
  message: {
    ...text.body1,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
});
