/**
 * 기준 문서에 원문이 있는 확정 문구. 문구를 바꾸려면 기준 문서가 먼저 바뀌어야 한다.
 * 문서에 없는 문구는 draft-copy.ts에 둔다.
 */
export const confirmedCopy = {
  /** 기획서 19 · ORD-004 최종 고지. 온보딩을 건너뛰어도 항상 보여준다 (FR-ORD-008) */
  disclosureTitle: '음식은 주문되지 않아요.',
  disclosureBody: (amountLabel: string) => `주문금액 ${amountLabel}이 등록한 계좌로 이동합니다.`,

  /** 기획서 10.1 계좌 필요 시트 */
  needAccountTitle: '돈을 배달받을 계좌가 필요해요',
  needAccountDesc: '주문금액이 도착할 계좌를 등록해주세요.',
  needAccountAction: '계좌 등록하기',

  /** TRF-006 대표 카피. 원인을 단정하지 않는다 ("설치되지 않았어요" 금지) */
  tossLaunchFailed: '토스를 열지 못했어요. 아래 정보를 확인하고 사용 중인 금융앱에서 이어가주세요.',

  /** TRF-007 직접 이어가기 안내와 복사 결과 */
  directGuide: '사용 중인 금융앱에서 주문금액을 이 계좌로 보내주세요. 완료한 뒤 SaveEats로 돌아와주세요.',
  copiedAccount: '계좌번호를 복사했어요.',
  copiedAmount: '금액을 복사했어요.',

  /** TRF-008 복귀 후 질문과 조회 실패 */
  returnQuestion: '주문을 완료하셨나요?',
  statusQueryFailedTitle: '주문 상태를 확인하지 못했어요.',

  /** ORD-010 완료 확인 저장 실패. 송금 실패가 아니고, 다시 송금하라는 안내도 아니다 */
  confirmSaveFailedSub: '송금을 이미 완료했다면 다시 송금하지 마세요.',
  confirmSaveRetry: '상태 저장 다시 시도',
  confirmSaveHistory: '내역 확인',
} as const;
