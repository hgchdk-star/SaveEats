import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, text } from '@/theme';

import { TextButton } from './button';
import { Icon, type IconName } from './icon';

type NoticeProps = {
  title: string;
  description?: string;
  /** danger는 막힌 이유(품절·주문 불가)를 알릴 때. 색만으로 구분하지 않고 항상 아이콘 + 문구 */
  tone?: 'default' | 'danger';
  icon?: IconName;
  action?: { label: string; onPress: () => void };
  /** 이미 좌우 여백이 있는 안쪽에 넣을 때 바깥 여백을 없앤다 */
  flush?: boolean;
};

/** 화면 위쪽의 안내 띠. 장바구니에서 주문이 막힌 이유를 알린다 */
export function Notice({ title, description, tone = 'default', icon = 'alert', action, flush = false }: NoticeProps) {
  const danger = tone === 'danger';
  return (
    <View
      accessibilityRole={danger ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.notice, danger && styles.noticeDanger, flush && styles.flush]}>
      <View style={styles.icon}>
        <Icon name={icon} size={20} color={danger ? colors.danger : colors.inkSecondary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {action ? <TextButton size="sm" onPress={action.onPress}>{action.label}</TextButton> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    marginHorizontal: spacing[5],
    paddingVertical: spacing[3],
    paddingLeft: spacing[4],
    paddingRight: spacing[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  noticeDanger: {
    borderColor: colors.danger,
  },
  flush: {
    marginHorizontal: 0,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
  },
  title: {
    ...text.label,
    color: colors.ink,
  },
  description: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSecondary,
    marginTop: 2,
  },
});
