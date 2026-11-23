import type { MenuGroupDto, MenuSummaryDto } from '@/contracts/catalog';
import type { Uuid } from '@/contracts/common';

/**
 * 가게 상세 '메뉴' 탭의 구역(섹션) 계산. 화면 없이 시험할 수 있게 순수 함수로 둔다.
 * - 메뉴 본체는 menus에 한 번만 있고 그룹은 메뉴 id만 가진다. 여러 그룹에 같은 메뉴가 있어도 본체는 복제되지 않는다.
 * - 그룹 순서와 그룹 안 메뉴 순서는 서버가 준 그대로다. 앱이 정렬을 바꾸지 않는다.
 * - 어느 그룹에도 없는 활성 메뉴는 '기타 메뉴' 구역으로 모은다. 조용히 빠지지 않는다.
 * - 그룹이 하나도 없는 가게는 구역 없이 평평한 목록이다.
 */

export type MenuSection = {
  /** 그룹 id. 그룹에 없는 메뉴를 모은 구역은 UNGROUPED_SECTION_ID */
  id: string;
  title: string;
  menus: MenuSummaryDto[];
};

export const UNGROUPED_SECTION_ID = '__ungrouped__';

export type MenuSectionsResult = {
  /** 그룹이 있어서 탭·구역으로 보여 줄 때 true. false면 menus를 그대로 평평하게 보여 준다 */
  grouped: boolean;
  sections: MenuSection[];
  /** 그룹이 가리키지만 menus에 없는 메뉴 id(데이터 불일치). 화면에는 쓰지 않고 진단용 */
  unknownMenuIds: Uuid[];
  /** 어느 그룹에도 없어 '기타 메뉴'로 모은 메뉴 수 */
  ungroupedCount: number;
};

export function buildMenuSections(menus: readonly MenuSummaryDto[], groups: readonly MenuGroupDto[] | undefined, ungroupedTitle: string): MenuSectionsResult {
  const byId = new Map<Uuid, MenuSummaryDto>();
  for (const m of menus) if (!byId.has(m.id)) byId.set(m.id, m);

  if (!groups || groups.length === 0) {
    return { grouped: false, sections: [], unknownMenuIds: [], ungroupedCount: 0 };
  }

  const sections: MenuSection[] = [];
  const unknown: Uuid[] = [];
  const grouped = new Set<Uuid>();
  for (const g of groups) {
    const seen = new Set<Uuid>(); // 같은 그룹 안 중복 id는 한 번만
    const items: MenuSummaryDto[] = [];
    for (const id of g.menuIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const menu = byId.get(id);
      if (!menu) {
        unknown.push(id);
        continue;
      }
      items.push(menu);
      grouped.add(id);
    }
    if (items.length > 0) sections.push({ id: g.id, title: g.name, menus: items }); // 빈 그룹은 보이지 않는다
  }

  const rest = [...byId.values()].filter((m) => !grouped.has(m.id));
  if (rest.length > 0) sections.push({ id: UNGROUPED_SECTION_ID, title: ungroupedTitle, menus: rest });

  return { grouped: sections.length > 0, sections, unknownMenuIds: unknown, ungroupedCount: rest.length };
}

/** 구역 순서대로 펼친 메뉴 목록. 같은 메뉴는 처음 나온 자리에 한 번만 */
export function flattenSections(sections: readonly MenuSection[]): MenuSummaryDto[] {
  const seen = new Set<Uuid>();
  const out: MenuSummaryDto[] = [];
  for (const s of sections) {
    for (const m of s.menus) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** 검색용 정규화: 유니코드 정규화(NFC) + 소문자 + 모든 공백(보이지 않는 공백 포함) 제거 */
export function normalizeForSearch(input: string): string {
  return input.normalize('NFC').toLowerCase().replace(/[\s​-‍﻿]+/g, '');
}

/**
 * 현재 가게 메뉴 이름 검색. 이미 불러온 활성 메뉴 전체(menus)를 대상으로 한다(일부만 보지 않는다).
 * 결과는 화면에 보이는 순서(구역 순서 → 그룹 안 순서)이고 같은 메뉴는 한 번만 나온다.
 * 검색어가 비면(공백뿐 포함) null을 돌려 "검색 중이 아님"을 알린다.
 */
export function searchMenus(menus: readonly MenuSummaryDto[], sections: readonly MenuSection[], query: string): MenuSummaryDto[] | null {
  const needle = normalizeForSearch(query);
  if (needle.length === 0) return null;
  // 보이는 순서: 구역이 있으면 구역 순서대로, 없으면 menus 순서. 그룹에 없는 메뉴도 빠지지 않게 menus로 마무리한다
  const ordered = sections.length > 0 ? flattenSections(sections) : [...menus];
  const known = new Set(ordered.map((m) => m.id));
  for (const m of menus) if (!known.has(m.id)) ordered.push(m);
  const seen = new Set<Uuid>();
  const out: MenuSummaryDto[] = [];
  for (const m of ordered) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (normalizeForSearch(m.name).includes(needle)) out.push(m);
  }
  return out;
}

/**
 * 스크롤 위치로 지금 보고 있는 구역의 인덱스를 구한다.
 * offsets: 각 구역 제목의 화면 안(스크롤 내용 기준) y 위치, 위에서 아래 순서.
 * 구역 제목이 고정 헤더 아래(headerHeight)에 닿았거나 지나갔으면 그 구역을 본 것으로 본다.
 */
export function activeSectionIndex(offsets: readonly number[], scrollY: number, headerHeight: number, slack = 4): number {
  if (offsets.length === 0) return 0;
  const line = scrollY + headerHeight + slack;
  let active = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i] <= line) active = i;
    else break;
  }
  return active;
}

/** 탭을 눌렀을 때 맞춰 스크롤할 y. 구역 제목이 고정 헤더 바로 아래에 오게 한다(0 아래로는 가지 않는다) */
export function scrollTargetForSection(sectionY: number, headerHeight: number): number {
  return Math.max(0, sectionY - headerHeight);
}

/**
 * 가게 안 검색어가 바뀔 때의 전환. 검색 시작(START)에는 지금 위치·선택 그룹을 저장하고,
 * 검색 끝(END)에는 저장한 위치로 복원한다. 검색어는 공백·대소문자를 무시한 뒤 비어 있는지로 본다.
 */
export function searchTransition(prev: string, next: string): 'START' | 'END' | 'NONE' {
  const was = normalizeForSearch(prev).length > 0;
  const will = normalizeForSearch(next).length > 0;
  if (!was && will) return 'START';
  if (was && !will) return 'END';
  return 'NONE';
}

/**
 * 검색을 시작할 때 결과가 고정 영역 바로 아래에서 시작하도록 스크롤할 y.
 * 이미 고정 영역 위쪽(맨 위 근처)에 있으면 null(움직이지 않는다).
 * anchorY: 고정 영역이 원래 놓인 y(스크롤 내용 기준), barHeight: 위에 항상 보이는 상단 바 높이.
 */
export function searchAnchorScroll(scrollY: number, anchorY: number, barHeight: number): number | null {
  const pinnedAt = Math.max(0, anchorY - barHeight);
  return scrollY > pinnedAt ? pinnedAt : null;
}

/** 고정 영역(검색+그룹 탭)이 위로 올라가다 상단 바 아래에 멈추기까지의 스크롤 구간 [0, 끝]. 끝은 1 이상이다 */
export function stickyScrollRange(anchorY: number, barHeight: number): [number, number] {
  return [0, Math.max(1, anchorY - barHeight)];
}

/**
 * 고정 영역의 세로 위치 보간표. 스크롤 0 이상은 [원래 자리 → 상단 바 아래]로 올라가다 멈추고(오른쪽 고정),
 * 맨 위에서 아래로 당긴 음수 스크롤(오버스크롤)에서는 본문과 같은 거리만큼 따라 내려온다(왼쪽은 기울기 -1로 연장).
 * 놓으면 스크롤이 0으로 돌아오므로 위치도 원래 자리로 돌아온다.
 */
export function stickyTranslateInterpolation(anchorY: number, barHeight: number): { inputRange: number[]; outputRange: number[] } {
  const end = stickyScrollRange(anchorY, barHeight)[1];
  return { inputRange: [-1, 0, end], outputRange: [anchorY + 1, anchorY, barHeight] };
}
