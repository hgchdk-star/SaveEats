/**
 * 내역의 '같은 주문 담기': 지난 주문의 줄을 지금 메뉴 기준으로 다시 담는 규칙.
 * 옵션은 주문 당시 optionId로만 맞추고(이름 추측 없음), 가격·revision은 지금 메뉴 값, 하나라도 못 담으면 아무것도 담지 않는다.
 */
process.env.EXPO_PUBLIC_DATA_SOURCE = 'mock';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../order/harness.cjs');
const { rebuildLine, reorderLines } = require('../../src/features/history/reorder.ts');
const cartModel = require('../../src/features/cart/cart-model.ts');
const { createSingleFlight } = require('../../src/features/cart/quick-add.ts');
const { parseOrderDto } = require('../../src/services/order/order-dto.ts');
const { buildSnapshot } = require('../../src/mocks/server/snapshot.ts');

const STORE = '00000000-0000-4000-8000-0000000000a0';
const M1 = '00000000-0000-4000-8000-0000000000a1';
const M2 = '00000000-0000-4000-8000-0000000000a2';
const G_SIZE = '00000000-0000-4000-8000-0000000000c1'; // 필수 1개
const G_SAUCE = '00000000-0000-4000-8000-0000000000c2'; // 선택, 합계 3개
const L = '00000000-0000-4000-8000-0000000000b1';
const R = '00000000-0000-4000-8000-0000000000b2';
const SAUCE = '00000000-0000-4000-8000-0000000000b3'; // 수량 허용 최대 3
const NONE = '00000000-0000-4000-8000-0000000000b4'; // 단독

const menu = (over = {}) => ({
  id: M1, storeId: STORE, storeIsOpen: true, name: '치킨', description: null, imageRef: null, price: 20000, catalogRevision: 7, isSoldOut: false,
  optionGroups: [
    { id: G_SIZE, name: '크기', minSelect: 1, maxSelect: 1, options: [
      { id: L, name: '라지', additionalPrice: 2000, isSoldOut: false, allowQuantity: false, maxQuantity: 1 },
      { id: R, name: '레귤러', additionalPrice: 0, isSoldOut: false, allowQuantity: false, maxQuantity: 1 } ] },
    { id: G_SAUCE, name: '소스', minSelect: 0, maxSelect: 3, maxTotalQuantity: 3, options: [
      { id: SAUCE, name: '양념', additionalPrice: 500, isSoldOut: false, allowQuantity: true, maxQuantity: 3 },
      { id: NONE, name: '선택안함', additionalPrice: 0, isSoldOut: false, allowQuantity: false, maxQuantity: 1, isExclusive: true } ] },
  ],
  ...over,
});
const line = (over = {}) => ({
  menuId: M1, menuName: '치킨', menuImageRef: null, unitPrice: 23000, quantity: 2, lineTotal: 46000,
  options: [
    { groupName: '크기', optionName: '라지', additionalPrice: 2000, quantity: 1, groupId: G_SIZE, optionId: L },
    { groupName: '소스', optionName: '양념', additionalPrice: 500, quantity: 2, groupId: G_SAUCE, optionId: SAUCE },
  ],
  ...over,
});
const fail = (r) => (r.ok ? 'OK' : r.reason);

test('같은 옵션·옵션 수량·메뉴 수량으로 다시 만든다(가격·revision은 지금 값)', () => {
  const r = rebuildLine(line({ unitPrice: 20000 }), menu(), false);
  assert.equal(r.ok, true);
  const i = r.line.input;
  assert.deepEqual([...i.optionIds].sort(), [L, SAUCE].sort());
  assert.deepEqual(i.optionQuantities, { [SAUCE]: 2 });
  assert.equal(i.quantity, 2);
  assert.equal(i.unitPrice, 20000 + 2000 + 1000); // 지금 가격(주문 당시 20000이 아니다)
  assert.equal(i.catalogRevision, 7);
  assert.deepEqual(i.optionNames, ['라지', '양념 ×2']);
  assert.equal(r.line.priceChanged, true); // 주문 당시 20000 ≠ 지금 23000
  assert.equal(rebuildLine(line(), menu(), false).line.priceChanged, false);
});

test('메뉴 가격·옵션 추가금이 바뀌면 지금 가격을 쓰고 알린다', () => {
  const changed = menu({ price: 21000 });
  const r = rebuildLine(line(), changed, false);
  assert.equal(r.line.input.unitPrice, 24000);
  assert.equal(r.line.priceChanged, true);
});

test('품절·준비 중·옵션 사라짐·옵션 품절·규칙 변경은 담지 않는다', () => {
  assert.equal(fail(rebuildLine(line(), menu({ isSoldOut: true }), false)), 'MENU_SOLD_OUT');
  assert.equal(fail(rebuildLine(line(), menu({ storeIsOpen: false }), false)), 'STORE_CLOSED');
  assert.equal(fail(rebuildLine(line(), menu({ storeIsOpen: false }), true)), 'OK'); // 준비 중 주문 허용 설정이면 담을 수 있다
  const noSauce = menu(); noSauce.optionGroups[1].options = noSauce.optionGroups[1].options.filter((o) => o.id !== SAUCE);
  assert.equal(fail(rebuildLine(line(), noSauce, false)), 'OPTION_UNAVAILABLE');
  const soldOut = menu(); soldOut.optionGroups[0].options[0].isSoldOut = true;
  assert.equal(fail(rebuildLine(line(), soldOut, false)), 'OPTION_SOLD_OUT');
  const capped = menu(); capped.optionGroups[1].options[0].maxQuantity = 1;
  assert.equal(fail(rebuildLine(line(), capped, false)), 'OPTIONS_CHANGED');
  const noQty = menu(); noQty.optionGroups[1].options[0].allowQuantity = false;
  assert.equal(fail(rebuildLine(line(), noQty, false)), 'OPTIONS_CHANGED');
  const totalLimit = menu(); totalLimit.optionGroups[1].maxTotalQuantity = 1;
  assert.equal(fail(rebuildLine(line(), totalLimit, false)), 'OPTIONS_CHANGED');
  const newRequired = menu(); newRequired.optionGroups[1].minSelect = 1; // 필수 그룹을 이 주문은 고르지 않았다
  assert.equal(fail(rebuildLine(line({ options: [line().options[0]] }), newRequired, false)), 'OPTIONS_CHANGED');
  const moved = menu(); // 같은 옵션 id가 다른 그룹으로 옮겨졌다
  assert.equal(fail(rebuildLine(line({ options: [{ ...line().options[0], groupId: G_SAUCE }, line().options[1]] }), moved, false)), 'OPTION_UNAVAILABLE');
});

test('단독 옵션은 다른 옵션과 함께일 수 없다(지금 규칙)', () => {
  const both = line({ options: [line().options[0], { groupName: '소스', optionName: '선택안함', additionalPrice: 0, quantity: 1, groupId: G_SAUCE, optionId: NONE }, line().options[1]] });
  assert.equal(fail(rebuildLine(both, menu(), false)), 'OPTIONS_CHANGED');
});

test('옵션 식별자가 없는 주문(옛 응답)에 옵션이 있으면 이름으로 추측하지 않고 담지 않는다. 옵션이 없는 줄은 담긴다', () => {
  const noIds = line({ options: line().options.map(({ groupId, optionId, ...rest }) => rest) });
  assert.equal(fail(rebuildLine(noIds, menu(), false)), 'OPTION_INFO_MISSING');
  const plain = menu({ optionGroups: [] });
  const r = rebuildLine(line({ options: [], unitPrice: 20000 }), plain, false);
  assert.equal(r.ok, true);
  assert.deepEqual(r.line.input.optionIds, []);
});

const deps = (over = {}) => {
  const added = [];
  return {
    added,
    deps: {
      getMenu: async (id) => (id === M2 ? menu({ id: M2, name: '사이드', optionGroups: [], price: 5000 }) : menu()),
      addMany: async (inputs, o) => { added.push({ inputs, o }); return { ok: true }; },
      preparingStoreOrderable: false,
      isNotFound: (e) => e && e.code === 'NF',
      ...over,
    },
  };
};

test('주문의 모든 줄을 한 번에 담는다(성공할 때만 ADDED)', async () => {
  const { added, deps: d } = deps();
  const out = await reorderLines([line(), { ...line({ options: [], unitPrice: 5000, menuId: M2, quantity: 1 }) }], d);
  assert.equal(out.kind, 'ADDED');
  assert.equal(added.length, 1);
  assert.equal(added[0].inputs.length, 2);
});

test('한 줄이라도 못 담으면 아무것도 담지 않는다(일부만 담기지 않음)', async () => {
  const { added, deps: d } = deps({ getMenu: async (id) => (id === M2 ? menu({ id: M2, isSoldOut: true, optionGroups: [] }) : menu()) });
  const out = await reorderLines([line(), line({ menuId: M2, options: [], unitPrice: 5000 })], d);
  assert.deepEqual(out, { kind: 'FAILED', reason: 'MENU_SOLD_OUT' });
  assert.equal(added.length, 0);
});

test('메뉴 조회: 없음·비활성은 MENU_UNAVAILABLE, 그 밖의 오류(네트워크)는 LOAD_FAILED. 둘 다 담지 않는다', async () => {
  const nf = deps({ getMenu: async () => { throw { code: 'NF' }; } });
  assert.deepEqual(await reorderLines([line()], nf.deps), { kind: 'FAILED', reason: 'MENU_UNAVAILABLE' });
  const net = deps({ getMenu: async () => { throw new Error('network'); } });
  assert.deepEqual(await reorderLines([line()], net.deps), { kind: 'FAILED', reason: 'LOAD_FAILED' });
  assert.equal(nf.added.length + net.added.length, 0);
});

test('장바구니 결과를 그대로 전한다: 다른 가게·최대 수량·종류·저장 실패, 던져도 성공으로 보지 않는다', async () => {
  for (const reason of ['OTHER_STORE', 'OVER_LIMIT', 'OVER_KINDS', 'SAVE_FAILED', 'NOT_READY']) {
    const { deps: d } = deps({ addMany: async () => ({ ok: false, reason }) });
    const out = await reorderLines([line()], d);
    assert.deepEqual(out, reason === 'OTHER_STORE' ? { kind: 'OTHER_STORE' } : { kind: 'FAILED', reason });
  }
  const thrown = deps({ addMany: async () => { throw new Error('x'); } });
  assert.deepEqual(await reorderLines([line()], thrown.deps), { kind: 'FAILED', reason: 'SAVE_FAILED' });
  const { added, deps: d } = deps();
  await reorderLines([line()], d, { replaceOtherStore: true });
  assert.equal(added[0].o.replaceOtherStore, true);
});

/* ---------- 장바구니 규칙 ---------- */
const input = (over = {}) => ({ storeId: STORE, menuId: M1, optionIds: [L, SAUCE], optionQuantities: { [SAUCE]: 2 }, quantity: 2, unitPrice: 23000, catalogRevision: 7, menuName: '치킨', optionNames: [], imageRef: null, ...over });

test('장바구니에 같은 조합이 있으면 수량을 합친다. 합계가 10을 넘으면 거절하고 아무것도 바꾸지 않는다', () => {
  const base = cartModel.addToCart(cartModel.createEmptyCart(), input({ quantity: 3 })).cart;
  const merged = cartModel.addManyToCart(base, [input({ quantity: 2 })]);
  assert.equal(merged.ok, true);
  assert.equal(merged.cart.items.length, 1);
  assert.equal(merged.cart.items[0].quantity, 5);
  assert.equal(cartModel.addManyToCart(base, [input({ quantity: 8 })]).reason, 'OVER_LIMIT');
});

test('여러 줄 중 하나가 거절되면 전체가 거절된다(일부만 담기지 않음), 성공하면 편집 횟수는 1 늘어난다', () => {
  const base = cartModel.addToCart(cartModel.createEmptyCart(), input({ quantity: 9 })).cart;
  const bad = cartModel.addManyToCart(base, [input({ menuId: M2, optionIds: [], optionQuantities: undefined }), input({ quantity: 2 })]);
  assert.equal(bad.ok, false);
  assert.equal(base.items.length, 1); // 원본은 그대로
  const ok = cartModel.addManyToCart(base, [input({ menuId: M2, optionIds: [], optionQuantities: undefined, quantity: 1 }), input({ quantity: 1 })]);
  assert.equal(ok.ok, true);
  assert.equal(ok.cart.items.length, 2);
  assert.equal(ok.cart.localRevision, base.localRevision + 1);
});

test('다른 가게 장바구니: 확인 없이는 거절, 교체하면 기존을 비우고 여러 줄을 담는다', () => {
  const other = cartModel.addToCart(cartModel.createEmptyCart(), input({ storeId: '00000000-0000-4000-8000-0000000000ff' })).cart;
  assert.equal(cartModel.addManyToCart(other, [input(), input({ menuId: M2, optionIds: [] })]).reason, 'OTHER_STORE');
  const replaced = cartModel.addManyToCart(other, [input(), input({ menuId: M2, optionIds: [], optionQuantities: undefined })], { replaceOtherStore: true });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.cart.storeId, STORE);
  assert.equal(replaced.cart.items.length, 2);
});

test('연속 터치: 처리 중에는 다른 시작을 무시하고, 끝나면 다시 시작할 수 있다', () => {
  const f = createSingleFlight();
  assert.equal(f.tryStart('order-1'), true);
  assert.equal(f.tryStart('order-1'), false);
  assert.equal(f.tryStart('order-2'), false);
  f.finish();
  assert.equal(f.tryStart('order-2'), true);
});

/* ---------- 주문 응답 ---------- */
test('주문 응답의 옵션 식별자(groupId·optionId)를 읽는다. 없거나 모양이 다르면 버린다', () => {
  const dto = (opt) => ({ orderId: 'o', status: 'USER_CONFIRMED', statusRevision: 2, createdAt: 't', completedAt: null, cancelledAt: null, totalAmount: 100,
    snapshot: { store: { id: 's', name: 'n', imageRef: null, categoryName: 'c' }, items: [{ menuId: 'm', menuName: 'n', menuImageRef: null, unitPrice: 100, quantity: 1, lineTotal: 100, options: [opt] }] } });
  const base = { groupName: 'g', optionName: 'o', additionalPrice: 0, quantity: 1 };
  const withIds = parseOrderDto(dto({ ...base, groupId: 'G', optionId: 'O' }), 'k').snapshot.items[0].options[0];
  assert.equal(withIds.optionId, 'O');
  assert.equal(withIds.groupId, 'G');
  const legacy = parseOrderDto(dto(base), 'k').snapshot.items[0].options[0];
  assert.equal('optionId' in legacy, false);
  assert.equal('optionId' in parseOrderDto(dto({ ...base, groupId: 'G' }), 'k').snapshot.items[0].options[0], false);
});

test('모의 서버 주문 기록도 옵션 식별자를 담는다', () => {
  const { mockMenus } = require('../../src/mocks/catalog/data.ts');
  const m = mockMenus.find((x) => x.optionGroups.length > 0 && x.optionGroups[0].options.length > 0);
  const o = m.optionGroups[0].options[0];
  const { snapshot } = buildSnapshot(m.storeId, [{ menuId: m.id, optionIds: [o.id], quantity: 1 }], { bankName: 'b', last4: '1234' });
  assert.equal(snapshot.items[0].options[0].optionId, o.id);
  assert.equal(snapshot.items[0].options[0].groupId, m.optionGroups[0].id);
});

/* ---------- 내역 카드의 메뉴 표시: 첫 메뉴 외 N건 (N = 주문 항목 수 − 1) ---------- */
test('메뉴 표시: 주문 항목 1개면 이름만(수량이 여러 개여도), 2개 이상이면 외 N건. 옵션이 달라 나뉜 같은 메뉴도 각각 센다', () => {
  const { orderMenuLabel } = require('../../src/features/history/history-model.ts');
  const it = (name, quantity = 1) => ({ menuId: M1, menuName: name, menuImageRef: null, unitPrice: 1, quantity, lineTotal: quantity, options: [] });
  const snap = (...items) => ({ items });
  assert.equal(orderMenuLabel(snap(it('치킨'))), '치킨');
  assert.equal(orderMenuLabel(snap(it('치킨', 3))), '치킨');
  assert.equal(orderMenuLabel(snap(it('치킨'), it('치즈볼'))), '치킨 외 1건');
  assert.equal(orderMenuLabel(snap(it('치킨'), it('치즈볼'), it('소스'))), '치킨 외 2건');
  assert.equal(orderMenuLabel(snap(it('치킨'), it('치킨'))), '치킨 외 1건');
  assert.equal(orderMenuLabel(snap(it('치킨', 5), it('치즈볼', 9))), '치킨 외 1건'); // 수량이 아니라 항목 수
});
