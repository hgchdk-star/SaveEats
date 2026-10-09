import * as Clipboard from 'expo-clipboard';

import { mockScenario } from '@/mocks/scenario';

import { ServiceError } from './service-error';

/**
 * 클립보드에 쓴다. 사용자가 복사 버튼을 눌렀을 때만 호출한다 (TRF-007).
 * 화면에 들어올 때나 앱에 돌아올 때 자동으로 복사하지 않고, 클립보드를 읽지도 않는다.
 * 쓰기에 성공했을 때만 성공 토스트를 보여준다.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (mockScenario.clipboardFails) throw new ServiceError('CLIPBOARD_FAILED'); // 개발용 실패 시나리오
  const ok = await Clipboard.setStringAsync(text).catch(() => false);
  if (ok === false) throw new ServiceError('CLIPBOARD_FAILED');
}
