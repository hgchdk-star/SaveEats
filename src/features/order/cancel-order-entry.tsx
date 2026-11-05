import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { TextButton } from '@/components/ui/button';
import { draftCopy } from '@/config/draft-copy';

import { cancelOrder } from './order-actions';

const copy = draftCopy.result;

/**
 * 주문 취소 진입점: '주문 취소' 보조 텍스트 버튼과 확인 시트 (ORD-009 제안 문구).
 * 완료 확인 질문 화면과 직접 이어가기 화면이 같은 것을 쓴다. 취소는 SaveEats 주문 기록을 취소하는 것이지 송금 취소가 아니다.
 * 시트에서 확인하면 cancelOrder(서버 CANCELLED 저장 → 취소 화면)를 그대로 부른다. 새 화면은 없다.
 * 완료 확인 저장 중이거나 저장 실패일 때, 취소 확인이 걸려 있을 때 이 버튼을 보일지는 화면이 정한다.
 */
export function CancelOrderEntry({ disabled = false }: { disabled?: boolean }) {
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <View style={styles.centered}>
        <TextButton size="sm" disabled={disabled} onPress={() => setSheet(true)}>
          {copy.cancelOrder}
        </TextButton>
      </View>
      <ConfirmSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={copy.cancelSheetTitle}
        descriptions={[copy.cancelSheetDesc]}
        secondary={{ label: copy.cancelSheetBack, onPress: () => setSheet(false) }}
        primary={{
          label: copy.cancelSheetConfirm,
          onPress: () => {
            setSheet(false);
            void cancelOrder();
          },
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
  },
});
