import { confirmedCopy } from '@/config/confirmed-copy';
import { UnbuiltScreen } from '@/features/unbuilt/unbuilt-screen';

/** 비밀번호 재설정 — MVP에서는 준비 중 안내만 보여준다. 재설정 메일·비밀번호 변경 요청은 보내지 않는다 (기획서 v1.3 54장) */
export default function PasswordResetRoute() {
  return <UnbuiltScreen message={confirmedCopy.passwordResetNotReady} />;
}
