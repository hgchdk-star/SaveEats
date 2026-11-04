import { useState } from 'react';
import { Linking } from 'react-native';

import { SourceNotice } from '@/components/ui/source-notice';
import { SourceSheet } from '@/components/ui/source-sheet';
import { draftCopy } from '@/config/draft-copy';
import { useAsync } from '@/hooks/use-async';
import { storeSourceProvider } from '@/services';
import { isOpenableUrl } from '@/services/store-source/store-source-provider';

/**
 * 가게 상세 모든 탭의 마지막 섹션: 같은 가게의 콘텐츠 출처 안내와 목록 시트 (FR-STORE-015 ~ 020).
 * 시트를 열고 닫는 상태는 여기에만 있어서 가게 상세의 탭·스크롤 위치를 건드리지 않는다.
 *
 * - 불러오는 동안은 아무것도 그리지 않는다(확인 중 문구가 먼저 깜빡이지 않게).
 * - 출처가 없거나 미확인이면 버튼을 숨기고 시트를 열지 않는다.
 * - 조회가 실패하면 "출처 없음"과 다르게 조회 실패 안내와 다시 시도를 보여준다.
 * - 항목을 누르면 그 항목 자신의 URL만 연다. 열지 못해도 시트와 목록은 그대로 두고, 시트 안에 안내를 보여준다
 *   (Modal 위에서는 화면의 토스트가 가려질 수 있어서 시트 안에 둔다).
 * 출처가 없는 콘텐츠를 공개할지는 이 화면이 정하지 않는다 (OPEN-SRC-002).
 */
export function StoreSourceSection({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [open, setOpen] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const sources = useAsync(`store-sources:${storeId}`, () => storeSourceProvider.getStoreSources(storeId));
  if (sources.status === 'loading') return null;

  const items = sources.status === 'ok' && sources.data.status === 'AVAILABLE' ? sources.data.items : [];
  const state = sources.status === 'error' ? 'error' : items.length > 0 ? 'available' : 'unconfirmed';

  const openSource = async (url: string) => {
    setLinkFailed(false);
    try {
      if (!isOpenableUrl(url)) throw new Error('INVALID_URL');
      await Linking.openURL(url);
    } catch {
      setLinkFailed(true);
    }
  };

  const close = () => {
    setOpen(false);
    setLinkFailed(false);
  };

  return (
    <>
      <SourceNotice state={state} onOpen={() => setOpen(true)} onRetry={sources.reload} />
      {state === 'available' ? (
        <SourceSheet
          visible={open}
          storeName={storeName}
          items={items}
          errorMessage={linkFailed ? draftCopy.store.sourceOpenFailed : undefined}
          onClose={close}
          onOpenSource={(url) => void openSource(url)}
        />
      ) : null}
    </>
  );
}
