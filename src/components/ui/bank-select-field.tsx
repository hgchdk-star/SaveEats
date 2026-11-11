import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, shadow, size, spacing, text } from '@/theme';

import { buildSections, normalizeQuery, searchBanks, type BankItem, type BankKind } from './bank-list';
import { Icon } from './icon';

type Bank = BankItem;

const TABS: readonly { kind: BankKind; label: string }[] = [
  { kind: 'bank', label: '은행·상호금융' },
  { kind: 'securities', label: '증권사' },
];

type BankSelectFieldProps = {
  label: string;
  placeholder: string;
  sheetTitle: string;
  banks: readonly Bank[];
  selectedCode: string | null;
  error?: string;
  disabled?: boolean;
  onSelect: (bank: Bank) => void;
};

/** 은행 선택 칸. 누르면 검색과 탭이 있는 기관 목록 시트가 열린다 */
export function BankSelectField({ label, placeholder, sheetTitle, banks, selectedCode, error, disabled = false, onSelect }: BankSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<BankKind>('bank');
  const listRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const restoreScroll = useRef(false);
  const insets = useSafeAreaInsets();
  const selected = banks.find((b) => b.bankCode === selectedCode);
  const searching = normalizeQuery(query).length > 0;
  const results = searching ? searchBanks(banks, query) : [];
  const sections = buildSections(banks, tab);

  // 열 때마다 검색어를 지우고, 고른 기관이 있는 탭에서 그 위치를 보여 준다. 고른 기관이 없으면 은행·상호금융 탭 맨 위
  const openSheet = () => {
    setQuery('');
    setTab(selected?.kind ?? 'bank');
    restoreScroll.current = !!selected;
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);
  const changeTab = (kind: BankKind) => {
    restoreScroll.current = false;
    setTab(kind);
    listRef.current?.scrollTo({ y: 0, animated: false });
  };
  const trackRow = (code: string, y: number) => {
    if (restoreScroll.current && code === selectedCode) {
      restoreScroll.current = false;
      listRef.current?.scrollTo({ y: Math.max(0, y - spacing[2]), animated: false });
    }
  };
  const renderRow = (bank: Bank) => {
    const on = bank.bankCode === selectedCode;
    return (
      <Pressable
        key={bank.bankCode}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onLayout={(e) => trackRow(bank.bankCode, e.nativeEvent.layout.y)}
        onPress={() => {
          setOpen(false);
          onSelect(bank);
        }}
        style={styles.row}>
        <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{bank.bankName}</Text>
        {on ? <Icon name="check" size={20} color={colors.actionText} strokeWidth={2.25} /> : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected ? selected.bankName : placeholder}`}
        accessibilityHint="은행 목록을 엽니다"
        disabled={disabled}
        onPress={openSheet}
        style={[styles.box, !!error && styles.boxError]}>
        <Text style={[styles.value, !selected && styles.placeholder]}>{selected ? selected.bankName : placeholder}</Text>
        <Icon name="chevronDown" size={20} color={colors.inkSecondary} />
      </Pressable>
      {error ? (
        <View accessibilityRole="alert" style={styles.message}>
          <Icon name="alert" size={16} color={colors.danger} />
          <Text style={[styles.messageText, { color: colors.danger }]}>{error}</Text>
        </View>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={closeSheet} statusBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
          <Pressable accessibilityLabel="닫기" accessibilityRole="button" style={styles.dim} onPress={closeSheet} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + spacing[5] }]}>
            <View style={styles.handle} />
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {sheetTitle}
            </Text>
            <View style={styles.searchBox}>
              <Icon name="search" size={20} color={colors.inkSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="은행·증권사 검색"
                placeholderTextColor={colors.inkTertiary}
                accessibilityLabel="은행·증권사 검색"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.searchInput}
              />
              {searching ? (
                <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" hitSlop={8} onPress={() => setQuery('')}>
                  <Icon name="close" size={20} color={colors.inkSecondary} />
                </Pressable>
              ) : null}
            </View>
            {searching ? null : (
              <View accessibilityRole="tablist" style={styles.tabs}>
                {TABS.map((t) => {
                  const on = t.kind === tab;
                  return (
                    <Pressable key={t.kind} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => changeTab(t.kind)} style={[styles.tab, on && styles.tabOn]}>
                      <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <ScrollView ref={listRef} accessibilityRole="radiogroup" keyboardShouldPersistTaps="handled" style={styles.list}>
              {searching ? (
                results.length > 0 ? (
                  results.map(renderRow)
                ) : (
                  <Text style={styles.empty}>검색 결과가 없어요</Text>
                )
              ) : (
                sections.map((section) => (
                  <View key={section.key}>
                    {section.title ? (
                      <Text accessibilityRole="header" style={styles.sectionTitle}>
                        {section.title}
                      </Text>
                    ) : null}
                    {section.items.map(renderRow)}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing[2],
  },
  label: {
    ...text.label,
    color: colors.ink,
  },
  box: {
    height: size.control,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  boxError: {
    borderColor: colors.danger,
  },
  value: {
    ...text.body1,
    color: colors.ink,
  },
  placeholder: {
    color: colors.inkTertiary,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  messageText: {
    ...text.caption,
    color: colors.inkTertiary,
  },
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    height: '80%',
    flexShrink: 1,
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
  sheetTitle: {
    ...text.h2,
    color: colors.ink,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  searchBox: {
    marginHorizontal: spacing[5],
    marginBottom: spacing[2],
    height: size.control,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  searchInput: {
    flex: 1,
    ...text.body1,
    color: colors.ink,
    paddingVertical: 0,
  },
  tabs: {
    marginHorizontal: spacing[5],
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabOn: {
    borderBottomColor: colors.actionText,
  },
  tabLabel: {
    ...text.body1,
    color: colors.inkSecondary,
  },
  tabLabelOn: {
    ...font('700'),
    color: colors.actionText,
  },
  list: {
    flex: 1,
    paddingHorizontal: spacing[5],
  },
  sectionTitle: {
    ...text.caption,
    color: colors.inkSecondary,
    paddingTop: spacing[4],
    paddingBottom: spacing[1],
  },
  empty: {
    ...text.body1,
    color: colors.inkTertiary,
    paddingVertical: spacing[6],
    textAlign: 'center',
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: {
    ...text.body1,
    color: colors.ink,
  },
  rowLabelOn: {
    ...font('700'),
    color: colors.actionText,
  },
});
