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

  /** 리뷰: 제목은 어디서나 "SaveEats 리뷰". 점수는 "별점"이 아니라 "땡김도" (DS 11장 · 기획서 25~31) */
  reviewTitle: 'SaveEats 리뷰',
  /** 기획서 29 · PRD FR-MYREV-006 */
  myReviewsEmpty: '아직 작성한 SaveEats 리뷰가 없어요.',
  /** DS 11장: 리뷰 작성 가능 기간 안내 */
  reviewWindowHelp: '리뷰는 주문 완료 후 30일 동안 작성할 수 있어요.',
  /** DS 11장: 삭제 확인. 주문 완료 후 30일이 지난 리뷰는 경고 한 줄을 더한다 */
  reviewDeleteTitle: '리뷰를 삭제할까요?',
  reviewDeleteDesc: '삭제한 리뷰는 다시 복구할 수 없어요.',
  reviewDeleteWarnPastWindow: '삭제하면 이 주문에는 리뷰를 다시 작성할 수 없어요.',
  reviewDeleted: '리뷰가 삭제됐어요.',
  /** REV-009 화면 카피 */
  reviewDeadlineExceeded: '리뷰 작성 기간이 지났어요.',
  reviewRevisionConflict: '리뷰가 변경됐어요. 최신 내용을 확인해주세요.',
  reviewPhotoFailed: '사진을 올리지 못했어요. 다시 시도해주세요.',
  reviewSaveFailed: '리뷰를 저장하지 못했어요. 다시 시도해주세요.',
  /** 리뷰 정렬 (기획서 27): "별점" 표현을 쓰지 않는다 */
  reviewSortLatest: '최신순',
  reviewSortHelpful: '리뷰 도움순',
  reviewSortRatingDesc: '땡김도 높은 순',
  reviewSortRatingAsc: '땡김도 낮은 순',
  reviewHelpful: '도움돼요',
  reviewMine: '내 리뷰',
  reviewWrite: '리뷰 쓰기',
  reviewWritten: '리뷰 작성 완료 · 보기',
  reviewExpired: '리뷰 작성 기간이 지났어요',

  /** 기획서 11.4 · FR-HOME-003 검색창 문구. 홈 검색창과 검색 탭이 같은 문구를 쓴다 */
  searchPlaceholder: '오늘은 뭐가 먹고 싶으세요?',

  /** 기획서 44 · FR-ONB-003 온보딩 3페이지 제목, FR-ONB-004 마지막 CTA */
  onboardingTitles: ['먹고 싶은 메뉴를\n평소처럼 골라보세요', '음식 대신 주문금액이\n내 계좌로 배달돼요', '주문하듯,\n내 계좌로'],
  onboardingStart: 'SaveEats 시작하기',

  /** PRD FR-ONB-009 온보딩 2페이지 설명 아래 보조 문구 */
  onboardingNonAffiliation: 'SaveEats는 실제 음식점과 제휴한 서비스가 아니에요.',

  /** 기획서 15.1 · PRD FR-STORE-015 · 017 가게 상세 하단 콘텐츠 출처 안내와 목록 시트 */
  contentSource: {
    title: '콘텐츠 출처',
    body: '본 가게의 메뉴 정보 및 이미지는 외부 자료를 참고하였습니다.',
    nonAffiliation: 'SaveEats는 해당 브랜드와 제휴한 서비스가 아닙니다.',
    openButton: '출처 확인하기',
    sheetGuide: '이 가게의 콘텐츠를 구성할 때 참고한 자료입니다.',
  },

  /** 기획서 37.1 · PRD 40.10 서비스 및 콘텐츠 이용 안내. 현재 합의한 안내 카피이며 사용권·법무 검토 완료를 뜻하지 않는다 */
  contentGuide: {
    title: '서비스 및 콘텐츠 이용 안내',
    sections: [
      {
        title: 'SaveEats 서비스 안내',
        lines: [
          'SaveEats는 대학 캡스톤디자인 프로젝트로 시작된 독립적인 서비스입니다.',
          '일반 배달앱처럼 메뉴를 선택하고 주문할 수 있지만, 실제 음식 주문 및 배달은 발생하지 않습니다.',
          '사용자가 선택한 주문금액이 자신의 계좌로 이동하는 경험을 제공합니다.',
        ],
      },
      {
        title: '브랜드 및 콘텐츠 안내',
        lines: [
          'SaveEats는 실제 음식점의 브랜드명과 메뉴명, 음식 이미지 등을 활용하고 있습니다.',
          'SaveEats는 해당 브랜드의 공식 서비스가 아니며, 별도의 제휴 관계가 없습니다.',
          '앱에 표시되는 메뉴 가격과 구성은 실제 판매 정보와 다를 수 있습니다.',
          '브랜드명, 로고 및 이미지에 관한 권리는 각 권리자에게 있습니다.',
        ],
      },
      {
        title: '콘텐츠 출처 확인',
        lines: [
          '각 음식점의 메뉴 정보 및 이미지 출처는 해당 가게의 상세 화면 하단에서 확인할 수 있습니다.',
          '본 안내는 콘텐츠의 출처를 밝히기 위한 것으로, 브랜드와의 제휴 또는 콘텐츠 이용 허락을 의미하지 않습니다.',
        ],
      },
    ],
  },

  /** 기획서 37 · FR-MY-006 주문이 하나도 없는 사용자의 마이 */
  myZeroTitle: '아직 SaveEats 주문이 없어요.',
  myZeroAction: '메뉴 둘러보기',
} as const;
