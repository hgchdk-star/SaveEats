import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, tabularNums, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { Badge } from './badge';
import { Icon } from './icon';

export type OptionRowData = {
  id: string;
  name: string;
  additionalPrice: number;
  soldOut: boolean;
  selected: boolean;
  /** 품절이거나, 최대 개수에 닿아 더 고를 수 없을 때 */
  locked: boolean;
};

type OptionGroupProps = {
  name: string;
  required: boolean;
  /** 최대 1개면 라디오, 그 외에는 체크박스 */
  single: boolean;
  /** "1개 선택", "최대 N개까지 고를 수 있어요", "N개 모두 골랐어요" */
  rule: string;
  /** 최대 개수까지 골랐을 때 규칙 줄을 강조한다 */
  full: boolean;
  options: OptionRowData[];
  onToggle: (optionId: string) => void;
};

/** 메뉴 옵션 그룹. 필수 옵션은 "필수" 배지, 그 외는 "선택" 배지 */
export function OptionGroup({ name, required, single, rule, full, options, onToggle }: OptionGroupProps) {
  return (
    <View accessibilityLabel={name} style={styles.group}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.name}>
          {name}
        </Text>
        <Badge tone={required ? 'brand' : 'neutral'}>{required ? '필수' : '선택'}</Badge>
      </View>
      <Text style={[styles.rule, full && styles.ruleFull]}>{rule}</Text>
      <View accessibilityRole={single ? 'radiogroup' : undefined}>
        {options.map((option, index) => (
          <Pressable
            key={option.id}
            accessibilityRole={single ? 'radio' : 'checkbox'}
            accessibilityLabel={option.soldOut ? `${option.name}, 품절` : option.name}
            accessibilityState={{ checked: option.selected, disabled: option.locked }}
            disabled={option.locked}
            onPress={() => onToggle(option.id)}
            style={[styles.row, index > 0 && styles.rowBorder]}>
            <OptionControl single={single} selected={option.selected} locked={option.locked} />
            <Text style={[styles.label, option.locked && styles.locked]}>{option.name}</Text>
            {option.soldOut ? <Badge>품절</Badge> : null}
            <Text style={[styles.add, option.locked && styles.locked]}>{option.additionalPrice ? `+${formatWon(option.additionalPrice)}` : '+0원'}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function OptionControl({ single, selected, locked }: { single: boolean; selected: boolean; locked: boolean }) {
  const shape = single ? styles.radio : styles.check;
  if (single) {
    return <View style={[styles.control, shape, locked && styles.controlLocked, selected && styles.radioOn]} />;
  }
  return (
    <View style={[styles.control, shape, locked && styles.controlLocked, selected && styles.checkOn]}>
      {selected ? <Icon name="check" size={16} color={colors.onBrand} strokeWidth={3} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[3],
    borderTopWidth: 8,
    borderTopColor: colors.surfaceMuted,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  name: {
    ...font('700'),
    fontSize: 17,
    lineHeight: 24,
    color: colors.ink,
  },
  rule: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
    marginTop: 2,
    marginBottom: spacing[2],
  },
  ruleFull: {
    ...font('600'),
    color: colors.brandText,
  },
  row: {
    minHeight: 52,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  control: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    borderRadius: 11,
  },
  check: {
    borderRadius: 6,
  },
  controlLocked: {
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
  },
  radioOn: {
    borderWidth: 7,
    borderColor: colors.brand,
  },
  checkOn: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  label: {
    ...text.body1,
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
    color: colors.ink,
  },
  add: {
    ...font('600'),
    ...tabularNums,
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSecondary,
  },
  locked: {
    color: colors.inkDisabled,
  },
});
