/**
 * 가게 상세 메뉴 탭: 구역(그룹) 구성, 가게 안 메뉴 검색, 스크롤↔탭 동기화 계산.
 * 화면 없이 순수 함수와 서버 응답 파서를 시험한다. 실제 화면(스크롤 동기화 체감)은 기기에서 확인해야 한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../order/harness.cjs'); // TS 변환 준비
const ms = require('../../src/features/store/menu-sections.ts');
const { parseStoreDetail } = require('../../src/services/supabase/rpc-result.ts');

const menu = (id, name, extra = {}) => ({ id, name, description: null, imageRef: null, price: 1000, isSoldOut: false, ...extra });
const TITLE = '기타 메뉴';

/* ---------- 구역 만들기 ---------- */

test('그룹 순서와 그룹 안 메뉴 순서는 서버가 준 그대로다(menus의 순서와 달라도)', () => {
  const menus = [menu('m1', 'A'), menu('m2', 'B'), menu('m3', 'C')];
  const groups = [
    { id: 'g1', name: '둘째가 먼저', menuIds: ['m3', 'm1'] },
    { id: 'g2', name: '다음', menuIds: ['m2'] },
  ];
  const r = ms.buildMenuSections(menus, groups, TITLE);
  assert.equal(r.grouped, true);
  assert.deepEqual(r.sections.map((s) => s.title), ['둘째가 먼저', '다음']);
  assert.deepEqual(r.sections[0].menus.map((m) => m.id), ['m3', 'm1']);
  assert.equal(r.ungroupedCount, 0);
});

test('그룹이 없거나(undefined·빈 배열) 응답에 필드가 없으면 구역 없이 평평한 목록이다', () => {
  const menus = [menu('m1', 'A')];
  for (const groups of [undefined, []]) {
    const r = ms.buildMenuSections(menus, groups, TITLE);
    assert.equal(r.grouped, false);
    assert.deepEqual(r.sections, []);
  }
});

test('한 메뉴가 여러 그룹에 있어도 메뉴 본체는 같은 객체이고, 펼치면 한 번만 나온다', () => {
  const menus = [menu('m1', 'A'), menu('m2', 'B')];
  const groups = [{ id: 'g1', name: '1', menuIds: ['m1', 'm2'] }, { id: 'g2', name: '2', menuIds: ['m1'] }];
  const r = ms.buildMenuSections(menus, groups, TITLE);
  assert.equal(r.sections[0].menus[0], r.sections[1].menus[0]);
  assert.deepEqual(ms.flattenSections(r.sections).map((m) => m.id), ['m1', 'm2']);
});

test('같은 그룹 안에 같은 id가 두 번 있어도 한 번만 보인다', () => {
  const r = ms.buildMenuSections([menu('m1', 'A')], [{ id: 'g', name: 'G', menuIds: ['m1', 'm1'] }], TITLE);
  assert.equal(r.sections[0].menus.length, 1);
});

test('어느 그룹에도 없는 활성 메뉴는 조용히 빠지지 않고 맨 뒤 "기타 메뉴"로 모인다', () => {
  const menus = [menu('m1', 'A'), menu('m2', 'B'), menu('m3', 'C')];
  const r = ms.buildMenuSections(menus, [{ id: 'g', name: 'G', menuIds: ['m1'] }], TITLE);
  assert.equal(r.sections.at(-1).id, ms.UNGROUPED_SECTION_ID);
  assert.equal(r.sections.at(-1).title, TITLE);
  assert.deepEqual(r.sections.at(-1).menus.map((m) => m.id), ['m2', 'm3']);
  assert.equal(r.ungroupedCount, 2);
});

test('보이는 메뉴가 없는 그룹(숨긴 메뉴만 있던 그룹)은 구역으로 나오지 않는다', () => {
  const r = ms.buildMenuSections([menu('m1', 'A')], [{ id: 'g1', name: '비었다', menuIds: [] }, { id: 'g2', name: '있다', menuIds: ['m1'] }], TITLE);
  assert.deepEqual(r.sections.map((s) => s.id), ['g2']);
});

test('그룹이 가리키는 메뉴가 menus에 없으면 화면에는 쓰지 않고 진단 목록에 남긴다', () => {
  const r = ms.buildMenuSections([menu('m1', 'A')], [{ id: 'g', name: 'G', menuIds: ['m1', 'ghost'] }], TITLE);
  assert.deepEqual(r.unknownMenuIds, ['ghost']);
  assert.equal(r.sections[0].menus.length, 1);
});

/* ---------- 쿠팡이츠 실제 구성(수집 자료) 규모 ---------- */

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'goobne-menu-groups.json'), 'utf8'));

function goobneLikeStore() {
  // 앱이 받게 될 모양: 주류 7개는 숨겨져 menus에 없고, 보류한 모짜치즈볼은 수집 메뉴가 아니라 기존 메뉴(그룹 없음)로 menus에 있다
  const hidden = new Set([...fx.alcoholIds, ...fx.heldIds]);
  const menus = [];
  for (const g of fx.groups) for (const id of g.menuIds) if (!hidden.has(id)) menus.push(menu(id, fx.menus[id]));
  menus.push(menu('existing-mozza', '모짜치즈볼(5pcs)'));
  // 서버는 주류 그룹처럼 보이는 메뉴가 없는 그룹을 빼고 메뉴 id에서 숨김·보류 메뉴를 뺀다
  const groups = fx.groups
    .map((g) => ({ id: g.id, name: g.name, menuIds: g.menuIds.filter((id) => !hidden.has(id)) }))
    .filter((g) => g.menuIds.length > 0);
  return { menus, groups };
}

test('수집 자료 규모: 12개 그룹 중 주류 그룹이 빠진 11개 구역 + 그룹 없는 기존 메뉴 1개의 "기타 메뉴"', () => {
  const { menus, groups } = goobneLikeStore();
  const r = ms.buildMenuSections(menus, groups, TITLE);
  assert.equal(r.sections.length, 12);
  assert.deepEqual(r.sections.slice(0, 11).map((s) => s.title), fx.groups.filter((g) => g.name !== '주류메뉴').map((g) => g.name));
  assert.equal(r.sections.at(-1).title, TITLE);
  assert.deepEqual(r.sections.at(-1).menus.map((m) => m.id), ['existing-mozza']);
  const total = r.sections.reduce((n, s) => n + s.menus.length, 0);
  assert.equal(total, 109); // 116 − 주류 7 − 보류 1(수집분) + 기존 모짜치즈볼 1
  assert.equal(new Set(ms.flattenSections(r.sections).map((m) => m.id)).size, 109, '중복 없음');
  assert.equal(r.unknownMenuIds.length, 0);
});

test('수집 자료의 순서가 그대로 보인다: 첫 구역 첫 메뉴와 사이드 메뉴 구역의 메뉴 순서', () => {
  const { menus, groups } = goobneLikeStore();
  const r = ms.buildMenuSections(menus, groups, TITLE);
  assert.equal(r.sections[0].menus[0].name, '(New) 서울엄마 파기름떡볶이 치킨');
  const side = fx.groups.find((g) => g.name === '사이드 메뉴');
  const expected = side.menuIds.filter((id) => !fx.heldIds.includes(id)).map((id) => fx.menus[id]);
  assert.deepEqual(r.sections.find((s) => s.title === '사이드 메뉴').menus.map((m) => m.name), expected);
});

/* ---------- 가게 안 검색 ---------- */

test('검색: 공백·대소문자 차이를 무시한다', () => {
  const menus = [menu('1', '파기름 떡볶이 치킨'), menu('2', 'BHC 뿌링클'), menu('3', '콜라')];
  assert.deepEqual(ms.searchMenus(menus, [], '파기름떡볶이').map((m) => m.id), ['1']);
  assert.deepEqual(ms.searchMenus(menus, [], '  파 기름  ').map((m) => m.id), ['1']);
  assert.deepEqual(ms.searchMenus(menus, [], 'bhc').map((m) => m.id), ['2']);
  assert.deepEqual(ms.searchMenus(menus, [], 'BhC 뿌링').map((m) => m.id), ['2']);
});

test('검색: 한글 자모 분리(NFD) 입력도 같은 글자로 본다', () => {
  const menus = [menu('1', '치킨무')];
  const nfd = '치킨무'.normalize('NFD');
  assert.deepEqual(ms.searchMenus(menus, [], nfd).map((m) => m.id), ['1']);
});

test('검색어가 비거나 공백뿐이면 검색 중이 아니다(null)', () => {
  const menus = [menu('1', 'A')];
  assert.equal(ms.searchMenus(menus, [], ''), null);
  assert.equal(ms.searchMenus(menus, [], '   '), null);
});

test('검색: 결과가 없으면 빈 배열(결과 없음 상태)', () => {
  assert.deepEqual(ms.searchMenus([menu('1', 'A')], [], '없는메뉴'), []);
});

test('검색: 여러 그룹에 있는 같은 메뉴는 결과에 한 번만, 보이는 구역 순서대로 나온다', () => {
  const menus = [menu('m1', '치킨 A'), menu('m2', '치킨 B'), menu('m3', '치킨 C')];
  const groups = [{ id: 'g1', name: '1', menuIds: ['m3', 'm1'] }, { id: 'g2', name: '2', menuIds: ['m1', 'm2'] }];
  const { sections } = ms.buildMenuSections(menus, groups, TITLE);
  assert.deepEqual(ms.searchMenus(menus, sections, '치킨').map((m) => m.id), ['m3', 'm1', 'm2']);
});

test('검색: 그룹에 없는 메뉴와 불러온 전체 메뉴를 빠뜨리지 않는다', () => {
  const menus = [menu('m1', '치킨 A'), menu('m2', '치킨 B')];
  // sections에는 m1만 있어도 menus 전체(m2)를 검색한다
  const sections = [{ id: 'g', title: 'G', menus: [menus[0]] }];
  assert.deepEqual(ms.searchMenus(menus, sections, '치킨').map((m) => m.id), ['m1', 'm2']);
});

test('검색: 수집 자료 규모에서 "치즈볼"은 한 번씩만 나오고 품절·그룹 위치와 무관하게 모두 찾는다', () => {
  const { menus, groups } = goobneLikeStore();
  const { sections } = ms.buildMenuSections(menus, groups, TITLE);
  const names = ms.searchMenus(menus, sections, '치즈 볼').map((m) => m.name);
  assert.ok(names.includes('콰트로모짜치즈볼'));
  assert.ok(names.includes('모짜치즈볼(5pcs)'));
  assert.equal(names.length, new Set(names).size);
});

/* ---------- 스크롤 ↔ 탭 ---------- */

test('스크롤 위치에서 지금 보는 구역을 구한다', () => {
  const offsets = [100, 400, 900, 1500];
  const header = 120; // 고정된 상단 바 + 탭 높이
  assert.equal(ms.activeSectionIndex(offsets, 0, header), 0); // 맨 위: 첫 구역
  assert.equal(ms.activeSectionIndex(offsets, 200, header), 0);
  assert.equal(ms.activeSectionIndex(offsets, 400 - header, header), 1); // 두 번째 제목이 고정 헤더에 닿으면 전환
  assert.equal(ms.activeSectionIndex(offsets, 400 - header - 10, header), 0);
  assert.equal(ms.activeSectionIndex(offsets, 5000, header), 3); // 끝까지 내리면 마지막 구역
  assert.equal(ms.activeSectionIndex([], 100, header), 0);
});

test('탭을 누르면 해당 구역 제목이 고정 헤더 바로 아래에 오는 위치로 간다(0 미만 없음)', () => {
  assert.equal(ms.scrollTargetForSection(900, 120), 780);
  assert.equal(ms.scrollTargetForSection(50, 120), 0);
  // 탭으로 이동한 위치에서 다시 활성 구역을 구하면 같은 구역이다(탭 ↔ 스크롤 동기화가 어긋나지 않는다)
  const offsets = [100, 400, 900, 1500];
  for (let i = 0; i < offsets.length; i += 1) {
    assert.equal(ms.activeSectionIndex(offsets, ms.scrollTargetForSection(offsets[i], 120), 120), i);
  }
});

/* ---------- 서버 응답 파서 ---------- */

const store = (extra = {}) => ({
  id: 's', name: '가게', description: null, imageRef: null, isOpen: true, isRecommended: false,
  category: { id: 'c', code: 'chicken', name: '치킨' }, reviewSummary: { count: 0, averageCravingRating: null }, isFavorite: null,
  menus: [menu('m1', 'A')], ...extra,
});

test('파서: menuGroups가 있으면 통과하고, 없으면(그룹 도입 전 서버) 그대로 통과한다', () => {
  assert.equal(parseStoreDetail(store({ menuGroups: [{ id: 'g', name: 'G', menuIds: ['m1'] }] })).menuGroups.length, 1);
  assert.equal(parseStoreDetail(store()).menuGroups, undefined);
  assert.deepEqual(parseStoreDetail(store({ menuGroups: [] })).menuGroups, []);
});

test('파서: 모양이 틀린 menuGroups는 조용히 무시하지 않고 INTERNAL_ERROR(응답 모양 오류)로 거절한다', () => {
  for (const bad of ['x', [{ id: 'g', name: 'G' }], [{ id: 'g', name: 1, menuIds: [] }], [{ id: 'g', name: 'G', menuIds: [1] }], [null]]) {
    assert.throws(() => parseStoreDetail(store({ menuGroups: bad })), (e) => e.name === 'RepositoryError' && e.failure.code === 'INTERNAL_ERROR');
  }
});
