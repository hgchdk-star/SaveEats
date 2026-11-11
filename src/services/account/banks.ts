import type { MockBank } from '@/mocks/order/types';

/**
 * 계좌 등록에서 고르는 은행 목록.
 * 은행 이름은 토스 은행 코드 가이드(https://docs-pay.toss.im/guide/bank-code)의 이름과 같게 적었다. 토스 사전입력의 `bank=` 값으로 그대로 쓰인다.
 * 그 표는 토스 결제용 가이드라서 비공식 딥링크(supertoss://send)의 `bank=`를 보장하지 않는다. 사전입력은 은행별로 확인한 조합만
 * EXPO_PUBLIC_TOSS_PREFILL_VERIFIED에 넣는다(src/config/toss-capability.ts).
 * 제외한 항목: 토스머니(888)·토스포인트(889)는 은행 계좌가 아니고, KEB하나은행(005)은 하나은행(081)과 같은 은행이며,
 * 미래에셋증권(238)은 230과 이름이 같아 하나만 둔다.
 * 처음 8개는 기존 코드 값을 유지한다(이미 저장된 계좌의 선택 표시를 깨지 않으려고). 나머지는 토스 은행 코드를 쓴다.
 * 은행 코드는 앱 안의 선택용 값이고 서버로 보내지 않는다 (계좌정보는 기기에만 저장한다).
 */
export const BANKS: MockBank[] = [
  { bankCode: 'TOSS', bankName: '토스뱅크' },
  { bankCode: 'KAKAO', bankName: '카카오뱅크' },
  { bankCode: 'KB', bankName: 'KB국민은행' },
  { bankCode: 'SHINHAN', bankName: '신한은행' },
  { bankCode: 'WOORI', bankName: '우리은행' },
  { bankCode: 'HANA', bankName: '하나은행' },
  { bankCode: 'NH', bankName: 'NH농협은행' },
  { bankCode: 'IBK', bankName: 'IBK기업은행' },
  { bankCode: '002', bankName: 'KDB산업은행' },
  { bankCode: '007', bankName: '수협은행' },
  { bankCode: '023', bankName: 'SC은행' },
  { bankCode: '027', bankName: '씨티은행' },
  { bankCode: '031', bankName: '대구은행' },
  { bankCode: '032', bankName: '부산은행' },
  { bankCode: '034', bankName: '광주은행' },
  { bankCode: '035', bankName: '제주은행' },
  { bankCode: '037', bankName: '전북은행' },
  { bankCode: '039', bankName: '경남은행' },
  { bankCode: '045', bankName: 'MG새마을금고' },
  { bankCode: '048', bankName: '신협' },
  { bankCode: '050', bankName: '저축은행' },
  { bankCode: '064', bankName: '산림조합' },
  { bankCode: '071', bankName: '우체국' },
  { bankCode: '089', bankName: '케이뱅크' },
  { bankCode: '103', bankName: 'SBI저축은행' },
  { bankCode: '218', bankName: 'KB증권' },
  { bankCode: '230', bankName: '미래에셋증권' },
  { bankCode: '240', bankName: '삼성증권' },
  { bankCode: '243', bankName: '한국투자증권' },
  { bankCode: '247', bankName: 'NH투자증권' },
  { bankCode: '261', bankName: '교보증권' },
  { bankCode: '262', bankName: '하이투자증권' },
  { bankCode: '263', bankName: '현대차투자증권' },
  { bankCode: '264', bankName: '키움증권' },
  { bankCode: '265', bankName: '이베스트증권' },
  { bankCode: '266', bankName: 'SK증권' },
  { bankCode: '267', bankName: '대신증권' },
  { bankCode: '269', bankName: '한화투자증권' },
  { bankCode: '270', bankName: '하나증권' },
  { bankCode: '271', bankName: '토스증권' },
  { bankCode: '278', bankName: '신한투자증권' },
  { bankCode: '279', bankName: 'DB금융투자' },
  { bankCode: '280', bankName: '유진투자' },
  { bankCode: '287', bankName: '메리츠증권' },
];
