import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { colors, font, radius, shadow, spacing, text } from '@/theme';

import { IconButton } from './icon-button';

const copy = confirmedCopy.contentSource;

type SourceSheetProps = {
  visible: boolean;
  /** 현재 가게 이름 */
  storeName: string;
  items: readonly { name: string; url: string }[];
  onClose: () => void;
  /** 선택한 항목 자신의 URL을 연다 */
  onOpenSource: (url: string) => void;
};

/**
 * 가게별 콘텐츠 출처 목록 바텀시트 (FR-STORE-017 ~ 019).
 * 순서: 제목 → 가게명 → 안내 → 목록. 1개든 여러 개든 같은 항목으로 보이고 메뉴/이미지 구분은 없다.
 * 출처명 자체가 링크이고 항목에만 ↗를 붙인다. ✕와 바깥 배경으로 닫는다.
 * 긴 이름은 줄바꿈하고, 목록이 길면 시트 안에서 스크롤한다. 하단 안전 영역을 비운다.
 * 시트를 열고 닫아도 아래 화면의 탭·스크롤은 그대로다(Modal이라 화면을 다시 그리지 않는다).
 */
export function SourceSheet({ visible, storeName, items, onClose, onOpenSource }: SourceSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable accessibilityLabel={draftCopy.store.sourceSheetClose} accessibilityRole="button" style={styles.dim} onPress={onClose} />
        <View accessibilityViewIsModal style={[styles.sheet, { maxHeight: height * 0.8, paddingBottom: insets.bottom + spacing[5] }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text accessibilityRole="header" style={styles.title}>
                {copy.title}
              </Text>
              <Text style={styles.store}>{storeName}</Text>
            </View>
            <IconButton icon="close" label={draftCopy.store.sourceSheetClose} onPress={onClose} />
          </View>
          <Text style={styles.guide}>{copy.sheetGuide}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            {items.map((item, i) => (
              <Pressable
                key={`${i}:${item.url}`}
                accessibilityRole="link"
                accessibilityLabel={item.name}
                onPress={() => onOpenSource(item.url)}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.arrow}>
                  ↗
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    boxShadow: shadow.sheet,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    alignSelf: 'center',
    marginTop: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingLeft: spacing[5],
    paddingRight: spacing[2],
    paddingTop: spacing[3],
  },
  headerText: {
    flex: 1,
    paddingTop: spacing[1],
  },
  title: {
    ...text.h2,
    color: colors.ink,
  },
  store: {
    ...text.body1,
    color: colors.ink,
    marginTop: spacing[1],
  },
  guide: {
    ...text.body2,
    color: colors.inkSecondary,
    paddingHorizontal: spacing[5],
    marginTop: spacing[1],
  },
  scroll: {
    flexGrow: 0,
    marginTop: spacing[3],
  },
  list: {
    paddingHorizontal: spacing[5],
  },
  item: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  arrow: {
    ...text.body2,
    color: colors.inkTertiary,
  },
  itemName: {
    ...font('500'),
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
});
