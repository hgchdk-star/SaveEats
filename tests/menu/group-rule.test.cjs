/**
 * 옵션 그룹 규칙 줄("최대 N종 선택") 표시 규칙.
 * 그룹 최대 선택은 고른 옵션 '종류 수' 기준이고 옵션별 수량과 별개다. 최대가 선택지 수 이상이면 실제 제한이 없어 문구를 생략한다.
 * DB의 상한(원본 1000)은 바꾸지 않는다. 그룹 이름의 '(최대 2개 가능)' 같은 글자로 새 규칙을 만들지 않는다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../order/harness.cjs'); // TS 변환 준비
const sel = require('../../src/features/menu/menu-selection.ts');
const { parseMenuDetail } = require('../../src/services/supabase/rpc-result.ts');

const opt = (id, soldOut = false) => ({ id, name: id, additionalPrice: 0, isSoldOut: soldOut });
const group = (max, options, min = 0) => ({ id: 'g', name: '그룹', minSelect: min, maxSelect: max, options });
const five = () => ['a', 'b', 'c', 'd', 'e'].map((i) => opt(i));

test('원본 상한 1000이어도 선택지가 14개뿐이면 실제 제한이 아니라 문구를 생략한다', () => {
  const g = group(1000, Array.from({ length: 14 }, (_, i) => opt(`o${i}`)));
  assert.equal(sel.hasRealMaxLimit(g), false);
  assert.equal(sel.groupRuleKind(g, 0), 'none');
  assert.equal(sel.groupRuleKind(g, 14), 'none');
});

test('최대 선택이 선택지 수보다 작으면 실제 제한이라 "최대 N종 선택" 대상이다', () => {
  const g = group(2, five());
  assert.equal(sel.hasRealMaxLimit(g), true);
  assert.equal(sel.groupRuleKind(g, 0), 'limit');
  assert.equal(sel.groupRuleKind(g, 1), 'limit');
  assert.equal(sel.groupRuleKind(g, 2), 'limit-full');
});

test('최대가 선택지 수와 같으면 제한이 아니다(전부 골라도 된다)', () => {
  const g = group(2, [opt('a'), opt('b')]);
  assert.equal(sel.hasRealMaxLimit(g), false);
  assert.equal(sel.groupRuleKind(g, 2), 'none');
});

test('단일 선택(최대 1)은 라디오 안내를 그대로 쓴다', () => {
  assert.equal(sel.groupRuleKind(group(1, five()), 0), 'single');
  assert.equal(sel.groupRuleKind(group(1, [opt('a')], 1), 0), 'single');
});

test('품절 선택지는 고를 수 없으므로 선택 가능한 종류 수에서 뺀다(동적)', () => {
  // 선택지 4개 중 1개 품절 → 고를 수 있는 것 3개. 최대 3이면 제한 없음, 최대 2이면 제한 있음
  const options = [opt('a'), opt('b'), opt('c'), opt('d', true)];
  assert.equal(sel.selectableCount(group(3, options)), 3);
  assert.equal(sel.hasRealMaxLimit(group(3, options)), false);
  assert.equal(sel.hasRealMaxLimit(group(2, options)), true);
  // 품절이 풀리면(같은 그룹, 품절 없음) 최대 3도 실제 제한이 된다
  const restored = options.map((o) => ({ ...o, isSoldOut: false }));
  assert.equal(sel.hasRealMaxLimit(group(3, restored)), true);
});

test('필수 그룹은 문구와 상관없이 필수 검증이 그대로 동작한다', () => {
  const required = group(1000, [opt('a'), opt('b'), opt('c')], 1);
  const menu = { id: 'm', optionGroups: [required] };
  assert.equal(sel.isRequired(required), true);
  assert.equal(sel.groupRuleKind(required, 0), 'none'); // 문구는 생략되지만
  assert.equal(sel.firstMissingRequired(menu, {}), '그룹'); // 안 고르면 막힌다
  assert.equal(sel.firstMissingRequired(menu, { g: ['a'] }), null);
});

test('그룹 이름의 "(최대 2개 가능)"은 검증 규칙을 만들지 않는다: 두 종류를 모두 골라도 막히지 않는다', () => {
  const g = { id: 'g', name: '파스타 선택 (최대 2개 가능)', minSelect: 0, maxSelect: 2, options: [opt('a'), opt('b')] };
  const picked = sel.toggleOption(sel.toggleOption({}, g, 'a'), g, 'b');
  assert.deepEqual(picked.g, ['a', 'b']);
});

test('실제 서버 응답의 모든 그룹: 현재 데이터에는 "최대 N종" 문구가 필요한 그룹이 없고 1000 문구가 나오지 않는다', () => {
  const menu = parseMenuDetail(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'get-menu-real-pateokchi.json'), 'utf8')));
  for (const g of menu.optionGroups) {
    const kind = sel.groupRuleKind(g, 0);
    assert.notEqual(kind, 'limit', `${g.name}: 현재 데이터에서는 실제 제한이 없다`);
    if (g.maxSelect >= 1000) assert.equal(kind, 'none', `${g.name}: 1000 문구는 보이지 않는다`);
  }
  // 원본 상한은 서버 값 그대로다(앱이 바꾸지 않는다)
  assert.equal(menu.optionGroups.some((g) => g.maxSelect === 1000), true);
});

test('다 고르지 않은 상태에서도 최대가 선택지 이상이면 아무것도 잠기지 않는다', () => {
  const g = group(1000, [opt('a'), opt('b'), opt('c')]);
  let s = {};
  for (const id of ['a', 'b', 'c']) s = sel.toggleOption(s, g, id);
  assert.deepEqual(s.g, ['a', 'b', 'c']);
});
