import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { colors, radius, spacing, text } from '@/theme';

const guide = confirmedCopy.contentGuide;

/**
 * 서비스 및 콘텐츠 이용 안내 (FR-CONTENT-001 · 002). 정적 안내라 서버를 부르지 않고, Guest도 로그인 없이 읽는다.
 * 개인 계정·계좌·기록은 보여주지 않고, 브랜드별 출처 목록도 두지 않는다(출처는 가게 상세 하단에서 확인).
 * 이 문구는 현재 합의한 안내 카피이며 콘텐츠 사용권 확보나 법무 검토 완료를 뜻하지 않는다.
 */
export function ContentGuideScreen() {
  return (
    <Screen top={<TopNavigation title={guide.title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}>
      <ScrollView contentContainerStyle={styles.content}>
        {guide.sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {section.title}
            </Text>
            <View style={styles.card}>
              {section.lines.map((line) => (
                <View key={line} style={styles.line}>
                  <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.bullet}>
                    •
                  </Text>
                  <Text style={styles.lineText}>{line}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[5], gap: spacing[6] },
  section: { gap: spacing[2] },
  sectionTitle: { ...text.title, color: colors.ink },
  card: {
    gap: spacing[2],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  line: { flexDirection: 'row', gap: spacing[2] },
  bullet: { ...text.body2, color: colors.inkTertiary },
  lineText: { ...text.body2, flex: 1, color: colors.inkSecondary },
});
