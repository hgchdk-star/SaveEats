import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type DimensionValue } from 'react-native';

import { colors, font, radius } from '@/theme';

import { Icon } from './icon';

type FoodImageProps = {
  /** 그릴 수 있는 URL. 없거나 불러오지 못하면 중립 Placeholder를 그린다 */
  uri: string | null;
  /** 스크린리더용 이름 */
  alt?: string;
  ratio?: '1:1' | '4:3' | '16:9';
  /** 고정 너비. 없으면 부모 너비를 채운다 */
  width?: number;
  /** 모서리 반경. 0이면 각진 사진(상세 화면 상단) */
  rounded?: number;
  soldOut?: boolean;
};

const RATIO = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 } as const;

/**
 * 음식 사진. 꽉 채워 자르고, 사진 위에 글자·그라디언트를 얹지 않는다.
 * 사진이 없으면 foodPlaceholder 바탕에 접시 아이콘 (FR-STORE-003). 일러스트나 이모지로 채우지 않는다.
 */
export function FoodImage({ uri, alt, ratio = '1:1', width, rounded = radius.md, soldOut = false }: FoodImageProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showImage = uri !== null && failedUri !== uri;
  const boxWidth: DimensionValue = width ?? '100%';

  return (
    <View
      accessible={!!alt}
      accessibilityRole={alt ? 'image' : undefined}
      accessibilityLabel={alt}
      style={[styles.box, { width: boxWidth, aspectRatio: RATIO[ratio], borderRadius: rounded }]}>
      {showImage ? (
        <Image source={{ uri }} contentFit="cover" onError={() => setFailedUri(uri)} style={[StyleSheet.absoluteFill, soldOut && styles.dimmed]} />
      ) : (
        <View style={[styles.empty, soldOut && styles.dimmed]}>
          <Icon name="plate" color={colors.tomato200} size={24} />
        </View>
      )}
      {soldOut ? (
        <View style={styles.empty}>
          <Text style={styles.soldOut}>품절</Text>
        </View>
      ) : null}
      <View pointerEvents="none" style={[styles.hairline, { borderRadius: rounded }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
    backgroundColor: colors.foodPlaceholder,
    flexShrink: 0,
  },
  empty: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: {
    opacity: 0.45,
  },
  soldOut: {
    ...font('700'),
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  hairline: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderColor: 'rgba(29, 27, 26, 0.04)',
  },
});
