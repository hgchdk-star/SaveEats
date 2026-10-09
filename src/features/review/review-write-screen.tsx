import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CravingRatingInput } from '@/components/ui/craving-rating-input';
import { CtaBar } from '@/components/ui/cta-bar';
import { ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { Notice } from '@/components/ui/notice';
import { PhotoPicker } from '@/components/ui/photo-picker';
import { Screen } from '@/components/ui/screen';
import { TextArea } from '@/components/ui/text-area';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { orderMenuLabel } from '@/features/history/history-model';
import { goMyReviews } from '@/features/order/flow-routes';
import { showToast } from '@/features/toast/toast-store';
import { useAsync } from '@/hooks/use-async';
import type { ImageAction, MockReview, MockReviewEligibility } from '@/mocks/history/types';
import type { MockOrder } from '@/mocks/order/types';
import { historyService, reviewService } from '@/services';
import { errorCode } from '@/services/service-error';
import { colors, spacing, text } from '@/theme';
import { createLocalId } from '@/utils/id';
import { formatWon } from '@/utils/format';
import { reviewBodyLength } from '@/utils/review-text';

import { afterReviewChanged } from './review-actions';
import { useReviewStore } from './review-store';

const w = draftCopy.review.write;

/** 수정할 리뷰를 찾는다. 이미 받은 값이 있으면 그것을, 없으면 내가 쓴 리뷰 목록에서 찾는다 */
async function findMyReview(reviewId: string): Promise<MockReview> {
  const cached = useReviewStore.getState().byId[reviewId];
  if (cached && !cached.deletedAt && cached.isMine) return cached;
  let cursor: string | null = null;
  for (let i = 0; i < 10; i += 1) {
    const page = await reviewService.listMyReviews({ cursor, pageSize: LIMITS.reviewPageSize });
    useReviewStore.getState().merge(page.reviews);
    const found = page.reviews.find((r) => r.reviewId === reviewId);
    if (found) return found;
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  throw new Error('NOT_FOUND');
}

type Loaded =
  | { mode: 'create'; order: MockOrder; eligibility: MockReviewEligibility }
  | { mode: 'edit'; review: MockReview };

/** 작성(orderId)과 수정(reviewId)이 같은 화면이다. 화면 id: reviewWrite */
export function ReviewWriteScreen({ orderId, reviewId }: { orderId?: string; reviewId?: string }) {
  const edit = !!reviewId;
  const state = useAsync<Loaded>(`review-write:${reviewId ?? orderId}`, async () => {
    if (reviewId) return { mode: 'edit', review: await findMyReview(reviewId) };
    if (!orderId) throw new Error('NO_ORDER');
    const [order, eligibility] = await Promise.all([historyService.getMyOrder(orderId), reviewService.getReviewEligibility(orderId)]);
    return { mode: 'create', order, eligibility };
  });
  const top = <TopNavigation title={edit ? w.editTitle : w.createTitle} onBack={() => router.back()} />;

  if (state.status === 'loading') {
    return (
      <Screen top={top}>
        <View accessibilityLabel="불러오는 중" style={styles.content}>
          <Skeleton height={64} radius={16} />
          <Skeleton height={48} />
          <Skeleton height={160} radius={12} />
        </View>
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <Screen top={top}>
        <ErrorState title={edit ? w.loadErrorTitleEdit : w.loadErrorTitle} onRetry={state.reload} />
      </Screen>
    );
  }
  return <WriteForm top={top} loaded={state.data} />;
}

type Photo =
  | { kind: 'existing'; imageRef: string }
  | { kind: 'new'; uri: string; status: 'uploading' | 'ready' | 'failed'; uploadId?: string };

type Notice_ = 'blocked' | 'conflict' | 'saveFailed' | 'exists' | null;

function WriteForm({ top, loaded }: { top: React.ReactElement; loaded: Loaded }) {
  const edit = loaded.mode === 'edit';
  const review = loaded.mode === 'edit' ? loaded.review : null;

  const [rating, setRating] = useState(review?.rating ?? 0);
  const [body, setBody] = useState(review?.body ?? '');
  const [photo, setPhoto] = useState<Photo | null>(review?.images[0] ? { kind: 'existing', imageRef: review.images[0].imageRef } : null);
  const [removedExisting, setRemovedExisting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice_>(
    loaded.mode === 'create' && loaded.eligibility.eligibility === 'CAN_WRITE'
      ? null
      : loaded.mode === 'create'
        ? loaded.eligibility.eligibility === 'HAS_ACTIVE_REVIEW'
          ? 'exists'
          : 'blocked'
        : null,
  );

  // 같은 입력으로 다시 시도하면 같은 operationId를 쓴다(이미 저장됐다면 같은 결과가 돌아온다). 입력이 바뀌면 새로 만든다
  const operation = useRef<{ signature: string; id: string } | null>(null);
  // 사진 업로드마다 번호를 붙여, 늦게 끝난 이전 업로드가 새 상태를 덮지 않게 한다
  const uploadSeq = useRef(0);

  const length = reviewBodyLength(body);
  const bodyError = !touched ? undefined : length < LIMITS.reviewBodyMin ? w.bodyTooShort(LIMITS.reviewBodyMin) : length > LIMITS.reviewBodyMax ? w.bodyTooLong(LIMITS.reviewBodyMax) : undefined;
  const ratingError = touched && rating === 0 ? w.ratingError : undefined;
  const photoBusy = photo?.kind === 'new' && photo.status === 'uploading';
  const photoFailed = photo?.kind === 'new' && photo.status === 'failed';

  const target = loaded.mode === 'create' ? { orderId: loaded.order.orderId } : { reviewId: loaded.review.reviewId };

  const startUpload = async (uri: string) => {
    const seq = (uploadSeq.current += 1);
    setPhoto({ kind: 'new', uri, status: 'uploading' });
    try {
      const result = await reviewService.uploadReviewImage({ target, localUri: uri, operationId: createLocalId() });
      if (seq === uploadSeq.current) setPhoto({ kind: 'new', uri, status: 'ready', uploadId: result.uploadId });
    } catch {
      // 사진만 실패한 것이다. 글과 땡김도는 그대로 둔다
      if (seq === uploadSeq.current) setPhoto({ kind: 'new', uri, status: 'failed' });
    }
  };

  const addPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.9 });
    const uri = result.canceled ? null : result.assets[0]?.uri;
    if (uri) void startUpload(uri);
  };

  const removePhoto = () => {
    uploadSeq.current += 1; // 진행 중인 업로드 결과는 버린다
    if (photo?.kind === 'existing') setRemovedExisting(true);
    setPhoto(null);
  };

  const imageAction: ImageAction = photo?.kind === 'new' && photo.status === 'ready' ? 'REPLACE' : photo === null && removedExisting ? 'REMOVE' : 'KEEP';
  const uploadId = photo?.kind === 'new' && photo.status === 'ready' ? photo.uploadId : undefined;

  const submit = async () => {
    if (saving) return;
    setTouched(true);
    if (rating === 0 || length < LIMITS.reviewBodyMin || length > LIMITS.reviewBodyMax) return;
    if (photoBusy || photoFailed) return;

    const signature = JSON.stringify([target, rating, body, imageAction, uploadId ?? null]);
    if (operation.current?.signature !== signature) operation.current = { signature, id: createLocalId() };
    const operationId = operation.current.id;

    setSaving(true);
    setNotice(null);
    try {
      const saved =
        loaded.mode === 'create'
          ? await reviewService.createReview({ orderId: loaded.order.orderId, operationId, rating, body, uploadId })
          : await reviewService.updateReview({ reviewId: loaded.review.reviewId, operationId, expectedRevision: loaded.review.revision, rating, body, imageAction, uploadId });
      useReviewStore.getState().upsert(saved);
      afterReviewChanged();
      if (loaded.mode === 'create') {
        // 등록하면 내가 쓴 리뷰로 가고, 뒤로 가도 작성 화면이 다시 나오지 않는다
        router.replace({ pathname: '/my-reviews', params: { focus: saved.reviewId } });
        showToast({ message: draftCopy.review.created, tone: 'success' });
      } else {
        router.back();
        showToast({ message: draftCopy.review.updated, tone: 'success' });
      }
    } catch (error) {
      const code = errorCode(error);
      if (code === 'REVIEW_DEADLINE_EXCEEDED') setNotice('blocked');
      else if (code === 'ACTIVE_REVIEW_EXISTS') setNotice('exists');
      else if (code === 'REVIEW_REVISION_CONFLICT') setNotice('conflict');
      else if (code === 'UPLOAD_FAILED' || code === 'INVALID_IMAGE') {
        if (photo?.kind === 'new') setPhoto({ ...photo, status: 'failed' });
      } else setNotice('saveFailed');
    } finally {
      setSaving(false);
    }
  };

  const blocked = notice === 'blocked' || notice === 'exists';
  const summary =
    loaded.mode === 'create'
      ? { store: loaded.order.snapshot.storeName, menu: orderMenuLabel(loaded.order.snapshot), amount: loaded.order.approvedTotalAmount }
      : { store: loaded.review.storeNameSnapshot, menu: loaded.review.menuNamesSnapshot.join(', '), amount: loaded.review.orderAmount };

  return (
    <Screen
      avoidKeyboard
      top={top}
      bottom={
        blocked ? undefined : (
          <CtaBar
            label={saving ? (edit ? w.ctaUpdating : w.ctaCreating) : edit ? w.ctaUpdate : w.ctaCreate}
            loading={saving}
            disabled={photoBusy || photoFailed}
            note={photoBusy ? w.photoUploading : photoFailed ? w.photoBlockedNote : undefined}
            onPress={() => void submit()}
          />
        )
      }>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {notice === 'blocked' ? <Notice flush tone="danger" title={confirmedCopy.reviewDeadlineExceeded} description={w.blockedDesc} /> : null}
        {notice === 'exists' ? <Notice flush tone="danger" title={draftCopy.review.alreadyWritten} action={{ label: draftCopy.review.viewMine, onPress: () => goMyReviews() }} /> : null}
        {notice === 'conflict' ? <Notice flush tone="danger" title={confirmedCopy.reviewRevisionConflict} action={{ label: draftCopy.review.reloadLatest, onPress: () => router.back() }} /> : null}
        {notice === 'saveFailed' ? <Notice flush tone="danger" title={confirmedCopy.reviewSaveFailed} description={w.saveFailedDesc} /> : null}

        <View style={styles.order}>
          <Text style={styles.store}>{summary.store}</Text>
          <Text style={styles.menu}>{summary.menu}</Text>
          <Text style={styles.amount}>{formatWon(summary.amount)}</Text>
        </View>

        {!blocked ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>
                {w.ratingLabel} <Text style={styles.required}>{w.required}</Text>
              </Text>
              <CravingRatingInput value={rating} onChange={setRating} disabled={saving} />
              <Text style={ratingError ? styles.error : styles.hint}>{ratingError ?? (rating > 0 ? w.ratingValue(rating) : w.ratingHint)}</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>
                {w.bodyLabel} <Text style={styles.required}>{w.required}</Text>
              </Text>
              <TextArea
                accessibilityLabel={w.bodyLabel}
                value={body}
                onChangeText={setBody}
                placeholder={w.bodyPlaceholder}
                counter={`${length}/${LIMITS.reviewBodyMax}`}
                counterOver={length > LIMITS.reviewBodyMax}
                error={bodyError}
                disabled={saving}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>
                {w.photoLabel} <Text style={styles.hint}>{w.photoOptional}</Text>
              </Text>
              <View style={styles.photoRow}>
                <PhotoPicker
                  photo={photo ? { uri: photo.kind === 'new' ? photo.uri : null, status: photo.kind === 'new' ? photo.status : 'ready' } : null}
                  addLabel={w.photoAdd}
                  countLabel={`${photo ? 1 : 0}/${LIMITS.reviewImageMax}`}
                  removeLabel={w.photoRemove}
                  disabled={saving}
                  onAdd={() => void addPhoto()}
                  onRemove={removePhoto}
                />
              </View>
              {photoFailed ? (
                <Notice
                  flush
                  tone="danger"
                  title={confirmedCopy.reviewPhotoFailed}
                  description={w.photoFailedDesc}
                  action={{ label: w.photoRetry, onPress: () => photo?.kind === 'new' && void startUpload(photo.uri) }}
                />
              ) : null}
            </View>

            {edit ? <Text style={styles.hint}>{w.helpEdit}</Text> : <Text style={styles.hint}>{confirmedCopy.reviewWindowHelp}</Text>}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[5], gap: spacing[5] },
  order: { gap: 2, padding: spacing[4], borderRadius: 16, backgroundColor: colors.surfaceMuted },
  store: { ...text.title, color: colors.ink },
  menu: { ...text.body2, color: colors.inkSecondary },
  amount: { ...text.body2, color: colors.inkTertiary },
  field: { gap: spacing[2] },
  label: { ...text.label, color: colors.ink },
  required: { ...text.caption, color: colors.inkTertiary },
  hint: { ...text.caption, color: colors.inkTertiary },
  error: { ...text.caption, color: colors.danger },
  photoRow: { flexDirection: 'row' },
});
