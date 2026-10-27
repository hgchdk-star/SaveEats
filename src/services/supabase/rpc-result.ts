import type { CategoryDto, MenuDetailDto, MenuSummaryDto, StoreCardDto, StoreDetailDto } from '@/contracts/catalog';
import type { Page } from '@/contracts/common';
import { RepositoryError, type CatalogFailureCode } from '@/services/catalog/catalog-repository';

/**
 * Supabase RPC 응답을 앱의 계약 타입과 오류로 바꾼다. 화면은 SDK·PostgREST의 모양을 모른다.
 * 계약 catalog@0.1의 오류 규칙(SEC-008):
 *  - 서버 업무 오류는 SQLSTATE P0001이고 message가 오류 코드다
 *  - 22P02(UUID 형식 오류)는 INVALID_INPUT, 42501(실행 권한 없음)은 AUTH_REQUIRED
 *
 * 응답이 계약 모양이 아니면 잘못된 값을 화면에 보여주지 않고 INTERNAL_ERROR로 실패시킨다(빈 목록처럼 보이게 하지 않는다).
 * 여기서는 화면이 실제로 읽는 필드의 존재와 종류만 확인한다. 모든 필드를 다시 검증하지는 않는다.
 */
export type PostgrestLikeError = { code?: string; message?: string; name?: string } | null | undefined;

const BUSINESS_CODES: readonly string[] = ['INVALID_INPUT', 'RESOURCE_NOT_FOUND', 'AUTH_REQUIRED'];

function failure(code: CatalogFailureCode, category: 'NETWORK' | 'AUTH' | 'VALIDATION' | 'INTERNAL'): RepositoryError {
  return new RepositoryError({
    code,
    category,
    retryable: category === 'NETWORK' || category === 'INTERNAL',
    outcomeUnknown: false,
    correlationId: null,
  });
}

const contractViolation = () => failure('INTERNAL_ERROR', 'INTERNAL');

/** PostgREST/네트워크 오류를 RepositoryError로. 원문 메시지는 화면에 넘기지 않는다 */
export function toRepositoryError(error: NonNullable<PostgrestLikeError>): RepositoryError {
  if (error.name === 'AbortError') return failure('REQUEST_TIMEOUT', 'NETWORK');
  if (error.code === 'P0001' && error.message && BUSINESS_CODES.includes(error.message)) {
    const code = error.message as CatalogFailureCode;
    return failure(code, code === 'AUTH_REQUIRED' ? 'AUTH' : 'VALIDATION');
  }
  if (error.code === '22P02') return failure('INVALID_INPUT', 'VALIDATION');
  if (error.code === '42501') return failure('AUTH_REQUIRED', 'AUTH');
  // 서버가 응답한 오류는 code가 있다. 없으면 응답 자체를 받지 못한 것(오프라인·연결 실패)이다
  if (!error.code) return failure('NETWORK_UNAVAILABLE', 'NETWORK');
  return failure('INTERNAL_ERROR', 'INTERNAL');
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

function need(ok: boolean): void {
  if (!ok) throw contractViolation();
}

export function parseCategories(data: unknown): CategoryDto[] {
  need(Array.isArray(data));
  return (data as unknown[]).map((row) => {
    need(isObj(row) && isStr(row.id) && isStr(row.code) && isStr(row.name) && isNum(row.sortOrder));
    const r = row as Obj;
    return { id: r.id as string, code: r.code as string, name: r.name as string, sortOrder: r.sortOrder as number };
  });
}

function checkReviewSummary(v: unknown): void {
  need(isObj(v) && isNum(v.count) && (v.averageCravingRating === null || isNum(v.averageCravingRating)));
}

function checkCategoryRef(v: unknown): void {
  need(isObj(v) && isStr(v.id) && isStr(v.code) && isStr(v.name));
}

function checkStoreCard(v: unknown): StoreCardDto {
  need(isObj(v) && isStr(v.id) && isStr(v.name) && isStrOrNull(v.imageRef) && isBool(v.isOpen) && isBool(v.isRecommended));
  const s = v as Obj;
  checkCategoryRef(s.category);
  checkReviewSummary(s.reviewSummary);
  need(s.isFavorite === null || isBool(s.isFavorite));
  const rep = s.representativeMenu;
  need(rep === null || (isObj(rep) && isStr(rep.id) && isStr(rep.name) && isNum(rep.price) && isBool(rep.isSoldOut)));
  return s as unknown as StoreCardDto;
}

/** list_recommended_stores 응답: StoreCardDto[] (페이지 없음) */
export function parseStoreCardList(data: unknown): StoreCardDto[] {
  need(Array.isArray(data));
  return (data as unknown[]).map(checkStoreCard);
}

/** list_stores 응답: { items, nextCursor, hasMore } */
export function parseStoreCardPage(data: unknown): Page<StoreCardDto> {
  need(isObj(data) && Array.isArray(data.items) && isBool(data.hasMore) && isStrOrNull(data.nextCursor));
  const d = data as Obj;
  return { items: (d.items as unknown[]).map(checkStoreCard), nextCursor: d.nextCursor as string | null, hasMore: d.hasMore as boolean };
}

function checkMenuSummary(v: unknown): MenuSummaryDto {
  need(isObj(v) && isStr(v.id) && isStr(v.name) && isStrOrNull(v.description) && isStrOrNull(v.imageRef) && isNum(v.price) && isBool(v.isSoldOut));
  return v as unknown as MenuSummaryDto;
}

export function parseStoreDetail(data: unknown): StoreDetailDto {
  need(isObj(data) && isStr(data.id) && isStr(data.name) && isStrOrNull(data.description) && isStrOrNull(data.imageRef) && isBool(data.isOpen) && isBool(data.isRecommended));
  const s = data as Obj;
  checkCategoryRef(s.category);
  checkReviewSummary(s.reviewSummary);
  need(s.isFavorite === null || isBool(s.isFavorite));
  need(Array.isArray(s.menus));
  (s.menus as unknown[]).forEach(checkMenuSummary);
  return s as unknown as StoreDetailDto;
}

export function parseMenuDetail(data: unknown): MenuDetailDto {
  need(
    isObj(data) &&
      isStr(data.id) &&
      isStr(data.storeId) &&
      isBool(data.storeIsOpen) &&
      isStr(data.name) &&
      isStrOrNull(data.description) &&
      isStrOrNull(data.imageRef) &&
      isNum(data.price) &&
      isNum(data.catalogRevision) &&
      isBool(data.isSoldOut) &&
      Array.isArray(data.optionGroups),
  );
  const m = data as Obj;
  for (const g of m.optionGroups as unknown[]) {
    need(isObj(g) && isStr(g.id) && isStr(g.name) && isNum(g.minSelect) && isNum(g.maxSelect) && Array.isArray(g.options));
    for (const o of (g as Obj).options as unknown[]) {
      need(isObj(o) && isStr(o.id) && isStr(o.name) && isNum(o.additionalPrice) && isBool(o.isSoldOut));
    }
  }
  return m as unknown as MenuDetailDto;
}
