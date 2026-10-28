import type { CategoryDto } from '@/contracts/catalog';
import { RepositoryError, type CatalogFailureCode } from '@/services/catalog/catalog-repository';

/**
 * Supabase RPC 응답을 앱의 계약 타입과 오류로 바꾼다. 화면은 SDK·PostgREST의 모양을 모른다.
 * 계약 catalog@0.1의 오류 규칙(SEC-008):
 *  - 서버 업무 오류는 SQLSTATE P0001이고 message가 오류 코드다
 *  - 22P02(UUID 형식 오류)는 INVALID_INPUT, 42501(실행 권한 없음)은 AUTH_REQUIRED
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

/**
 * list_categories 응답이 CategoryDto[] 모양인지 확인한다. 서버와 계약이 어긋나면 잘못된 값을 화면에 보여주지 않고
 * INTERNAL_ERROR로 실패시킨다(빈 목록으로 보이게 하지 않는다).
 */
export function parseCategories(data: unknown): CategoryDto[] {
  if (!Array.isArray(data)) throw failure('INTERNAL_ERROR', 'INTERNAL');
  return data.map((row: unknown) => {
    const r = row as Record<string, unknown> | null;
    if (!r || typeof r.id !== 'string' || typeof r.code !== 'string' || typeof r.name !== 'string' || typeof r.sortOrder !== 'number') {
      throw failure('INTERNAL_ERROR', 'INTERNAL');
    }
    return { id: r.id, code: r.code, name: r.name, sortOrder: r.sortOrder };
  });
}
