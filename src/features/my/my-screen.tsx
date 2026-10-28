import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AccountDestinationCard } from '@/components/ui/account-destination-card';
import { PrimaryButton, SecondaryButton, TextButton } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/feedback-states';
import { Icon } from '@/components/ui/icon';
import { ListGroup, type ListRowSpec } from '@/components/ui/list-group';
import { MonthlySummary } from '@/components/ui/monthly-summary';
import { ProfileHeader } from '@/components/ui/profile-header';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { useHistoryStore } from '@/features/history/history-store';
import { goAccount, goLogin, goMonthly, goMyReviews, goNotificationSettings, goSettings } from '@/features/order/flow-routes';
import { useAsync } from '@/hooks/use-async';
import { myService } from '@/services';
import { getSession, useSession } from '@/services/session';
import { colors, radius, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';
import { avatarInitial } from '@/utils/mask';

const copy = draftCopy.my;

/**
 * 마이 (㉕). 개인 데이터는 로그인 사용자만 본다(FR-MY-001). Guest는 로그인 안내와 설정만 본다.
 * 금융 대시보드가 아니다: 잔액 · 그래프 · 칭찬/죄책감 문구 없이 사실만 보여준다. 계좌는 "등록"이지 "연결"이 아니다.
 * 섹션마다 따로 불러오고, 한 섹션이 실패해도 나머지는 그대로 쓴다. 실패한 섹션만 다시 시도한다 (FR-MY-007 · 008).
 */
export function MyScreen() {
  const { isMember, userId, destinationAccount } = useSession();
  const summary = useHistoryStore((s) => s.summary);
  const summaryLoad = useHistoryStore((s) => s.summaryLoad);

  const profile = useAsync(`my:profile:${userId}`, () => (isMember ? myService.getProfile() : Promise.reject(new Error('GUEST'))));
  const lifetime = useAsync(`my:lifetime:${userId}`, () => (isMember ? myService.getLifetimeRecord() : Promise.reject(new Error('GUEST'))));

  const loadSummary = useHistoryStore((s) => s.loadSummary);
  useEffect(() => {
    if (isMember) void loadSummary();
  }, [isMember, loadSummary]);

  // 마이 탭으로 돌아올 때 기록을 다시 맞춘다(처음 한 번은 제외)
  const first = useRef(true);
  const reloadLifetime = lifetime.reload;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reloadLifetime();
      if (getSession().isMember) void useHistoryStore.getState().loadSummary();
    }, [reloadLifetime]),
  );

  const top = <TopNavigation title={copy.title} divider />;

  const settingsRow: ListRowSpec = { key: 'settings', label: copy.rowSettings, icon: 'user', onPress: goSettings };

  if (!isMember) {
    return (
      <Screen top={top}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.guest}>
            <EmptyState icon="user" title={copy.guestTitle} description={copy.guestDesc} action={<PrimaryButton onPress={() => goLogin({ action: 'TAB', tab: 'my' })}>{copy.guestAction}</PrimaryButton>} />
          </View>
          {/* 설정(이용 방법 · 약관)은 Guest도 쓴다 */}
          <ListGroup rows={[settingsRow]} />
        </ScrollView>
      </Screen>
    );
  }

  const zero = lifetime.status === 'ok' && !lifetime.data.hasAnyOrder;

  return (
    <Screen top={top}>
      <ScrollView contentContainerStyle={styles.content}>
        {profile.status === 'ok' ? (
          <ProfileHeader maskedName={profile.data.maskedName} maskedEmail={profile.data.maskedEmail} initial={avatarInitial(profile.data.maskedName, profile.data.maskedEmail)} />
        ) : profile.status === 'loading' ? (
          <View accessibilityLabel="불러오는 중" style={styles.profileSkeleton}>
            <Skeleton width={56} height={56} radius={28} />
            <View style={styles.profileLines}>
              <Skeleton width="40%" height={20} />
              <Skeleton width="60%" height={14} />
            </View>
          </View>
        ) : (
          <SectionRetry message={draftCopy.my.lifetimeError} onRetry={profile.reload} />
        )}

        <Section title={copy.accountTitle}>
          <AccountDestinationCard account={destinationAccount} onPress={goAccount} />
        </Section>

        {zero ? (
          <View style={styles.zero}>
            <EmptyState icon="receipt" title={confirmedCopy.myZeroTitle} />
            <View style={styles.zeroAction}>
              <SecondaryButton onPress={() => router.navigate('/')}>{confirmedCopy.myZeroAction}</SecondaryButton>
            </View>
          </View>
        ) : (
          <>
            <Section title={copy.monthTitle}>
              <MonthlySummary variant="compact" load={summaryLoad} summary={summary} onOpen={() => goMonthly()} onRetry={() => void loadSummary()} />
            </Section>
            <Section title={copy.lifetimeTitle}>
              {lifetime.status === 'loading' ? (
                <View accessibilityLabel="불러오는 중" style={styles.life}>
                  <Skeleton width="80%" height={20} />
                </View>
              ) : lifetime.status === 'error' ? (
                <View accessibilityRole="alert" style={[styles.life, styles.lifeRow]}>
                  <View style={styles.lifeError}>
                    <Icon name="alert" size={16} color={colors.danger} />
                    <Text style={styles.lifeErrorText}>{copy.lifetimeError}</Text>
                  </View>
                  <TextButton size="sm" onPress={lifetime.reload}>
                    {copy.lifetimeRetry}
                  </TextButton>
                </View>
              ) : (
                <Text style={[styles.life, styles.lifeText]}>{copy.lifetimeLine(lifetime.data.orderCount, formatWon(lifetime.data.deliveredAmount))}</Text>
              )}
            </Section>
          </>
        )}

        <ListGroup
          rows={[
            { key: 'reviews', label: copy.rowReviews, icon: 'review', onPress: () => goMyReviews() },
            { key: 'notifications', label: copy.rowNotifications, icon: 'clock', onPress: goNotificationSettings },
            settingsRow,
          ]}
        />
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function SectionRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View accessibilityRole="alert" style={[styles.life, styles.lifeRow]}>
      <View style={styles.lifeError}>
        <Icon name="alert" size={16} color={colors.danger} />
        <Text style={styles.lifeErrorText}>{message}</Text>
      </View>
      <TextButton size="sm" onPress={onRetry}>
        {copy.lifetimeRetry}
      </TextButton>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[5], gap: spacing[6] },
  guest: { paddingTop: spacing[6] },
  section: { gap: spacing[2] },
  sectionTitle: { ...text.label, color: colors.inkSecondary },
  profileSkeleton: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  profileLines: { flex: 1, gap: spacing[2] },
  zero: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, backgroundColor: colors.surface, paddingBottom: spacing[4] },
  zeroAction: { alignItems: 'center' },
  life: { minHeight: 56, justifyContent: 'center', paddingVertical: spacing[3], paddingHorizontal: spacing[4], borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, backgroundColor: colors.surface },
  lifeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  lifeText: { ...text.title, color: colors.ink },
  lifeError: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  lifeErrorText: { ...text.label, color: colors.ink, flexShrink: 1 },
});
