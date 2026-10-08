import type { CategoryDto, MenuOptionGroupDto } from '@/contracts/catalog';
import type { Uuid, Won } from '@/contracts/common';

/**
 * 개발용 카탈로그 Mock 데이터. 가게·메뉴·가격은 모두 가상이며 실제 서버 응답으로 바뀐다.
 * 모양은 계약 catalog@0.1의 DTO를 그대로 만들 수 있게 맞췄다.
 *
 * 일부러 넣어 둔 경우:
 * - 준비 중 가게(화덕공방 피자), 메뉴 없는 가게·리뷰 0개(달콤오븐), 사진 없음·긴 이름(옛날 가마솥 …)
 * - 품절 메뉴(순살 치즈 시즈닝 치킨), 품절 옵션(다리살만), 옵션 없는 메뉴, 긴 옵션 이름
 * - 비활성 가게(골목 칼국수)와 비활성 메뉴(단호박 크림 치킨)는 조회에서 숨겨진다
 */

const id = (n: number): Uuid => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const mockCategories: CategoryDto[] = [
  { id: id(1), code: 'chicken', name: '치킨', sortOrder: 1 },
  { id: id(2), code: 'snack', name: '분식', sortOrder: 2 },
  { id: id(3), code: 'pizza', name: '피자', sortOrder: 3 },
  { id: id(4), code: 'korean', name: '한식', sortOrder: 4 },
  { id: id(5), code: 'chinese', name: '중식', sortOrder: 5 },
  { id: id(6), code: 'japanese', name: '일식', sortOrder: 6 },
  { id: id(7), code: 'burger', name: '버거', sortOrder: 7 },
  { id: id(8), code: 'cafe', name: '카페·디저트', sortOrder: 8 },
];

export type MockStore = {
  id: Uuid;
  name: string;
  description: string | null;
  imageRef: string | null;
  isOpen: boolean;
  isRecommended: boolean;
  isActive: boolean;
  categoryCode: string;
  /**
   * 실제 서버는 리뷰 기능(T09) 전까지 항상 { count: 0, average: null }을 준다.
   * Mock은 땡김도 표시 화면도 확인할 수 있게 일부 가게에 값을 넣었다.
   */
  reviewCount: number;
  reviewAverage: number | null;
};

export const mockStores: MockStore[] = [
  { id: id(101), name: '바삭마을 치킨 역삼점', description: '후라이드와 양념 반반을 주로 만드는 동네 치킨집이에요.', imageRef: 'stores/bsm.jpg', isOpen: true, isRecommended: true, isActive: true, categoryCode: 'chicken', reviewCount: 128, reviewAverage: 4.8 },
  { id: id(102), name: '빨간솥 떡볶이', description: '국물 떡볶이와 튀김을 함께 내는 분식집이에요.', imageRef: 'stores/rsd.jpg', isOpen: true, isRecommended: true, isActive: true, categoryCode: 'snack', reviewCount: 42, reviewAverage: 4.6 },
  { id: id(103), name: '한그릇 비빔밥', description: '돌솥에 담아 내는 비빔밥 가게예요.', imageRef: 'stores/hgb.jpg', isOpen: true, isRecommended: true, isActive: true, categoryCode: 'korean', reviewCount: 0, reviewAverage: null },
  { id: id(104), name: '화덕공방 피자', description: '화덕에 굽는 얇은 도우 피자 가게예요.', imageRef: 'stores/hdp.jpg', isOpen: false, isRecommended: true, isActive: true, categoryCode: 'pizza', reviewCount: 17, reviewAverage: 4.5 },
  { id: id(105), name: '달콤오븐', description: '조각 케이크와 구움과자를 파는 가게예요.', imageRef: 'stores/dov.jpg', isOpen: true, isRecommended: true, isActive: true, categoryCode: 'cafe', reviewCount: 0, reviewAverage: null },
  { id: id(106), name: '옛날 가마솥 통닭과 매콤 양념 반반 전문 바삭마을 치킨 역삼 본점', description: '가게명이 긴 경우와 대표 사진이 없는 경우를 보는 가상 가게예요.', imageRef: null, isOpen: true, isRecommended: false, isActive: true, categoryCode: 'chicken', reviewCount: 9, reviewAverage: 4.4 },
  { id: id(107), name: '골목 칼국수', description: '지금은 운영하지 않는 가상 가게예요.', imageRef: null, isOpen: false, isRecommended: false, isActive: false, categoryCode: 'korean', reviewCount: 0, reviewAverage: null },
];

export type MockMenu = {
  id: Uuid;
  storeId: Uuid;
  name: string;
  description: string | null;
  imageRef: string | null;
  price: Won;
  catalogRevision: number;
  isSoldOut: boolean;
  isActive: boolean;
  sortOrder: number;
  optionGroups: MenuOptionGroupDto[];
};

/** 메뉴마다 옵션 id가 달라야 하므로 메뉴 번호를 섞어 만든다 */
function sauceGroup(menuNo: number): MenuOptionGroupDto {
  const base = menuNo * 100;
  return {
    id: id(base + 20),
    name: '소스 추가',
    minSelect: 0,
    maxSelect: 2,
    options: [
      { id: id(base + 21), name: '양념 소스', additionalPrice: 500, isSoldOut: false },
      { id: id(base + 22), name: '허니 머스터드 소스', additionalPrice: 500, isSoldOut: false },
      { id: id(base + 23), name: '치즈 디핑 소스', additionalPrice: 1000, isSoldOut: false },
      { id: id(base + 24), name: '갈릭 버터 디핑 소스와 할라피뇨 피클을 함께 담은 추가 구성', additionalPrice: 1500, isSoldOut: false },
    ],
  };
}

function partGroup(menuNo: number): MenuOptionGroupDto {
  const base = menuNo * 100;
  return {
    id: id(base + 10),
    name: '부위 선택',
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: id(base + 11), name: '기본 (뼈)', additionalPrice: 0, isSoldOut: false },
      { id: id(base + 12), name: '순살로 변경', additionalPrice: 2000, isSoldOut: false },
      { id: id(base + 13), name: '다리살만', additionalPrice: 3000, isSoldOut: true },
    ],
  };
}

const CATALOG_REVISION = 1;

export const mockMenus: MockMenu[] = [
  { id: id(202), storeId: id(101), name: '양념 반반 치킨', description: '후라이드 반, 달콤한 양념 반으로 나눠 담았어요.', imageRef: 'menus/m2.jpg', price: 19000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 1, optionGroups: [partGroup(202), sauceGroup(202)] },
  { id: id(201), storeId: id(101), name: '후라이드 치킨', description: '겉은 바삭하고 속은 촉촉한 기본 후라이드예요.', imageRef: 'menus/m1.jpg', price: 18000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 2, optionGroups: [sauceGroup(201)] },
  { id: id(203), storeId: id(101), name: '간장 마늘 치킨', description: '간장 소스에 구운 마늘을 더했어요.', imageRef: 'menus/m3.jpg', price: 20000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 3, optionGroups: [sauceGroup(203)] },
  { id: id(204), storeId: id(101), name: '순살 치즈 시즈닝 치킨', description: '순살 치킨에 치즈 시즈닝을 뿌렸어요.', imageRef: 'menus/m4.jpg', price: 21000, catalogRevision: CATALOG_REVISION, isSoldOut: true, isActive: true, sortOrder: 4, optionGroups: [sauceGroup(204)] },
  { id: id(205), storeId: id(101), name: '치즈볼 (5개)', description: '쫀득한 치즈볼 다섯 개예요.', imageRef: null, price: 4500, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 5, optionGroups: [] },
  { id: id(209), storeId: id(101), name: '단호박 크림 치킨', description: '지금은 판매하지 않는 가상 메뉴예요.', imageRef: null, price: 21000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: false, sortOrder: 9, optionGroups: [] },
  { id: id(211), storeId: id(102), name: '로제 떡볶이 (2인)', description: '크림과 고추장을 섞은 로제 소스 떡볶이예요.', imageRef: 'menus/r1.jpg', price: 15300, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 1, optionGroups: [] },
  { id: id(212), storeId: id(102), name: '모둠 튀김', description: '김말이, 고구마, 야채 튀김을 담았어요.', imageRef: null, price: 6000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 2, optionGroups: [] },
  { id: id(221), storeId: id(103), name: '돌솥 비빔밥', description: '뜨거운 돌솥에 나물과 달걀을 올렸어요.', imageRef: 'menus/k1.jpg', price: 9500, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 1, optionGroups: [] },
  { id: id(231), storeId: id(104), name: '마르게리타 피자', description: '토마토 소스와 생모차렐라, 바질을 올렸어요.', imageRef: 'menus/p1.jpg', price: 19000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 1, optionGroups: [] },
  { id: id(251), storeId: id(106), name: '옛날 가마솥 통닭 한 마리와 매콤 양념 소스, 무 피클 두 개가 함께 나오는 세트', description: '긴 메뉴명이 줄바꿈되는지 보는 가상 메뉴예요. 설명도 길면 카드에서는 두 줄까지만 보이고 상세에서는 모두 보여요.', imageRef: null, price: 24000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 1, optionGroups: [] },
  { id: id(252), storeId: id(106), name: '매콤 양념 소스 추가 구성', description: '소스만 따로 담아요.', imageRef: null, price: 2000, catalogRevision: CATALOG_REVISION, isSoldOut: false, isActive: true, sortOrder: 2, optionGroups: [] },
];
