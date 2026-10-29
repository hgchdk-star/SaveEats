import { createLocalId } from '@/utils/id';

import type { SecureKeyValueStore } from './secure-store';

/**
 * AccountVault: 돈을 받을 계좌를 이 기기의 보안 저장소에만 둔다 (기획서 v1.3 10.3.1, 개발 명세 DB-003).
 *
 * - 은행·계좌번호·마스킹·계좌 암호문을 서버, 일반 저장소(AsyncStorage), 로그, 분석에 보내거나 남기지 않는다.
 * - 사용자(uid)마다 키가 다르다. 다른 uid의 자료는 읽을 수도 지울 수도 없고, 꺼낸 자료의 ownerUid가 다르면 쓰지 않는다.
 * - 쓰기는 한 줄로 차례대로 한다(직렬 writer). 저장과 삭제는 다시 읽어 확인하고, 확인하지 못하면 실패로 던진다.
 *   삭제에 실패했는데 삭제된 것처럼 보이면 안 된다.
 * - 화면과 세션에 올라가는 값(VaultAccountView)에는 계좌번호 원문이 없다. 원문은 readCurrentAccountNumber로만 읽는다.
 *   (송금 이어가기에서 사용자가 복사할 때 읽는 용도. 아직 화면에 연결하지 않았다.)
 *
 * 정해지지 않은 것: 로그아웃 후 원문을 남길지(OPEN-DB-002), 과거 주문의 목적지 원문 보관 기간, iOS 접근 수준, 생체인증 필수 여부.
 * 이 파일은 그중 어느 것도 정하지 않는다.
 */

export type VaultAccountView = {
  /** 계좌 값에서 만들지 않은 무작위 참조. 계좌를 바꾸면 새 값이 된다. 소유 증명이나 검증 토큰이 아니다 */
  destinationRef: string;
  /** 이 기기에서 계좌를 바꾼 횟수 + 1 */
  revision: number;
  bankCode: string;
  bankName: string;
  last4: string;
};

export type AccountInput = { bankCode: string; bankName: string; accountNumber: string };

export type AccountVaultErrorCode =
  /** 보안 저장소를 읽거나 쓰거나 지우지 못했거나, 쓴 뒤 다시 읽은 값이 다르다 */
  | 'STORAGE_FAILED'
  /** 저장된 자료를 해석할 수 없거나 다른 사용자의 것이다 */
  | 'UNREADABLE'
  | 'INVALID_INPUT'
  | 'ALREADY_REGISTERED';

export class AccountVaultError extends Error {
  readonly code: AccountVaultErrorCode;
  constructor(code: AccountVaultErrorCode) {
    // 메시지에 계좌 값이나 원래 오류 내용을 담지 않는다
    super(code);
    this.name = 'AccountVaultError';
    this.code = code;
  }
}

export interface AccountVault {
  /** 이 사용자의 현재 계좌(원문 없음). 없으면 null */
  getCurrent(ownerUid: string): Promise<VaultAccountView | null>;
  /** 처음 등록. 이미 있으면 ALREADY_REGISTERED */
  register(ownerUid: string, input: AccountInput): Promise<VaultAccountView>;
  /** 변경. 새 destinationRef를 만들고 revision을 올린다. 없으면 처음 등록과 같다 */
  replace(ownerUid: string, input: AccountInput): Promise<VaultAccountView>;
  /** 삭제하고 지워졌는지 다시 확인한다. 이미 없으면 그대로 성공 */
  delete(ownerUid: string): Promise<void>;
  /** 계좌번호 원문. 사용자가 복사하는 순간에만 부른다. 없으면 null */
  readCurrentAccountNumber(ownerUid: string): Promise<string | null>;
}

type StoredAccount = {
  schemaVersion: 1;
  ownerUid: string;
  destinationRef: string;
  revision: number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  last4: string;
};

const KEY_PREFIX = 'saveeats.destination.v1.';
/** SecureStore 키에는 영문·숫자와 . - _ 만 쓸 수 있다. 다른 문자는 바꾸지 않고 거절한다(서로 다른 uid가 같은 키가 되지 않게) */
const UID_PATTERN = /^[A-Za-z0-9._-]+$/;

function keyFor(ownerUid: string): string {
  if (!UID_PATTERN.test(ownerUid)) throw new AccountVaultError('INVALID_INPUT');
  return `${KEY_PREFIX}${ownerUid}`;
}

function validate(input: AccountInput): void {
  const ok = !!input.bankCode && !!input.bankName && /^[0-9]+$/.test(input.accountNumber) && input.accountNumber.length >= 4;
  if (!ok) throw new AccountVaultError('INVALID_INPUT');
}

function parse(raw: string, ownerUid: string): StoredAccount {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AccountVaultError('UNREADABLE');
  }
  const v = value as Partial<StoredAccount> | null;
  const ok =
    !!v &&
    typeof v === 'object' &&
    v.schemaVersion === 1 &&
    v.ownerUid === ownerUid &&
    typeof v.destinationRef === 'string' &&
    typeof v.revision === 'number' &&
    typeof v.bankCode === 'string' &&
    typeof v.bankName === 'string' &&
    typeof v.accountNumber === 'string' &&
    typeof v.last4 === 'string';
  if (!ok) throw new AccountVaultError('UNREADABLE');
  return v as StoredAccount;
}

function toView(s: StoredAccount): VaultAccountView {
  return { destinationRef: s.destinationRef, revision: s.revision, bankCode: s.bankCode, bankName: s.bankName, last4: s.last4 };
}

export function createAccountVault(store: SecureKeyValueStore, newRef: () => string = createLocalId): AccountVault {
  // 한 번에 하나씩: 앞 작업이 끝나야 다음 작업이 시작된다. 앞 작업이 실패해도 다음 작업은 진행한다
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  async function io<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof AccountVaultError) throw error;
      throw new AccountVaultError('STORAGE_FAILED');
    }
  }

  async function read(ownerUid: string): Promise<StoredAccount | null> {
    const key = keyFor(ownerUid);
    const raw = await io(() => store.get(key));
    return raw === null ? null : parse(raw, ownerUid);
  }

  async function write(ownerUid: string, next: StoredAccount): Promise<VaultAccountView> {
    const key = keyFor(ownerUid);
    const text = JSON.stringify(next);
    await io(() => store.set(key, text));
    // 쓴 값을 다시 읽어 같은지 확인한다. 읽기 확인에 실패하면 저장된 것으로 보지 않는다
    const back = await io(() => store.get(key));
    if (back !== text) throw new AccountVaultError('STORAGE_FAILED');
    return toView(next);
  }

  function build(ownerUid: string, input: AccountInput, revision: number): StoredAccount {
    return {
      schemaVersion: 1,
      ownerUid,
      destinationRef: newRef(),
      revision,
      bankCode: input.bankCode,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      last4: input.accountNumber.slice(-4),
    };
  }

  return {
    getCurrent: (ownerUid) =>
      serial(async () => {
        const current = await read(ownerUid);
        return current ? toView(current) : null;
      }),

    register: (ownerUid, input) =>
      serial(async () => {
        validate(input);
        if (await read(ownerUid)) throw new AccountVaultError('ALREADY_REGISTERED');
        return write(ownerUid, build(ownerUid, input, 1));
      }),

    replace: (ownerUid, input) =>
      serial(async () => {
        validate(input);
        // 저장된 자료가 깨져 있어도 새 계좌로 덮어쓸 수 있어야 한다(그렇지 않으면 영영 등록할 수 없다). 읽기 실패는 그대로 던진다
        let current: StoredAccount | null = null;
        try {
          current = await read(ownerUid);
        } catch (error) {
          if (!(error instanceof AccountVaultError && error.code === 'UNREADABLE')) throw error;
        }
        return write(ownerUid, build(ownerUid, input, current ? current.revision + 1 : 1));
      }),

    delete: (ownerUid) =>
      serial(async () => {
        const key = keyFor(ownerUid);
        await io(() => store.remove(key));
        // 정말 지워졌는지 확인한다. 남아 있으면 삭제 실패다
        const left = await io(() => store.get(key));
        if (left !== null) throw new AccountVaultError('STORAGE_FAILED');
      }),

    readCurrentAccountNumber: (ownerUid) =>
      serial(async () => {
        const current = await read(ownerUid);
        return current ? current.accountNumber : null;
      }),
  };
}
