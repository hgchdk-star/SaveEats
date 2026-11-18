/**
 * 카테고리 칩의 음식 이미지 (FR-CAT-001). 디자인 시스템(Claude Design)의 샘플 음식 일러스트를 그대로 옮겼다.
 * 서버 카테고리 응답에는 이미지가 없어서 앱에 넣어 두고 카테고리 코드로 연결한다.
 * 디자인에 이미지가 있는 카테고리만 여기 있다. 중식·일식·버거는 디자인에도 이미지가 없어서 칩이 이름 첫 글자로 보인다.
 * 새 이미지가 정해지면 아래 SVG 본문만 추가하거나 바꾼다. 코드는 서버 카테고리 코드(list_categories의 code)다.
 */
const FOODS: Record<string, string> = {
  chicken:
    '<rect width="120" height="120" fill="#E9D8C4"/><circle cx="60" cy="60" r="46" fill="#FFFFFF"/><circle cx="60" cy="60" r="40" fill="#F7EFE6"/>' +
    '<ellipse cx="46" cy="50" rx="16" ry="12" fill="#C9772C" transform="rotate(-20 46 50)"/><ellipse cx="72" cy="46" rx="15" ry="11" fill="#D98A3A" transform="rotate(25 72 46)"/>' +
    '<ellipse cx="54" cy="74" rx="17" ry="12" fill="#BF6B24" transform="rotate(10 54 74)"/><ellipse cx="78" cy="72" rx="12" ry="10" fill="#D4852F"/>' +
    '<circle cx="44" cy="47" r="2" fill="#F2C07A"/><circle cx="70" cy="44" r="2" fill="#F2C07A"/><circle cx="57" cy="72" r="2" fill="#F2C07A"/><circle cx="92" cy="30" r="9" fill="#FFFFFF"/><circle cx="92" cy="30" r="6" fill="#B8341F"/>',
  tteokbokki:
    '<rect width="120" height="120" fill="#3B302A"/><circle cx="60" cy="60" r="48" fill="#F3ECE4"/><circle cx="60" cy="60" r="40" fill="#D2432A"/>' +
    '<rect x="36" y="44" width="26" height="10" rx="5" fill="#F6E4CC" transform="rotate(-25 49 49)"/><rect x="58" y="36" width="26" height="10" rx="5" fill="#F6E4CC" transform="rotate(15 71 41)"/>' +
    '<rect x="40" y="66" width="26" height="10" rx="5" fill="#F3DDC1" transform="rotate(20 53 71)"/><rect x="64" y="62" width="24" height="10" rx="5" fill="#F6E4CC" transform="rotate(-10 76 67)"/>' +
    '<ellipse cx="74" cy="82" rx="10" ry="8" fill="#FFFFFF"/><circle cx="74" cy="82" r="4.5" fill="#F2B33A"/><path d="M40 60h8M46 88l6-3M84 50l5 4" stroke="#6BA34A" stroke-width="3" stroke-linecap="round"/>',
  pizza:
    '<rect width="120" height="120" fill="#D8BF9E"/><circle cx="60" cy="60" r="47" fill="#DFA54B"/><circle cx="60" cy="60" r="40" fill="#F1C766"/>' +
    '<circle cx="45" cy="45" r="7" fill="#C2381F"/><circle cx="72" cy="42" r="7" fill="#C2381F"/><circle cx="58" cy="62" r="7" fill="#C2381F"/><circle cx="80" cy="68" r="7" fill="#C2381F"/><circle cx="44" cy="76" r="7" fill="#C2381F"/><circle cx="66" cy="84" r="6" fill="#C2381F"/>' +
    '<ellipse cx="60" cy="44" rx="4" ry="2.5" fill="#4F8A3A"/><ellipse cx="48" cy="62" rx="4" ry="2.5" fill="#4F8A3A" transform="rotate(40 48 62)"/><ellipse cx="74" cy="56" rx="4" ry="2.5" fill="#4F8A3A"/>' +
    '<path d="M60 13v94M13 60h94M27 27l66 66M93 27 27 93" stroke="#D9A04A" stroke-width="1.2" opacity=".7"/>',
  bibimbap:
    '<rect width="120" height="120" fill="#EFE3D5"/><circle cx="60" cy="60" r="48" fill="#2E2926"/><circle cx="60" cy="60" r="41" fill="#F4EEE6"/>' +
    '<path d="M60 60 60 19A41 41 0 0 1 95.5 39.5z" fill="#E9803A"/><path d="M60 60 95.5 39.5A41 41 0 0 1 95.5 80.5z" fill="#5C9A45"/><path d="M60 60 95.5 80.5A41 41 0 0 1 60 101z" fill="#8A4B2E"/>' +
    '<path d="M60 60 60 101A41 41 0 0 1 24.5 80.5z" fill="#F2D06B"/><path d="M60 60 24.5 80.5A41 41 0 0 1 24.5 39.5z" fill="#3F7A3A"/><path d="M60 60 24.5 39.5A41 41 0 0 1 60 19z" fill="#C9432E"/>' +
    '<circle cx="60" cy="60" r="15" fill="#FFFFFF"/><circle cx="60" cy="60" r="7" fill="#F4A824"/>',
  dessert:
    '<rect width="120" height="120" fill="#EADBD0"/><circle cx="60" cy="60" r="46" fill="#FFFFFF"/><circle cx="60" cy="60" r="30" fill="#F7E4D0"/>' +
    '<circle cx="60" cy="60" r="22" fill="#FBF3EA"/><path d="M52 52c6-6 14 2 8 8s-14-2-8-8z" fill="#D9B08A"/><circle cx="92" cy="86" r="8" fill="#C8371F"/><circle cx="84" cy="94" r="6" fill="#B02E1A"/><ellipse cx="96" cy="78" rx="4" ry="2" fill="#4F8A3A"/>',
};

/** 서버 카테고리 코드 → 그릴 음식. 디자인에 이미지가 있는 카테고리만 있다 */
const BY_CATEGORY_CODE: Record<string, keyof typeof FOODS> = {
  chicken: 'chicken',
  bunsik: 'tteokbokki',
  pizza: 'pizza',
  korean: 'bibimbap',
  cafe_dessert: 'dessert',
};

const toDataUri = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice">${body}</svg>`)}`;

const CACHE: Record<string, string> = {};

/** 카테고리 칩 이미지. 이미지가 없는 카테고리는 null이고, 칩이 이름 첫 글자를 보여 준다 */
export function categoryImageUri(categoryCode: string): string | null {
  const food = BY_CATEGORY_CODE[categoryCode];
  if (!food) return null;
  CACHE[food] ??= toDataUri(FOODS[food]);
  return CACHE[food];
}
