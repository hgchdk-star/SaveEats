import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, tabularNums, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { Badge } from './badge';
import { Icon } from './icon';
import { QuantitySelector } from './quantity-selector';

export type OptionRowData = {
  id: string;
  name: string;
  additionalPrice: number;
  soldOut: boolean;
  selected: boolean;
  /** 품절이거나, 최대 개수에 닿아 더 고를 수 없을 때 */
  locked: boolean;
  /**
   * 수량을 조절할 수 있는 옵션이면 최대 수량. 없으면 수량 조절이 없는 옵션이다(기존 동작).
   * 선택한 옵션에만 수량 조절을 같은 행 오른쪽에 보여 준다.
   */
  maxQuantity?: number;
  /** 고른 수량(메뉴 한 개에 들어가는 개수). 기본 1 */
  quantity?: number;
};

type OptionGroupProps = {
  name: string;
  required: boolean;
  /** 최대 1개면 라디오, 그 외에는 체크박스 */
  single: boolean;
  /** "1개 선택", "최대 N종 선택", "N종 모두 골랐어요". 실제 제한이 없으면 빈 문자열(줄을 그리지 않는다) */
  rule: string;
  /** 최대 개수까지 골랐을 때 규칙 줄을 강조한다 */
  full: boolean;
  options: OptionRowData[];
  onToggle: (optionId: string) => void;
  /** 수량 조절 옵션의 수량을 바꿨을 때 */
  onQuantityChange?: (optionId: string, quantity: number) => void;
};

/** 메뉴 옵션 그룹. 필수 옵션은 "필수" 배지, 그 외는 "선택" 배지 */
export function OptionGroup({ name, required, single, rule, full, options, onToggle, onQuantityChange }: OptionGroupProps) {
  return (
    <View accessibilityLabel={name} style={styles.group}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.name}>
          {name}
        </Text>
        <Badge tone={required ? 'brand' : 'neutral'}>{required ? '필수' : '선택'}</Badge>
      </View>
      {rule ? <Text style={[styles.rule, full && styles.ruleFull]}>{rule}</Text> : <View style={styles.ruleGap} />}
      <View accessibilityRole={single ? 'radiogroup' : undefined}>
        {options.map((option, index) => {
          const quantity = option.quantity ?? 1;
          // 수량 조절은 수량을 허용하는 옵션을 '선택했을 때'만 같은 행 오른쪽에 나타난다(아래에 줄을 따로 만들지 않는다)
          const adjustable = option.maxQuantity !== undefined && option.selected && !option.soldOut;
          return (
            <View key={option.id} style={[styles.line, index > 0 && styles.rowBorder]}>
              {/* 체크(선택·해제)와 이름·단가는 하나의 누르는 영역. 조절기는 그 바깥 형제라서 누르면 행 선택이 바뀌지 않는다 */}
              <Pressable
                accessibilityRole={single ? 'radio' : 'checkbox'}
                accessibilityLabel={option.soldOut ? `${option.name}, 품절` : option.name}
                accessibilityState={{ checked: option.selected, disabled: option.locked }}
                disabled={option.locked}
                onPress={() => onToggle(option.id)}
                style={styles.row}>
                <OptionControl single={single} selected={option.selected} locked={option.locked} />
                {/* 이름 바로 뒤에 괄호로 개당 단가를 붙인다(수량을 바꿔도 단가는 그대로, 합계는 화면 아래 금액에 반영). 0원 표시는 기존대로 '+0원' */}
                <Text style={[styles.label, option.locked && styles.locked]}>
                  {option.name}
                  <Text style={[styles.add, option.locked && styles.locked]}>{` (${option.additionalPrice ? `+${formatWon(option.additionalPrice)}` : '+0원'})`}</Text>
                </Text>
                {option.soldOut ? <Badge>품절</Badge> : null}
              </Pressable>
              {adjustable ? (
                <View style={styles.quantitySlot}>
                  <QuantitySelector
                    size="row"
                    accent
                    label={`${option.name} 수량`}
                    value={quantity}
                    min={1}
                    max={option.maxQuantity}
                    onChange={(next) => onQuantityChange?.(option.id, next)}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
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
  /** 규칙 줄이 없을 때 이름과 첫 옵션 사이 간격만 남긴다 */
  ruleGap: {
    height: spacing[2],
  },
  ruleFull: {
    ...font('600'),
    color: colors.brandText,
  },
  /** 한 옵션 = 한 줄. 왼쪽은 선택 영역(체크·이름·단가), 오른쪽은 수량 조절기 */
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  /** 남는 폭을 모두 쓰고, 이름이 길거나 큰 글자에서는 이름이 줄바꿈된다(조절기와 겹치지 않는다) */
  row: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  /** 조절기는 줄어들지 않는다. 터치 여유(hitSlop)까지 포함해 48×46 */
  quantitySlot: {
    flexShrink: 0,
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
    flexShrink: 1,
    minWidth: 0,
    color: colors.ink,
  },
  add: {
    ...font('600'),
    ...tabularNums,
    fontSize: 14,
    color: colors.inkSecondary,
  },
  locked: {
    color: colors.inkDisabled,
  },
});
