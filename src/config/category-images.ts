/**
 * 카테고리 칩의 음식 그림 (FR-CAT-001). 서버 카테고리 응답에는 이미지가 없어서 앱에 SVG로 두고 카테고리 코드로 연결한다.
 * 피자·한식은 디자인 자료의 샘플 일러스트를 그대로 썼고, 나머지는 같은 그림체(평평한 도형)로 따로 그렸다.
 * 서정 님 확정 디자인이 나오면 아래 SVG 본문만 바꾼다. 코드는 서버 카테고리 코드(list_categories의 code)다.
 */
const FOODS: Record<string, string> = {
  // 닭다리 하나
  chicken:
    '<rect width="120" height="120" fill="#E9D8C4"/>' +
    '<g transform="rotate(32 60 60) translate(-2 0)">' +
    '<rect x="64" y="55" width="30" height="10" rx="5" fill="#F7EFE6"/><circle cx="95" cy="55" r="6" fill="#F7EFE6"/><circle cx="95" cy="65" r="6" fill="#F7EFE6"/>' +
    '<ellipse cx="44" cy="60" rx="29" ry="23" fill="#C9772C"/><ellipse cx="38" cy="52" rx="16" ry="9" fill="#D98A3A"/>' +
    '<circle cx="30" cy="62" r="2" fill="#F2C07A"/><circle cx="46" cy="68" r="2" fill="#F2C07A"/><circle cx="52" cy="54" r="2" fill="#F2C07A"/><circle cx="36" cy="48" r="1.8" fill="#F2C07A"/>' +
    '</g>',
  // 배경을 다른 카테고리와 같은 밝은 색으로
  tteokbokki:
    '<rect width="120" height="120" fill="#EFE3D5"/><circle cx="60" cy="60" r="48" fill="#F3ECE4"/><circle cx="60" cy="60" r="40" fill="#D2432A"/>' +
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
  // 딸기 케이크 한 조각(옆모습)
  dessert:
    '<rect width="120" height="120" fill="#EADBD0"/>' +
    '<g transform="translate(0 6)">' +
    '<rect x="26" y="66" width="68" height="14" rx="4" fill="#F3DDB6"/><rect x="26" y="60" width="68" height="6" fill="#FFFFFF"/><rect x="26" y="50" width="68" height="10" fill="#F3DDB6"/>' +
    '<rect x="24" y="40" width="72" height="11" rx="5.5" fill="#FFFFFF"/><path d="M28 51q5 7 10 0t10 0 10 0 10 0 10 0 10 0" fill="#FFFFFF"/>' +
    '<path d="M46 30C46 18 74 18 74 30C74 40 60 47 60 47C60 47 46 40 46 30Z" fill="#D8342A"/>' +
    '<path d="M52 21q8-6 16 0q-8 3-16 0z" fill="#4F8A3A"/>' +
    '<circle cx="53" cy="30" r="1.3" fill="#F6D58A"/><circle cx="60" cy="34" r="1.3" fill="#F6D58A"/><circle cx="67" cy="30" r="1.3" fill="#F6D58A"/><circle cx="58" cy="26" r="1.3" fill="#F6D58A"/>' +
    '</g>',
  // 짜장면을 위에서 본 모습(검은 테두리 없음)
  jajangmyeon:
    '<rect width="120" height="120" fill="#E6D5C3"/><circle cx="60" cy="60" r="48" fill="#F4EEE6"/><circle cx="60" cy="60" r="42" fill="#E8CF9C"/>' +
    '<path d="M24 64c10-12 22-12 32 0s22 12 40 0" stroke="#D9B879" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M26 50c10 10 22 10 32 0s20-10 36 2" stroke="#D9B879" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<path d="M30 80c10-8 22-8 32 0s20 8 28-2" stroke="#D9B879" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<circle cx="60" cy="60" r="25" fill="#3A2218"/><ellipse cx="52" cy="52" rx="10" ry="5" fill="#5A3A2A"/><circle cx="70" cy="64" r="3" fill="#5A3A2A"/><circle cx="50" cy="68" r="2.5" fill="#5A3A2A"/>' +
    '<rect x="55" y="48" width="14" height="4" rx="2" fill="#6BA34A" transform="rotate(25 62 50)"/><rect x="48" y="58" width="13" height="4" rx="2" fill="#5C9A45" transform="rotate(-18 54 60)"/>',
  // 초밥 하나(옆모습, 네모 쟁반 없음)
  sushi:
    '<rect width="120" height="120" fill="#E8DCCB"/>' +
    '<rect x="26" y="58" width="68" height="28" rx="13" fill="#FFFFFF"/><rect x="26" y="78" width="68" height="8" rx="4" fill="#EFE6DA"/>' +
    '<path d="M20 60C20 38 100 38 100 60C100 70 84 64 60 64C36 64 20 70 20 60Z" fill="#EF7B52"/>' +
    '<path d="M32 52c6 3 12 3 18 0M52 48c6 3 12 3 18 0M72 52c6 3 10 3 16 0" stroke="#FBD1BB" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  // 햄버거(접시 없음, 가운데 맞춤, 조금 크게)
  burger:
    '<rect width="120" height="120" fill="#E8D5BE"/>' +
    '<g transform="translate(60 60) scale(1.16) translate(-60 -64)">' +
    '<path d="M26 60C26 34 94 34 94 60Z" fill="#D9984F"/><ellipse cx="48" cy="48" rx="3.2" ry="1.7" fill="#F6E6C2" transform="rotate(-20 48 48)"/><ellipse cx="62" cy="42" rx="3.2" ry="1.7" fill="#F6E6C2"/><ellipse cx="75" cy="49" rx="3.2" ry="1.7" fill="#F6E6C2" transform="rotate(20 75 49)"/><ellipse cx="57" cy="54" rx="3.2" ry="1.7" fill="#F6E6C2"/>' +
    '<path d="M24 61q6-6 12 0t12 0 12 0 12 0 12 0 12 0v5H24Z" fill="#5C9A45"/><path d="M28 66H92L84 74L76 67L68 74L60 67L28 67Z" fill="#F2B33A"/>' +
    '<rect x="26" y="68" width="68" height="10" rx="5" fill="#5A3322"/><path d="M26 80H94V82a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8Z" fill="#C98B45"/>' +
    '</g>',
};

/** 서버 카테고리 코드 → 그릴 음식 */
const BY_CATEGORY_CODE: Record<string, keyof typeof FOODS> = {
  chicken: 'chicken',
  bunsik: 'tteokbokki',
  pizza: 'pizza',
  korean: 'bibimbap',
  cafe_dessert: 'dessert',
  chinese: 'jajangmyeon',
  japanese: 'sushi',
  burger: 'burger',
};

/**
 * 모든 그림의 배경색을 하나로 맞춘다. 그림마다 배경이 달라 피자는 너무 어둡고 분식은 너무 밝았다.
 * 마음에 안 들면 UNIFIED_BG를 false로 두면 위의 그림별 원래 배경으로 돌아간다.
 */
const UNIFIED_BG = true;
export const BG = '#E9D8C4';
const FIRST_RECT = /^<rect width="120" height="120" fill="#[0-9A-Fa-f]{6}"\/>/;
const withBackground = (body: string) => (UNIFIED_BG ? body.replace(FIRST_RECT, `<rect width="120" height="120" fill="${BG}"/>`) : body);

/** 칩에서 그리는 SVG 전체 문서. react-native-svg의 SvgXml로 그린다 */
const toSvg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice">${withBackground(body)}</svg>`;

/** 카테고리 칩 그림. 그림이 없는 카테고리는 null이고, 칩이 이름 첫 글자를 보여 준다 */
export function categoryArt(categoryCode: string): string | null {
  const food = BY_CATEGORY_CODE[categoryCode];
  return food ? toSvg(FOODS[food]) : null;
}
