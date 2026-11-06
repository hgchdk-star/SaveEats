import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSession } from '@/services/session';

/**
 * 완료 확인 큐 (ORD-010). '주문 완료했어요'를 서버로 보내기 전에 이 기기에 먼저 남기는 기록이다.
 * 서버에 저장하지 못했어도 사용자가 완료했다는 의도가 사라지지 않게 한다. 계좌 원문·딥링크·비밀번호는 담지 않는다.
 *
 * 사용자·주문마다 키가 하나다(`...v3:<uid>:<orderId>`). 한 주문의 저장·삭제는 다른 주문의 키를 건드리지 않으므로,
 * 읽고-고쳐-쓰는 과정이 없어 동시에 저장해도 서로 덮어쓰지 않는다.
 * 계정이 바뀌는 사이에 끝나는 비동기 작업은 시작할 때 잡아 둔 owner를 넘겨서 원래 사용자의 키만 다룬다.
 *
 * 읽지 못한 것과 없는 것을 구분한다(UNREADABLE). 읽지 못했을 때 대기가 없다고 단정하면 이미 완료를 확인한 주문에 송금 흐름이 다시 열린다.
 * 값이 손상돼도 키가 남아 있으면 그 주문은 대기 중으로 본다. 이때 operationId는 null이고, 서버가 같은 완료 명령을 멱등 처리하므로 새 번호로 보낸다.
 *
 * 이전 형식(v2)은 사용자당 한 건짜리 키였다. 읽을 때 v3 키로 옮긴 뒤 지운다. 해석할 수 없는 v2 값은 어느 주문의 것인지 몰라 지우지 않고 UNREADABLE로 둔다.
 */
const LEGACY_BASE = 'saveeats.order.confirmQueue.v2';
const BASE = 'saveeats.order.confirmQueue.v3';

export type ConfirmQueueEntry = {
  version: 2;
  ownerUid: string;
  orderId: string;
  /** 같은 주문의 재시도에 그대로 쓰는 번호. 기록이 손상돼 알 수 없으면 null */
  operationId: string | null;
  kind: 'CONFIRM';
  phase: 'QUEUED' | 'SYNCING' | 'SAVE_FAILED';
  createdLocallyAt: string;
  attemptCount: number;
  lastErrorCode: string | null;
};

export type ConfirmEntryRead = { status: 'NONE' } | { status: 'QUEUED'; entry: ConfirmQueueEntry } | { status: 'UNREADABLE' };
export type ConfirmListRead = { status: 'OK'; entries: ConfirmQueueEntry[] } | { status: 'UNREADABLE' };

/** 지금 로그인한 사용자. 키를 정하는 기준이고, 비동기 작업은 시작할 때 이 값을 잡아 둔다 */
export const confirmQueueOwner = (): string => getSession().userId ?? 'guest';

const prefixOf = (owner: string) => `${BASE}:${owner}:`;
const entryKey = (owner: string, orderId: string) => `${prefixOf(owner)}${orderId}`;
const legacyKey = (owner: string) => `${LEGACY_BASE}:${owner}`;

const damagedEntry = (owner: string, orderId: string): ConfirmQueueEntry => ({
  version: 2,
  ownerUid: owner,
  orderId,
  operationId: null,
  kind: 'CONFIRM',
  phase: 'SAVE_FAILED',
  createdLocallyAt: '',
  attemptCount: 0,
  lastErrorCode: null,
});

function parseEntry(raw: string, owner: string, orderId: string): ConfirmQueueEntry {
  try {
    const parsed = JSON.parse(raw) as Partial<ConfirmQueueEntry> | null;
    if (parsed?.version === 2 && parsed.orderId === orderId && typeof parsed.operationId === 'string') return parsed as ConfirmQueueEntry;
  } catch {
    // 아래에서 손상된 기록으로 다룬다
  }
  return damagedEntry(owner, orderId);
}

/** v2 한 건을 v3로 옮긴다. 이미 옮긴 값이 있으면 덮어쓰지 않는다. 읽기·쓰기 실패나 해석할 수 없는 값이면 던지고 v2를 남긴다 */
async function migrateLegacy(owner: string): Promise<void> {
  const raw = await AsyncStorage.getItem(legacyKey(owner));
  if (!raw) return;
  const old = JSON.parse(raw) as { version?: number; orderId?: unknown; operationId?: unknown; createdLocallyAt?: unknown; attemptCount?: unknown; lastErrorCode?: unknown; phase?: unknown } | null;
  if (old?.version !== 1 || typeof old.orderId !== 'string' || !old.orderId || typeof old.operationId !== 'string' || !old.operationId) {
    throw new Error('unreadable legacy confirm queue');
  }
  const target = entryKey(owner, old.orderId);
  if ((await AsyncStorage.getItem(target)) === null) {
    const entry: ConfirmQueueEntry = {
      version: 2,
      ownerUid: owner,
      orderId: old.orderId,
      operationId: old.operationId,
      kind: 'CONFIRM',
      phase: old.phase === 'QUEUED' || old.phase === 'SYNCING' || old.phase === 'SAVE_FAILED' ? old.phase : 'QUEUED',
      createdLocallyAt: typeof old.createdLocallyAt === 'string' ? old.createdLocallyAt : '',
      attemptCount: typeof old.attemptCount === 'number' ? old.attemptCount : 1,
      lastErrorCode: typeof old.lastErrorCode === 'string' ? old.lastErrorCode : null,
    };
    await AsyncStorage.setItem(target, JSON.stringify(entry));
  }
  // 지우지 못해도 다음에 같은 값을 다시 옮기려 할 뿐이다. 이미 처리된 주문이면 복구가 서버 상태를 보고 정리한다
  await AsyncStorage.removeItem(legacyKey(owner)).catch(() => undefined);
}

/** 이 주문의 완료 확인 대기를 읽는다 */
export async function readConfirmEntry(orderId: string, owner: string = confirmQueueOwner()): Promise<ConfirmEntryRead> {
  try {
    await migrateLegacy(owner);
    const raw = await AsyncStorage.getItem(entryKey(owner, orderId));
    return raw === null ? { status: 'NONE' } : { status: 'QUEUED', entry: parseEntry(raw, owner, orderId) };
  } catch {
    return { status: 'UNREADABLE' };
  }
}

/** 이 사용자의 완료 확인 대기를 모두 읽는다 */
export async function listConfirmEntries(owner: string = confirmQueueOwner()): Promise<ConfirmListRead> {
  try {
    await migrateLegacy(owner);
    const prefix = prefixOf(owner);
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
    const entries = await Promise.all(
      keys.map(async (key) => {
        const orderId = key.slice(prefix.length);
        const raw = await AsyncStorage.getItem(key);
        return raw === null ? null : parseEntry(raw, owner, orderId);
      }),
    );
    return { status: 'OK', entries: entries.filter((entry): entry is ConfirmQueueEntry => entry !== null) };
  } catch {
    return { status: 'UNREADABLE' };
  }
}

/** 저장에 실패하면 던진다. 저장이 끝난 것처럼 보여주면 안 된다 */
export async function saveConfirmEntry(entry: Omit<ConfirmQueueEntry, 'version' | 'ownerUid' | 'kind'>, owner: string = confirmQueueOwner()): Promise<void> {
  const value: ConfirmQueueEntry = { ...entry, version: 2, ownerUid: owner, kind: 'CONFIRM' };
  await AsyncStorage.setItem(entryKey(owner, entry.orderId), JSON.stringify(value));
}

/** 이 주문의 기록만 지운다. 실패해도 다음 복구가 서버 상태를 보고 같은 operationId로 안전하게 정리한다 */
export async function removeConfirmEntry(orderId: string, owner: string = confirmQueueOwner()): Promise<void> {
  await AsyncStorage.removeItem(entryKey(owner, orderId)).catch(() => undefined);
}
