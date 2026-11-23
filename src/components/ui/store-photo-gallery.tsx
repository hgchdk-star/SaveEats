import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { pageIndexFromOffset, photoCounterLabel } from '@/features/store/store-photos';
import { colors, font, radius } from '@/theme';

import { FoodImage } from './food-image';

type StorePhotoGalleryProps = {
  /** 보여 줄 사진 URL, 순서대로(첫 장 = 대표사진). null이면 그 장은 Placeholder */
  uris: (string | null)[];
  /** 스크린리더용 가게 이름 */
  alt: string;
};

/**
 * 가게 상세 상단 사진 갤러리. 대표사진으로 시작해 좌우로 넘기고, 2장 이상이면 오른쪽 아래에 `현재/전체`를 보여 준다.
 * 자동 재생은 없다. 한 장(또는 없음)이면 넘김도 장수 표시도 만들지 않고 기존 단일 사진과 똑같이 그린다.
 * 사진마다 FoodImage를 쓰므로 로딩에 실패한 장은 중립 Placeholder를 그린다.
 * 가로 넘김은 가로 ScrollView가, 화면의 세로 스크롤은 바깥 ScrollView가 맡는다(방향을 잠가 서로 끼어들지 않게 한다).
 */
export function StorePhotoGallery({ uris, alt }: StorePhotoGalleryProps) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const count = uris.length;

  if (count <= 1) {
    return <FoodImage uri={uris[0] ?? null} alt={alt} ratio="16:9" rounded={0} />;
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== width) setWidth(w);
  };
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(pageIndexFromOffset(e.nativeEvent.contentOffset.x, width, count));
  };
  const current = Math.min(index, count - 1);
  const label = photoCounterLabel(current, count);

  return (
    <View onLayout={onLayout} style={styles.box}>
      {width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onMomentumScrollEnd={onEnd}
          accessibilityLabel={`${alt} 사진 ${count}장`}>
          {uris.map((uri, i) => (
            <FoodImage key={`${i}-${uri ?? 'none'}`} uri={uri} alt={`${alt} 사진 ${i + 1}/${count}`} ratio="16:9" rounded={0} width={width} />
          ))}
        </ScrollView>
      ) : (
        <FoodImage uri={uris[0]} alt={alt} ratio="16:9" rounded={0} />
      )}
      {label ? (
        <View pointerEvents="none" style={styles.counter} accessibilityLabel={`사진 ${current + 1}번째, 전체 ${count}장`}>
          <Text style={styles.counterText}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%' },
  counter: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  counterText: {
    ...font('600'),
    fontSize: 12,
    lineHeight: 16,
    color: colors.surface,
  },
});
