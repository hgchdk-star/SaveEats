import { useState } from 'react';
import { Linking } from 'react-native';

import { SourceNotice } from '@/components/ui/source-notice';
import { SourceSheet } from '@/components/ui/source-sheet';
import { draftCopy } from '@/config/draft-copy';
import { showToast } from '@/features/toast/toast-store';
import { useAsync } from '@/hooks/use-async';
import { storeSourceProvider } from '@/services';
import { isOpenableUrl } from '@/services/store-source/store-source-provider';

/**
 * 가게 상세 모든 탭의 마지막 섹션: 같은 가게의 콘텐츠 출처 안내와 목록 시트 (FR-STORE-015 ~ 020).
 * 시트를 열고 닫는 상태는 여기에만 있어서 가게 상세의 탭·스크롤 위치를 건드리지 않는다.
 *
 * - 불러오는 동안은 아무것도 그리지 않는다(확인 중 문구가 먼저 깜빡이지 않게).
 * - 출처가 없거나 미확인이면 버튼을 숨기고 시트를 열지 않는다. 불러오기에 실패한 경우도 같은 상태로 둔다.
 *   TODO(OPEN-SRC-003): 조회 실패를 사용자에게 어떻게 알릴지는 정해지지 않았다.
 * - 항목을 누르면 그 항목 자신의 URL만 연다. 열지 못하면 토스트로 알리고 시트는 그대로 둔다.
 */
export function StoreSourceSection({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [open, setOpen] = useState(false);
  const sources = useAsync(`store-sources:${storeId}`, () => storeSourceProvider.getStoreSources(storeId));
  if (sources.status === 'loading') return null;

  const items = sources.status === 'ok' && sources.data.status === 'AVAILABLE' ? sources.data.items : [];
  const available = items.length > 0;

  const openSource = async (url: string) => {
    try {
      if (!isOpenableUrl(url)) throw new Error('INVALID_URL');
      await Linking.openURL(url);
    } catch {
      showToast({ message: draftCopy.store.sourceOpenFailed, tone: 'error' });
    }
  };

  return (
    <>
      <SourceNotice available={available} onOpen={() => setOpen(true)} />
      {available ? <SourceSheet visible={open} storeName={storeName} items={items} onClose={() => setOpen(false)} onOpenSource={(url) => void openSource(url)} /> : null}
    </>
  );
}
