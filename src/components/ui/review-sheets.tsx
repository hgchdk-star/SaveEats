import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { colors, font, radius, shadow, spacing, text } from '@/theme';

import { SecondaryButton } from './button';
import { Icon, type IconName } from './icon';

const copy = draftCopy.review;

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable accessibilityLabel="닫기" accessibilityRole="button" style={styles.dim} onPress={onClose} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + spacing[5] }]}>
          <View style={styles.handle} />
          {title ? (
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** 리뷰 정렬 시트: 최신순 · 리뷰 도움순 · 땡김도 높은 순 · 땡김도 낮은 순 ("별점" 표현 없음) */
export function ReviewSortSheet<Id extends string>({
  visible,
  value,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: Id;
  options: readonly { id: Id; label: string }[];
  onSelect: (id: Id) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={copy.sortSheetTitle}>
      <View accessibilityRole="radiogroup" style={styles.list}>
        {options.map((option) => {
          const on = option.id === value;
          return (
            <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onSelect(option.id)} style={styles.row}>
              <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{option.label}</Text>
              {on ? <Icon name="check" size={20} color={colors.actionText} strokeWidth={2.25} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** 내 리뷰 ⋮ 시트: 리뷰 수정 / 리뷰 삭제 / 취소. 수정·삭제 버튼을 카드에 직접 노출하지 않으려고 시트로 연다 */
export function ReviewActionSheet({ visible, onEdit, onDelete, onClose }: { visible: boolean; onEdit: () => void; onDelete: () => void; onClose: () => void }) {
  const action = (icon: IconName, label: string, onPress: () => void, danger = false) => (
    <Pressable accessibilityRole="menuitem" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
      <Icon name={icon} size={20} color={danger ? colors.danger : colors.ink} />
      <Text style={[styles.actionLabel, danger && styles.actionDanger]}>{label}</Text>
    </Pressable>
  );
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View accessibilityRole="menu" accessibilityLabel={copy.moreOpen} style={styles.actions}>
        {action('edit', copy.manageEdit, onEdit)}
        {action('trash', copy.manageDelete, onDelete, true)}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
          <Text style={styles.cancelText}>{copy.manageCancel}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * 리뷰 삭제 확인. 한 번 눌러 바로 지우지 않는다.
 * 주문 완료 후 30일이 지난 리뷰는 "삭제하면 이 주문에는 리뷰를 다시 작성할 수 없어요."를 더한다.
 */
export function ReviewDeleteSheet({
  visible,
  pastWindow,
  deleting,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  pastWindow: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={deleting ? () => undefined : onCancel}>
      <View accessibilityRole="alert" style={styles.confirm}>
        <Text style={styles.confirmTitle}>{confirmedCopy.reviewDeleteTitle}</Text>
        <Text style={styles.confirmDesc}>{confirmedCopy.reviewDeleteDesc}</Text>
        {pastWindow ? (
          <View style={styles.warn}>
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={styles.warnText}>{confirmedCopy.reviewDeleteWarnPastWindow}</Text>
          </View>
        ) : null}
        <View style={styles.confirmButtons}>
          <View style={styles.half}>
            <SecondaryButton block disabled={deleting} onPress={onCancel}>
              {copy.manageCancel}
            </SecondaryButton>
          </View>
          <View style={styles.half}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: deleting, disabled: deleting }}
              disabled={deleting}
              onPress={onConfirm}
              style={({ pressed }) => [styles.danger, pressed && styles.dangerPressed]}>
              <Text style={styles.dangerText}>{deleting ? copy.deleting : copy.deleteConfirm}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Sheet>
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
  title: {
    ...text.h2,
    color: colors.ink,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
  },
  list: {
    paddingHorizontal: spacing[5],
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
  actions: {
    paddingTop: spacing[2],
  },
  action: {
    minHeight: 56,
    paddingHorizontal: spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  actionPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  actionLabel: {
    ...font('500'),
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  actionDanger: {
    color: colors.danger,
  },
  cancel: {
    minHeight: 48,
    marginHorizontal: spacing[5],
    marginTop: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    ...font('600'),
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkSecondary,
  },
  confirm: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
  },
  confirmTitle: {
    ...text.h2,
    color: colors.ink,
  },
  confirmDesc: {
    ...text.body2,
    color: colors.inkSecondary,
    marginTop: spacing[1],
  },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing[3],
  },
  warnText: {
    ...font('600'),
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
    flexShrink: 1,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[6],
  },
  half: {
    flex: 1,
  },
  danger: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerPressed: {
    backgroundColor: colors.tomato800,
  },
  dangerText: {
    ...font('700'),
    fontSize: 16,
    lineHeight: 24,
    color: colors.onBrand,
  },
});
