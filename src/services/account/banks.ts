import type { MockBank } from '@/mocks/order/types';

/** 은행 목록 예시. 은행 코드는 앱 안의 선택용 값이고 서버로 보내지 않는다 (계좌정보는 기기에만 저장한다) */
export const BANKS: MockBank[] = [
  { bankCode: 'TOSS', bankName: '토스뱅크' },
  { bankCode: 'KAKAO', bankName: '카카오뱅크' },
  { bankCode: 'KB', bankName: 'KB국민은행' },
  { bankCode: 'SHINHAN', bankName: '신한은행' },
  { bankCode: 'WOORI', bankName: '우리은행' },
  { bankCode: 'HANA', bankName: '하나은행' },
  { bankCode: 'NH', bankName: 'NH농협은행' },
  { bankCode: 'IBK', bankName: 'IBK기업은행' },
];
