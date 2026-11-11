const test = require('node:test');
const assert = require('node:assert/strict');
require('../order/harness.cjs'); // TS 변환 준비만 쓴다
const { BANKS, normalizeBankCode } = require('../../src/services/account/banks.ts');
const { buildSections, searchBanks, featuredBanks, otherBanks, securitiesList } = require('../../src/components/ui/bank-list.ts');

const codes = (list) => list.map((b) => b.bankCode);

test('토스 코드 표 48개에서 토스머니·토스포인트를 뺀 46개, 코드는 문자열이고 앞자리 0이 남는다', () => {
  assert.equal(BANKS.length, 46);
  assert.equal(new Set(codes(BANKS)).size, 46);
  assert.ok(!codes(BANKS).includes('888') && !codes(BANKS).includes('889'));
  for (const b of BANKS) assert.match(b.bankCode, /^\d{3}$/);
  assert.ok(codes(BANKS).includes('004') && codes(BANKS).includes('002'));
});

test('주요 은행은 정해진 순서 9개', () => {
  assert.deepEqual(codes(featuredBanks(BANKS)), ['092', '090', '004', '088', '020', '081', '011', '003', '089']);
});

test('그 외 은행·상호금융은 주요 은행·증권사를 빼고 이름순, 중복 없음', () => {
  const others = otherBanks(BANKS);
  const featured = new Set(codes(featuredBanks(BANKS)));
  assert.ok(others.every((b) => b.kind === 'bank' && !featured.has(b.bankCode)));
  assert.equal(others.length + featured.size, 26);
  const names = others.map((b) => b.bankName);
  assert.deepEqual(names, [...names].sort());
  for (const code of ['071', '050', '005', '048']) assert.ok(codes(others).includes(code));
});

test('증권사는 모두, 이름이 같아도 코드가 다르면 둘 다 유지', () => {
  const s = securitiesList(BANKS);
  assert.equal(s.length, 20);
  assert.deepEqual(codes(s).filter((c) => c === '230' || c === '238'), ['230', '238']);
  const names = s.map((b) => b.bankName);
  assert.deepEqual(names, [...names].sort());
});

test('탭별 섹션 구성', () => {
  assert.deepEqual(buildSections(BANKS, 'bank').map((s) => s.title), ['주요 은행', '그 외 은행·상호금융']);
  assert.deepEqual(buildSections(BANKS, 'securities').map((s) => s.title), [null]);
});

test('검색: 부분 일치, 공백 무시, 별칭, 전체 탭 대상', () => {
  assert.ok(codes(searchBanks(BANKS, '국민')).includes('004'));
  assert.ok(codes(searchBanks(BANKS, ' 농 협 ')).includes('011'));
  assert.ok(codes(searchBanks(BANKS, '기업')).includes('003'));
  assert.deepEqual(codes(searchBanks(BANKS, '카카오')), ['090']);
  const toss = codes(searchBanks(BANKS, '토스'));
  assert.ok(toss.includes('092') && toss.includes('271'));
  assert.deepEqual(codes(searchBanks(BANKS, '미래에셋')).sort(), ['230', '238']);
  assert.ok(codes(searchBanks(BANKS, 'kb')).includes('218'));
});

test('하나은행과 KEB하나은행은 합치지 않는다', () => {
  const hana = codes(searchBanks(BANKS, '하나'));
  assert.ok(hana.includes('081') && hana.includes('005') && hana.includes('270'));
  assert.equal(BANKS.find((b) => b.bankCode === '005').bankName, 'KEB하나은행');
});

test('검색어가 비었거나 결과가 없으면 빈 목록', () => {
  assert.deepEqual(searchBanks(BANKS, '   '), []);
  assert.deepEqual(searchBanks(BANKS, '없는은행zzz'), []);
});

test('예전 저장 코드는 지금 코드로 읽고, 새 코드는 그대로', () => {
  assert.equal(normalizeBankCode('KB'), '004');
  assert.equal(normalizeBankCode('TOSS'), '092');
  assert.equal(normalizeBankCode('004'), '004');
  assert.equal(normalizeBankCode(null), null);
  for (const legacy of ['TOSS', 'KAKAO', 'KB', 'SHINHAN', 'WOORI', 'HANA', 'NH', 'IBK']) assert.ok(codes(BANKS).includes(normalizeBankCode(legacy)));
});
