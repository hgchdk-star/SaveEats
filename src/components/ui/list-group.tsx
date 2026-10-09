import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, font, radius, spacing, text } from '@/theme';

import { Icon, type IconName } from './icon';

/**
 * 행 종류는 넘긴 값으로 정해진다: onToggle이 있으면 스위치 줄, onPress가 있으면 이동 줄(›), 둘 다 없으면 정보 줄(값만).
 */
export type ListRowSpec = {
  key: string;
  label: string;
  desc?: string;
  /** 정보 줄·이동 줄 오른쪽 값 */
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  /** 스위치 줄 */
  on?: boolean;
  onToggle?: (next: boolean) => void;
  disabled?: boolean;
};

type ListGroupProps = {
  title?: string;
  rows: ListRowSpec[];
};

/** 마이 · 설정 · 알림 설정이 같이 쓰는 목록 묶음. [새 컴포넌트 제안] ListGroup · ListRow · Switch */
export function ListGroup({ title, rows }: ListGroupProps) {
  return (
    <View>
      {title ? (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      ) : null}
      <View style={styles.card}>
        {rows.map((row, i) => (
          <ListRow key={row.key} row={row} first={i === 0} />
        ))}
      </View>
    </View>
  );
}

function ListRow({ row, first }: { row: ListRowSpec; first: boolean }) {
  const label = (
    <View style={styles.text}>
      <Text style={styles.label}>{row.label}</Text>
      {row.desc ? <Text style={styles.desc}>{row.desc}</Text> : null}
    </View>
  );
  const icon = row.icon ? (
    <View style={styles.icon}>
      <Icon name={row.icon} size={20} color={colors.inkSecondary} />
    </View>
  ) : null;

  if (row.onToggle) {
    return (
      <View style={[styles.row, !first && styles.divider]}>
        {icon}
        {label}
        <Switch
          accessibilityLabel={row.label}
          value={!!row.on}
          disabled={row.disabled}
          onValueChange={row.onToggle}
          trackColor={{ false: colors.lineStrong, true: colors.actionFill }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.lineStrong}
        />
      </View>
    );
  }
  if (row.onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={row.onPress} style={({ pressed }) => [styles.row, !first && styles.divider, pressed && styles.pressed]}>
        {icon}
        {label}
        {row.value ? <Text style={styles.value}>{row.value}</Text> : null}
        <Icon name="chevronRight" size={20} color={colors.inkTertiary} />
      </Pressable>
    );
  }
  return (
    <View style={[styles.row, !first && styles.divider]}>
      {icon}
      {label}
      <Text numberOfLines={1} style={styles.value}>
        {row.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...text.label,
    color: colors.inkSecondary,
    marginBottom: spacing[2],
  },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  icon: {
    width: 24,
    alignItems: 'center',
  },
  text: {
    flex: 1,
  },
  label: {
    ...font('500'),
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  desc: {
    ...text.caption,
    color: colors.inkTertiary,
  },
  value: {
    ...text.body2,
    maxWidth: '60%',
    color: colors.inkTertiary,
    textAlign: 'right',
  },
});
