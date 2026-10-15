import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

/**
 * 탭 화면의 임시 자리. 화면 내용 없이 앱 배경만 그린다.
 * 각 탭 화면을 구현하면서 이 컴포넌트를 실제 화면으로 바꾸고, 다 바뀌면 이 파일을 지운다.
 */
export function TabScreenPlaceholder() {
  return <View style={styles.screen} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
