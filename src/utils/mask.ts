/**
 * 화면에 보여주는 개인 정보 마스킹. 마스킹한 값만 화면으로 가져오고, 원문은 화면에 두지 않는다 (미결정 묶음4 #7).
 */

/** 앞 2글자만 남기고 가린다. "saveeats@example.com" → "sa****@example.com". 형식이 아니면 빈 문자열 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '';
  return `${Array.from(email.slice(0, at)).slice(0, 2).join('')}****${email.slice(at)}`;
}

/** 프로필 동그라미에 넣는 한 글자. 이름이 없으면 이메일 첫 글자 */
export function avatarInitial(maskedName: string | null, maskedEmail: string): string {
  const source = maskedName || maskedEmail;
  return Array.from(source)[0]?.toUpperCase() ?? '';
}
