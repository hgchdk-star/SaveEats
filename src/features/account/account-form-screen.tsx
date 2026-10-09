import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BankSelectField } from '@/components/ui/bank-select-field';
import { CtaBar } from '@/components/ui/cta-bar';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { showToast } from '@/features/toast/toast-store';
import { accountService } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

const copy = draftCopy.account;

export type AccountFormParams = { mode: 'register' | 'change'; from: 'order' | 'manage' };

/**
 * 계좌 등록·변경 입력: 은행 + 계좌번호만 받는다. 예금주·본인 확인은 없다 (미결정 묶음2 #3).
 *
 * 계좌번호는 이 화면의 state에만 있다. 저장·로그·분석 이벤트에 넣지 않고, 서버로 보낸 직후 지운다.
 * 서버가 전체 번호를 어떻게 보관·암호화할지는 아직 정해지지 않았다 (OPEN-DB-001).
 */
export function AccountFormScreen({ mode, from }: AccountFormParams) {
  const { destinationAccount } = useSession();
  const change = mode === 'change';
  const banks = accountService.listBanks();

  const [bankCode, setBankCode] = useState<string | null>(change ? (destinationAccount?.bankCode ?? null) : null);
  const [bankName, setBankName] = useState<string | null>(change ? (destinationAccount?.bankName ?? null) : null);
  const [accountNumber, setAccountNumber] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const numberTooShort = accountNumber.length < LIMITS.accountNumberMinLength;

  const save = async () => {
    if (busy) return;
    if (!bankCode || !bankName || numberTooShort) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      await accountService.registerDestinationAccount({ bankCode, bankName, accountNumber, mode });
    } catch {
      // 저장하지 못했다. 입력한 내용은 그대로 둔다
      setBusy(false);
      setFailed(true);
      return;
    }
    setAccountNumber('');
    setBusy(false);
    if (!change) {
      router.replace({ pathname: '/account/done', params: { from } });
      return;
    }
    // 변경: 온 곳(최종 주문 확인 또는 계좌 화면)으로 돌아가 다시 확인한다
    router.back();
    showToast({ message: copy.toastChanged });
  };

  return (
    <Screen
      avoidKeyboard
      top={<TopNavigation divider title={change ? copy.formTitleChange : copy.formTitleRegister} onBack={() => router.back()} leadingDisabled={busy} />}
      bottom={<CtaBar label={change ? copy.ctaChange : copy.ctaRegister} loading={busy} onPress={() => void save()} />}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          {change ? copy.formHeadingChange : copy.formHeadingRegister}
        </Text>

        {failed ? <Notice flush tone="danger" title={copy.saveFailedTitle} description={copy.saveFailedDesc} /> : null}

        <View style={styles.fields}>
          <BankSelectField
            label={copy.bankLabel}
            placeholder={copy.bankPlaceholder}
            sheetTitle={copy.bankSheetTitle}
            banks={banks}
            selectedCode={bankCode}
            error={showErrors && !bankCode ? copy.bankError : undefined}
            disabled={busy}
            onSelect={(bank) => {
              setBankCode(bank.bankCode);
              setBankName(bank.bankName);
            }}
          />
          <TextInput
            label={copy.numberLabel}
            value={accountNumber}
            onChangeText={(v) => setAccountNumber(v.replace(/[^0-9]/g, ''))}
            placeholder={copy.numberPlaceholder}
            helper={copy.numberHelp}
            keyboardType="number-pad"
            maxLength={20}
            returnKeyType="done"
            error={showErrors && numberTooShort ? copy.numberError : undefined}
            disabled={busy}
          />
        </View>

        <Text style={styles.help}>{copy.maskGuide}</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[5],
  },
  heading: {
    ...text.h2,
    color: colors.ink,
  },
  fields: {
    gap: spacing[4],
  },
  help: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
});
