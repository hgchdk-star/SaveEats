import { WithdrawScreen } from '@/features/my/withdraw-screen';

/** 회원 탈퇴 (서정 확정 2026-11-15: 정식 탈퇴, 전부 삭제). 서버 delete_my_account() 한 번으로 지운다 */
export default function WithdrawRoute() {
  return <WithdrawScreen />;
}
