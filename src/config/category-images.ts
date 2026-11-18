/**
 * 카테고리 칩의 음식 이미지 (FR-CAT-001). 디자인 시스템(Claude Design)의 샘플 음식 일러스트를 그대로 옮겼다.
 * 서버 카테고리 응답에는 이미지가 없어서 앱에 넣어 두고 카테고리 코드로 연결한다.
 * 치킨·분식·피자·한식·카페디저트는 디자인 자료의 그림 그대로다. 디자인에 없던 중식(짜장면)·일식(초밥)·버거는 같은 그림체로 새로 그렸다
 * (서정 님 확정 디자인이 나오면 아래 SVG 본문만 바꾼다). 코드는 서버 카테고리 코드(list_categories의 code)다.
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
  // 아래 셋은 디자인에 없어서 위와 같은 그림체(위에서 내려다본 접시, 평평한 도형)로 새로 그렸다
  jajangmyeon:
    '<rect width="120" height="120" fill="#E6D5C3"/><circle cx="60" cy="60" r="48" fill="#2E2926"/><circle cx="60" cy="60" r="41" fill="#F4EEE6"/>' +
    '<path d="M30 62c8-14 22-14 30 0s22 14 30 0" stroke="#E8CF9C" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M30 74c8-12 22-12 30 0s22 12 30 0" stroke="#DDBE86" stroke-width="5" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="60" cy="50" rx="27" ry="19" fill="#3A2218"/><ellipse cx="52" cy="44" rx="9" ry="4" fill="#5A3A2A"/><circle cx="70" cy="52" r="3" fill="#5A3A2A"/><circle cx="46" cy="56" r="2.5" fill="#5A3A2A"/>' +
    '<rect x="62" y="38" width="12" height="4" rx="2" fill="#6BA34A" transform="rotate(25 68 40)"/><rect x="48" y="32" width="12" height="4" rx="2" fill="#5C9A45" transform="rotate(-20 54 34)"/>',
  sushi:
    '<rect width="120" height="120" fill="#E8DCCB"/><rect x="8" y="30" width="104" height="60" rx="14" fill="#2E2926"/><rect x="13" y="35" width="94" height="50" rx="10" fill="#F4EEE6"/>' +
    '<ellipse cx="36" cy="62" rx="15" ry="10" fill="#FFFFFF"/><ellipse cx="36" cy="58" rx="17" ry="9" fill="#EF7B52"/><path d="M24 56c4 3 8 3 12 0M34 60c4 3 8 3 12 0" stroke="#FBD1BB" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="66" cy="62" rx="15" ry="10" fill="#FFFFFF"/><ellipse cx="66" cy="58" rx="17" ry="9" fill="#C9372C"/><ellipse cx="62" cy="55" rx="8" ry="2.5" fill="#E0614F"/><rect x="64" y="48" width="4" height="22" rx="2" fill="#2E2926"/>' +
    '<circle cx="92" cy="60" r="12" fill="#2E2926"/><circle cx="92" cy="60" r="9" fill="#FFFFFF"/><circle cx="92" cy="60" r="4" fill="#E9803A"/><circle cx="52" cy="76" r="4" fill="#7BB661"/>',
  burger:
    '<rect width="120" height="120" fill="#E8D5BE"/><circle cx="60" cy="60" r="47" fill="#FFFFFF"/><circle cx="60" cy="60" r="40" fill="#F7EFE6"/>' +
    '<path d="M26 60C26 34 94 34 94 60Z" fill="#D9984F"/><ellipse cx="48" cy="48" rx="3.2" ry="1.7" fill="#F6E6C2" transform="rotate(-20 48 48)"/><ellipse cx="62" cy="42" rx="3.2" ry="1.7" fill="#F6E6C2"/><ellipse cx="75" cy="49" rx="3.2" ry="1.7" fill="#F6E6C2" transform="rotate(20 75 49)"/><ellipse cx="57" cy="54" rx="3.2" ry="1.7" fill="#F6E6C2"/>' +
    '<path d="M24 61q6-6 12 0t12 0 12 0 12 0 12 0 12 0v5H24Z" fill="#5C9A45"/><path d="M28 66H92L84 74L76 67L68 74L60 67L28 67Z" fill="#F2B33A"/>' +
    '<rect x="26" y="68" width="68" height="10" rx="5" fill="#5A3322"/><path d="M26 80H94V82a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8Z" fill="#C98B45"/>',
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

/** 칩에서 그리는 SVG 전체 문서. react-native-svg의 SvgXml로 그린다 */
const toSvg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

/** 카테고리 칩 그림. 그림이 없는 카테고리는 null이고, 칩이 이름 첫 글자를 보여 준다 */
export function categoryArt(categoryCode: string): string | null {
  const food = BY_CATEGORY_CODE[categoryCode];
  return food ? toSvg(FOODS[food]) : null;
}
