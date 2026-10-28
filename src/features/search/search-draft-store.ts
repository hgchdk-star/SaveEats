import { create } from 'zustand';

/**
 * 검색 입력창의 글자와 포커스 요청. 검색 전 화면(㉑)과 결과 화면(㉒)이 같이 쓴다.
 * 이 기기에서 앱이 켜져 있는 동안만 유지하고 저장하지 않는다(저장하는 것은 최근 검색어뿐이다).
 *
 * - 결과 화면에서 뒤로 가도 검색어가 입력창에 그대로 남는다
 * - 결과 화면의 검색창을 누르면 ㉑로 돌아가 커서가 있고, ✕를 누르면 ㉑로 돌아가며 입력창을 비운다
 */
type SearchDraft = {
  query: string;
  /** ㉑로 돌아온 뒤 입력창에 커서를 둘지 */
  focusRequested: boolean;
  setQuery: (query: string) => void;
  requestFocus: () => void;
  consumeFocus: () => void;
};

export const useSearchDraftStore = create<SearchDraft>((set) => ({
  query: '',
  focusRequested: false,
  setQuery: (query) => set({ query }),
  requestFocus: () => set({ focusRequested: true }),
  consumeFocus: () => set({ focusRequested: false }),
}));
