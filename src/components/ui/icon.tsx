import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme';

/** SaveEats 기본 아이콘 세트: 24px 그리드, 1.75 선 굵기, 둥근 끝. 경로는 디자인 시스템 Icon 그대로 */
const PATHS = {
  home: ['M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z'],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20'],
  receipt: ['M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5L6 20.5z', 'M9 8.5h6', 'M9 12h6', 'M9 15.5h3.5'],
  review: ['M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z', 'M8.5 10.5h7'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5'],
  back: ['M15 5l-7 7 7 7'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  trash: ['M5 7h14', 'M9.5 7V5h5v2', 'M7 7l.8 12.2a1 1 0 0 0 1 .8h6.4a1 1 0 0 0 1-.8L17 7', 'M10.5 11v5.5', 'M13.5 11v5.5'],
  heart: ['M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z'],
  star: ['M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  chevronRight: ['M9.5 5.5 16 12l-6.5 6.5'],
  chevronDown: ['M6 9.5l6 6 6-6'],
  cart: ['M3.5 4.5h2.2l2 10.5h10l1.8-7.5H7', 'M9.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M16.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  bank: ['M3.5 9.5 12 4.5l8.5 5', 'M5 10v7', 'M9.7 10v7', 'M14.3 10v7', 'M19 10v7', 'M3.5 19.5h17'],
  alert: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 8v4.5', 'M12 15.8v.2'],
  filter: ['M4.5 7h9', 'M17.5 7h2', 'M4.5 17h2', 'M10.5 17h9', 'M15.5 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  clock: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 8v4.5l3 1.8'],
  share: ['M12 4v11', 'M7.5 8.5 12 4l4.5 4.5', 'M5 13v6h14v-6'],
  plate: ['M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  wallet: ['M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z', 'M4 7.5 15.5 4.5v3', 'M16 13.5h1.5'],
  refresh: ['M19 12a7 7 0 1 1-2.1-5', 'M19 5v4h-4'],
  edit: ['M5 19h3.5L18.5 9 15 5.5 5 15.5z', 'M13 7.5 16.5 11'],
  more: ['M12 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  sort: ['M8 5v14', 'M4.5 8.5 8 5l3.5 3.5', 'M16 19V5', 'M12.5 15.5 16 19l3.5-3.5'],
} as const;

export type IconName = keyof typeof PATHS;

type IconProps = {
  name: IconName;
  size?: 14 | 16 | 20 | 24 | 32;
  /** 기본은 본문 글자색. 아이콘만 Tomato로 칠하는 곳은 활성 찜·활성 탭·알림 점뿐 */
  color?: string;
  /** 상태를 뜻할 때만: 찜 켜짐, 땡김도 별, 활성 홈·찜 탭 */
  filled?: boolean;
  strokeWidth?: number;
  /** 의미 있는 단독 아이콘일 때의 스크린리더 이름. 없으면 장식으로 취급한다 */
  label?: string;
};

export function Icon({ name, size = 24, color = colors.ink, filled = false, strokeWidth = 1.75, label }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={!!label}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}>
      {PATHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
