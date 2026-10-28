/**
 * 확정 전 초안 문구.
 *
 * 기준 문서에 없는 문구를 여기에 모은다. 화면 코드는 이 값을 읽고, 초안 문구를 직접 적지 않는다.
 * 문구가 확정되면 서정의 확인을 받아 값을 고친다.
 * 기준 문서에 원문이 있는 확정 문구는 여기에 두지 않고 화면 코드에 근거와 함께 적는다.
 */
export const draftCopy = {
  /** 아직 디자인이 없는 화면의 빈 화면 한 줄 (docs/design.md "아직 디자인이 없는 화면") */
  unbuiltScreen: '아직 준비 중인 화면이에요',

  /** 다음 단계(묶음 2~4)에서 연결될 버튼을 눌렀을 때의 임시 안내. 화면이 연결되면 쓰지 않는다 */
  pendingNextStep: '이 화면은 아직 연결되지 않았어요',

  home: {
    sectionError: '가게를 불러오지 못했어요',
    categoriesError: '카테고리를 불러오지 못했어요',
    recentTitle: '최근 본 가게·메뉴',
    recentKindStore: '가게',
    recentKindMenu: '메뉴',
    recommendedTitle: '추천 가게',
  },

  store: {
    loadErrorTitle: '가게 정보를 불러오지 못했어요',
    noMenus: '아직 등록된 메뉴가 없어요',
    /** 계약 isOpen 값의 표시 문구. "준비 중"은 디자인 시안, 10/1 결정 문서는 "영업 종료"라고 부른다 */
    statusOpen: '영업 중',
    statusClosed: '준비 중',
  },

  menu: {
    ruleSingle: '1개 선택',
    ruleMax: (max: number) => `최대 ${max}개까지 고를 수 있어요`,
    ruleFull: (max: number) => `${max}개 모두 골랐어요`,
    quantityHelp: (max: number) => `최대 ${max}개`,
    noteSoldOut: '품절된 메뉴라 지금은 담을 수 없어요',
    noteLoading: '옵션 정보를 불러온 뒤 담을 수 있어요',
    noteMissingRequired: (groupName: string) => `필수 옵션을 골라주세요 · ${groupName}`,
    /** 영업 종료 가게 담기 차단 안내 (10/1 결정 문구). UNDECIDED.preparingStoreOrderable이 false일 때만 쓴다 */
    noteStoreClosed: '지금은 영업이 종료됐어요',
    /** 디자인 시안 문구. 10/1 결정 문서의 문구는 "한 메뉴는 최대 10개까지 담을 수 있어요." */
    toastOverLimit: '같은 메뉴는 최대 10개까지 담을 수 있어요',
    toastAdded: '장바구니에 담았어요',
    toastAddedAction: '보기',
  },

  cart: {
    /** 장바구니 저장 실패 문구는 개발 명세 CART-003 원문 */
    saveFailed: '장바구니를 저장하지 못했어요. 다시 시도해주세요.',
    emptyTitle: '장바구니가 비어 있어요',
    emptyDescription: '먹고 싶은 메뉴를 골라 주문하면\n주문금액이 내 계좌로 배달돼요.',
    emptyAction: '메뉴 둘러보기',
    clearTitle: '장바구니를 비울까요?',
    clearDesc: '담긴 메뉴가 모두 삭제돼요.',
    clearConfirm: '비우기',
    priceChangedTitle: (count: number) => `가격이 바뀐 메뉴가 ${count}개 있어요`,
    priceChangedDesc: '바뀐 가격을 확인해야 주문할 수 있어요.',
    priceChangedAction: '확인',
    priceChangedLine: '가격이 바뀌었어요',
    soldOutTitle: '품절된 메뉴가 있어요',
    soldOutDesc: '품절된 메뉴를 삭제한 뒤 주문할 수 있어요.',
    inactiveTitle: '지금 주문할 수 없는 메뉴가 있어요',
    inactiveDesc: '판매하지 않는 메뉴를 삭제한 뒤 주문할 수 있어요.',
    optionsInvalidTitle: '옵션을 다시 골라야 하는 메뉴가 있어요',
    optionsInvalidDesc: '해당 메뉴를 삭제한 뒤 주문할 수 있어요.',
    storeClosedTitle: '지금은 영업이 종료됐어요',
    storeClosedDesc: '영업 중일 때 주문할 수 있어요.',
    storageErrorTitle: '장바구니를 불러오지 못했어요',
    storageErrorDesc: '저장된 장바구니를 읽을 수 없어요. 비우고 다시 담아주세요.',
    storageErrorAction: '비우기',
    itemMenuSoldOut: '품절된 메뉴예요',
    itemOptionSoldOut: (optionName: string) => `‘${optionName}’ 옵션이 품절돼서 주문할 수 없어요`,
    itemInactive: '지금은 판매하지 않는 메뉴예요',
    itemOptionsInvalid: '옵션을 다시 골라주세요',
    noteValidationUnavailable: '옵션 정보를 다시 불러온 뒤 주문할 수 있어요',
    noteValidating: '주문할 수 있는지 확인하고 있어요',
  },
} as const;
