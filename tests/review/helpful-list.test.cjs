/**
 * 가게 리뷰 목록의 함께해요(도움돼요) 표시 로직 시험.
 * 실제 코드(src)를 변환해 실행하고, 서비스·로그인·화면 이동만 메모리 대역으로 바꾼다. 실서버·실제 화면 시험이 아니다.
 * 목록 화면(review-list-section)이 하는 계산 liveReview → helpfulView를 그대로 흉내 낸다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const srcRoot = path.join(root, 'src') + path.sep;
globalThis.__DEV__ = false;
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.React },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request.startsWith('@/')) return originalResolve.call(this, path.join(srcRoot, request.slice(2)), ...rest);
  return originalResolve.call(this, request, ...rest);
};

let setHelpfulImpl = async () => ({ reviewId: '', helpful: true, helpfulCount: 0 });
const setHelpfulCalls = [];
let isMember = true;
const stubs = {
  '@/services': { reviewService: { setHelpful: (args) => { setHelpfulCalls.push(args); return setHelpfulImpl(args); } } },
  '@/services/session': { getSession: () => ({ isMember }) },
  '@/features/order/flow-routes': { goLogin: () => {} },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};

const { useReviewStore } = require('@/features/review/review-store');
const { helpfulView, liveReview } = require('@/features/review/review-model');

const R1 = 'r-1';
// 목록을 처음 받았을 때의 리뷰(남이 쓴 리뷰, 내가 아직 안 누름, 개수 2)
const listed = () => ({ reviewId: R1, helpfulCount: 2, myHelpful: false, isMine: false });

/** 목록 화면이 카드를 그릴 때 하는 계산 */
const cardView = (listedReview) => {
  const s = useReviewStore.getState();
  const review = liveReview(s.byId, listedReview);
  return { review, ...helpfulView(review, s.helpfulOverlay[review.reviewId]) };
};
/** 옛 방식(목록의 처음 값으로만 계산) — 버그 재현용 */
const oldCardView = (listedReview) => helpfulView(listedReview, useReviewStore.getState().helpfulOverlay[listedReview.reviewId]);

const resetStore = () => {
  useReviewStore.setState({ byId: {}, helpfulOverlay: {}, inflight: {}, mutationVersion: 0 });
  setHelpfulCalls.length = 0;
  isMember = true;
};

test('liveReview: store에 있으면 최신 값, 없으면 목록의 값', () => {
  const a = { reviewId: 'a', helpfulCount: 1, myHelpful: false };
  const b = { reviewId: 'a', helpfulCount: 5, myHelpful: true };
  assert.equal(liveReview({ a: b }, a), b);
  assert.equal(liveReview({}, a), a);
});

test('누르면 서버 응답 뒤에도 눌린 상태·개수가 유지된다 (예전 방식은 풀려 보였다)', async () => {
  resetStore();
  const l = listed();
  useReviewStore.getState().merge([l]);
  setHelpfulImpl = async () => ({ reviewId: R1, helpful: true, helpfulCount: 3 });

  const pending = useReviewStore.getState().toggleHelpful(cardView(l).review, true);
  assert.deepEqual({ active: cardView(l).active, count: cardView(l).count }, { active: true, count: 3 }, '응답 전: 낙관적 표시(누름 · 2+1)');
  await pending;

  assert.deepEqual(useReviewStore.getState().helpfulOverlay, {}, '응답 뒤 overlay는 지워진다');
  const now = cardView(l);
  assert.deepEqual({ active: now.active, count: now.count }, { active: true, count: 3 }, '응답 뒤: 서버가 저장한 값(누름 · 3)');
  // 버그 재현: 목록의 처음 값으로 그리면 눌림이 풀린 것처럼 보였다
  assert.deepEqual(oldCardView(l), { active: false, count: 2 });
});

test('다시 누르면 해제되고, 해제 요청에는 카드가 가진 최신 값 기준의 목표값(false)이 간다', async () => {
  resetStore();
  const l = listed();
  useReviewStore.getState().merge([l]);
  setHelpfulImpl = async ({ desired }) => ({ reviewId: R1, helpful: desired, helpfulCount: desired ? 3 : 2 });

  await useReviewStore.getState().toggleHelpful(cardView(l).review, true);
  // 카드는 active=true를 보여 주므로 다시 누르면 next=false
  const before = cardView(l);
  assert.equal(before.active, true);
  await useReviewStore.getState().toggleHelpful(before.review, !before.active);

  assert.deepEqual(setHelpfulCalls.map((c) => c.desired), [true, false]);
  const now = cardView(l);
  assert.deepEqual({ active: now.active, count: now.count }, { active: false, count: 2 }, '해제 뒤: 안 누름 · 2');
});

test('목록을 다시 불러와(정렬·필터·더 보기) 서버의 최신 값이 합쳐져도 눌린 상태가 유지된다', async () => {
  resetStore();
  const l = listed();
  useReviewStore.getState().merge([l]);
  setHelpfulImpl = async () => ({ reviewId: R1, helpful: true, helpfulCount: 3 });
  await useReviewStore.getState().toggleHelpful(cardView(l).review, true);

  // 다시 불러온 목록의 리뷰: 서버는 이미 저장된 값을 준다
  const refetched = { reviewId: R1, helpfulCount: 3, myHelpful: true, isMine: false };
  useReviewStore.getState().merge([refetched]);
  const now = cardView(refetched);
  assert.deepEqual({ active: now.active, count: now.count }, { active: true, count: 3 });
  // 화면에 남아 있던 옛 목록 항목(l)으로 그려도 같다
  const old = cardView(l);
  assert.deepEqual({ active: old.active, count: old.count }, { active: true, count: 3 });
});

test('요청이 진행 중일 때 옛 목록 값을 다시 받아 합쳐도 낙관적 표시가 깨지지 않는다', async () => {
  resetStore();
  const l = listed();
  useReviewStore.getState().merge([l]);
  let release;
  setHelpfulImpl = () => new Promise((resolve) => { release = () => resolve({ reviewId: R1, helpful: true, helpfulCount: 3 }); });
  const pending = useReviewStore.getState().toggleHelpful(cardView(l).review, true);

  useReviewStore.getState().merge([listed()]); // 저장 전에 받은 목록이 늦게 도착
  const during = cardView(l);
  assert.deepEqual({ active: during.active, count: during.count }, { active: true, count: 3 }, '진행 중: overlay가 계속 보여 준다');
  release();
  await pending;
  const after = cardView(l);
  assert.deepEqual({ active: after.active, count: after.count }, { active: true, count: 3 });
});

test('실패하면 누르기 전 값으로 돌아간다', async () => {
  resetStore();
  const l = listed();
  useReviewStore.getState().merge([l]);
  setHelpfulImpl = async () => { throw new Error('network'); };
  await useReviewStore.getState().toggleHelpful(cardView(l).review, true);
  const now = cardView(l);
  assert.deepEqual({ active: now.active, count: now.count }, { active: false, count: 2 });
  assert.deepEqual(useReviewStore.getState().inflight, {});
});

test('같은 리뷰에 요청이 진행 중이면 다음 누름은 기다린다 (요청은 한 번)', async () => {
  resetStore();
  const l = listed();
  useReviewStore.getState().merge([l]);
  let release;
  setHelpfulImpl = () => new Promise((resolve) => { release = () => resolve({ reviewId: R1, helpful: true, helpfulCount: 3 }); });
  const first = useReviewStore.getState().toggleHelpful(cardView(l).review, true);
  await useReviewStore.getState().toggleHelpful(cardView(l).review, false);
  assert.equal(setHelpfulCalls.length, 1);
  release();
  await first;
});

test('Guest는 서버를 부르지 않는다', async () => {
  resetStore();
  isMember = false;
  const l = listed();
  useReviewStore.getState().merge([l]);
  await useReviewStore.getState().toggleHelpful(l, true);
  assert.equal(setHelpfulCalls.length, 0);
  const now = cardView(l);
  assert.deepEqual({ active: now.active, count: now.count }, { active: false, count: 2 });
});
