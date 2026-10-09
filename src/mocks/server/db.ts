import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MockReview } from '@/mocks/history/types';
import type { MockOrder, MockOrderStatus } from '@/mocks/order/types';

import { buildSeed } from './seed';

/**
 * 개발용 Mock 서버의 저장소.
 *
 * 실제 서버가 하는 일(주문·상태 이력·리뷰 보관)을 앱 안에서 흉내 내려고 한 곳에 모았다.
 * 앱을 껐다 켜도 남도록 기기에 저장해서, "앱 재시작 후 복구"를 서버 없이 확인할 수 있다.
 * 계좌번호 원문은 어디에도 없다. 실제 서버(Supabase)가 붙으면 이 폴더 전체가 필요 없어진다.
 */
const STORAGE_KEY = 'saveeats.mock.server.v1';
/** 가상 데이터 모양을 바꾸면 올린다. 다르면 새로 만든다 */
export const SEED_VERSION = 1;

/** 로그인한 가상 사용자. 리뷰의 isMine·도움돼요 계산에 쓴다 */
export const CURRENT_USER_ID = 'mock-user-1';

/** 주문 상태 이력 한 건 (DB-007) */
export type ServerEvent = {
  eventId: string;
  orderId: string;
  revision: number;
  fromStatus: MockOrderStatus | null;
  toStatus: MockOrderStatus;
  createdAt: string;
  viewedAt: string | null;
};

/** 서버가 보관하는 리뷰. 공개할 때 isMine·myHelpful·helpfulCount를 계산해서 MockReview로 바꾼다 */
export type ReviewRecord = Omit<MockReview, 'isMine' | 'myHelpful' | 'helpfulCount'> & {
  authorId: string;
  /** 시드로 넣은 다른 사용자들의 도움돼요 수 */
  helpfulBase: number;
  /** 이 가상 사용자들이 눌렀다 */
  helpfulVoters: string[];
};

export type ServerDb = {
  seedVersion: number;
  seq: number;
  orders: MockOrder[];
  /** idempotencyKey → orderId */
  byKey: Record<string, string>;
  /** operationId → 명령 종류 (같은 명령 재시도를 알아보려는 용도) */
  operations: Record<string, string>;
  events: ServerEvent[];
  reviews: ReviewRecord[];
  /** 검증이 끝난 업로드 */
  uploads: Record<string, { imageRef: string; used: boolean }>;
};

let db: ServerDb | null = null;
let loading: Promise<ServerDb> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<ServerDb> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ServerDb;
      if (parsed.seedVersion === SEED_VERSION) return parsed;
    }
  } catch {
    // 읽지 못하면 새로 만든다 (가상 데이터라 잃어도 된다)
  }
  const fresh = buildSeed(Date.now());
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)).catch(() => undefined);
  return fresh;
}

export function getDb(): Promise<ServerDb> {
  if (db) return Promise.resolve(db);
  loading ??= load().then((loaded) => {
    db = loaded;
    return loaded;
  });
  return loading;
}

/** 바뀐 내용을 곧 저장한다. 연달아 바뀌면 한 번에 모아서 쓴다 */
export function persistDb(): void {
  if (!db) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(db)).catch(() => undefined);
  }, 150);
}

export function nextSeq(state: ServerDb): number {
  state.seq += 1;
  return state.seq;
}

/** 주문 상태가 바뀔 때마다 이력을 남긴다. 처음 만든 PENDING은 from이 null이다 */
export function recordEvent(state: ServerDb, order: MockOrder, from: MockOrderStatus | null, at: string): void {
  state.events.push({
    eventId: `ev-${order.orderId}-${order.statusRevision}`,
    orderId: order.orderId,
    revision: order.statusRevision,
    fromStatus: from,
    toStatus: order.status,
    createdAt: at,
    viewedAt: null,
  });
}
