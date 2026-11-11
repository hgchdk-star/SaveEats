import type { BankItem } from '@/components/ui/bank-list';

/**
 * 계좌 등록에서 고르는 기관 목록 (은행·상호금융·우체국·저축은행·증권사).
 * 코드와 이름은 토스 은행 코드 가이드(https://docs-pay.toss.im/guide/bank-code)의 값을 그대로 쓴다.
 * 이름은 토스 사전입력의 `bank=` 값으로 그대로 쓰인다. 사전입력은 은행별로 확인한 조합만
 * EXPO_PUBLIC_TOSS_PREFILL_VERIFIED에 넣는다 (src/config/toss-capability.ts).
 * 제외: 888 토스머니, 889 토스포인트(은행 계좌가 아니다).
 * 005 KEB하나은행과 081 하나은행, 230과 238 미래에셋증권은 코드가 달라서 각각 둔다. 이름으로 합치지 않는다.
 * 코드는 앞자리 0을 지키는 문자열이다. 서버로 보내지 않고 기기에만 저장한다 (계좌정보는 기기에만 저장한다).
 */
const bank = (bankCode: string, bankName: string, extra: Partial<BankItem> = {}): BankItem => ({ bankCode, bankName, kind: 'bank', ...extra });
const sec = (bankCode: string, bankName: string, aliases: string[] = []): BankItem => ({ bankCode, bankName, kind: 'securities', aliases });

export const BANKS: BankItem[] = [
  // 주요 은행. featuredOrder가 노출 순서다
  bank('092', '토스뱅크', { featuredOrder: 1, aliases: ['토스', 'toss'] }),
  bank('090', '카카오뱅크', { featuredOrder: 2, aliases: ['카카오', '카뱅', 'kakao'] }),
  bank('004', 'KB국민은행', { featuredOrder: 3, aliases: ['국민', '국민은행', 'kb', '케이비'] }),
  bank('088', '신한은행', { featuredOrder: 4 }),
  bank('020', '우리은행', { featuredOrder: 5 }),
  bank('081', '하나은행', { featuredOrder: 6 }),
  bank('011', 'NH농협은행', { featuredOrder: 7, aliases: ['농협', '농협은행', 'nh', '엔에이치'] }),
  bank('003', 'IBK기업은행', { featuredOrder: 8, aliases: ['기업', '기업은행', 'ibk', '아이비케이'] }),
  bank('089', '케이뱅크', { featuredOrder: 9, aliases: ['k뱅크', 'kbank'] }),
  // 그 외 은행·상호금융
  bank('002', 'KDB산업은행', { aliases: ['산업', '산업은행', 'kdb'] }),
  bank('005', 'KEB하나은행', { aliases: ['keb'] }),
  bank('007', '수협은행', { aliases: ['수협'] }),
  bank('023', 'SC은행', { aliases: ['sc제일', '스탠다드차타드'] }),
  bank('027', '씨티은행', { aliases: ['시티', 'citi'] }),
  bank('031', '대구은행', { aliases: ['dgb', 'iM뱅크', '아이엠뱅크'] }),
  bank('032', '부산은행', { aliases: ['bnk'] }),
  bank('034', '광주은행'),
  bank('035', '제주은행'),
  bank('037', '전북은행'),
  bank('039', '경남은행', { aliases: ['bnk'] }),
  bank('045', 'MG새마을금고', { aliases: ['새마을', '새마을금고', 'mg', '엠지'] }),
  bank('048', '신협', { aliases: ['신용협동조합'] }),
  bank('050', '저축은행'),
  bank('064', '산림조합', { aliases: ['산림'] }),
  bank('071', '우체국', { aliases: ['우체국예금', '우정사업본부'] }),
  bank('103', 'SBI저축은행', { aliases: ['sbi', '에스비아이'] }),
  // 증권사
  sec('218', 'KB증권', ['kb', '케이비']),
  sec('230', '미래에셋증권', ['미래에셋']),
  sec('238', '미래에셋증권', ['미래에셋']),
  sec('240', '삼성증권'),
  sec('243', '한국투자증권', ['한투']),
  sec('247', 'NH투자증권', ['nh', '엔에이치', '농협']),
  sec('261', '교보증권'),
  sec('262', '하이투자증권'),
  sec('263', '현대차투자증권', ['현대차', '현대자동차']),
  sec('264', '키움증권'),
  sec('265', '이베스트증권'),
  sec('266', 'SK증권', ['에스케이']),
  sec('267', '대신증권'),
  sec('269', '한화투자증권', ['한화']),
  sec('270', '하나증권'),
  sec('271', '토스증권', ['토스', 'toss']),
  sec('278', '신한투자증권', ['신한']),
  sec('279', 'DB금융투자', ['db', '디비']),
  sec('280', '유진투자', ['유진투자증권']),
  sec('287', '메리츠증권'),
];

/** 예전 앱 버전이 저장한 내부 코드 → 지금 기관 코드 */
const LEGACY_CODES: Record<string, string> = {
  TOSS: '092',
  KAKAO: '090',
  KB: '004',
  SHINHAN: '088',
  WOORI: '020',
  HANA: '081',
  NH: '011',
  IBK: '003',
};

/** 이미 저장된 계좌의 예전 코드를 지금 코드로 읽는다. 알 수 없는 값은 그대로 둔다 */
export function normalizeBankCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return LEGACY_CODES[code] ?? code;
}
