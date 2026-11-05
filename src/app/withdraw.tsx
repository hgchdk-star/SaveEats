import { confirmedCopy } from '@/config/confirmed-copy';
import { UnbuiltScreen } from '@/features/unbuilt/unbuilt-screen';

/** 회원 탈퇴 — MVP에서는 준비 중 안내만 보여준다. 삭제 요청은 보내지 않는다 (기획서 v1.3 60장, OPEN-DB-005) */
export default function WithdrawRoute() {
  return <UnbuiltScreen message={confirmedCopy.withdrawNotReady} />;
}
