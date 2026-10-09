import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing, tabularNums, text } from '@/theme';

import { FoodImage } from './food-image';
import { Icon } from './icon';
import { Price } from './price';

type KeyValueRow = { label: string; value: string };

/** 라벨 - 값 표 (가게, 주문 메뉴, 주문금액, 돈이 배달될 곳) */
export function KeyValueCard({ rows }: { rows: KeyValueRow[] }) {
  return (
    <View style={styles.card}>
      {rows.map((row) => (
        <View key={row.label} style={styles.kvRow}>
          <Text style={styles.kvLabel}>{row.label}</Text>
          <Text style={styles.kvValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

type OrderItemsCardProps = {
  /** 가게 이름을 아직 불러오지 못했으면 가게 줄을 숨긴다 */
  storeName?: string;
  storeImageUri: string | null;
  items: { key: string; name: string; optionText: string; lineTotal: number; quantity: number }[];
};

/** 최종 주문 확인의 주문 메뉴 카드: 가게 + 메뉴 줄 (이름·옵션·줄 금액·수량) */
export function OrderItemsCard({ storeName, storeImageUri, items }: OrderItemsCardProps) {
  return (
    <View style={styles.card}>
      {storeName ? (
        <View style={styles.store}>
          <FoodImage uri={storeImageUri} width={40} rounded={radius.xs} />
          <Text style={styles.storeName}>{storeName}</Text>
        </View>
      ) : null}
      {items.map((item) => (
        <View key={item.key} style={styles.itemRow}>
          <View style={styles.itemName}>
            <Text style={styles.itemNameText}>{item.name}</Text>
            {item.optionText ? <Text style={styles.itemOption}>{item.optionText}</Text> : null}
          </View>
          <View style={styles.itemRight}>
            <Price amount={item.lineTotal} size="sm" />
            <Text style={styles.itemQty}>{item.quantity}개</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

type DisclosureProps = { title: string; body: string };

/** 최종 주문 확인 고지. 온보딩을 건너뛰어도 항상 보인다 (FR-ORD-008) */
export function Disclosure({ title, body }: DisclosureProps) {
  return (
    <View accessibilityRole="summary" style={styles.disclosure}>
      <View style={styles.disclosureIcon}>
        <Icon name="alert" size={20} color={colors.ink} />
      </View>
      <View style={styles.disclosureText}>
        <Text style={styles.disclosureTitle}>{title}</Text>
        <Text style={styles.disclosureBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[4],
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  kvRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  kvLabel: {
    ...text.body2,
    width: 96,
    color: colors.inkTertiary,
  },
  kvValue: {
    ...text.body2,
    ...tabularNums,
    flex: 1,
    color: colors.ink,
  },
  store: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  storeName: {
    ...text.title,
    flex: 1,
    color: colors.ink,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  itemName: {
    flex: 1,
  },
  itemNameText: {
    ...text.body1,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  itemOption: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  itemRight: {
    alignItems: 'flex-end',
  },
  itemQty: {
    ...text.body2,
    ...tabularNums,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  disclosure: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  disclosureIcon: {
    marginTop: 1,
  },
  disclosureText: {
    flex: 1,
  },
  disclosureTitle: {
    ...font('700'),
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  disclosureBody: {
    ...text.body2,
    color: colors.inkSecondary,
    marginTop: 2,
  },
});
