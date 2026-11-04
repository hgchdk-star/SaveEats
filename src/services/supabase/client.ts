import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { supabaseConfig } from '@/config/data-source';
import { authStorage } from '@/infrastructure/local/auth-storage';

let client: SupabaseClient | null = null;

/**
 * Supabase 클라이언트. URL과 publishable(anon) 키만 쓴다. 이 둘은 앱 번들에 들어가도 되는 공개 값이고, 보호는 서버의 RLS가 한다.
 * service_role·secret 키는 앱 어디에도 넣지 않는다.
 *
 * 로그인 세션은 이 기기의 보안 저장소(authStorage)에 저장하고 토큰은 자동 갱신한다. 앱이 앞뒤로 갈 때의 갱신 시작·중지는 supabase-auth-service가 맡는다.
 * 화면마다 클라이언트를 따로 만들지 않고 이 하나만 쓴다 (AUTH-002).
 * 설정이 없으면 null이다(부르는 쪽이 설정 오류로 처리한다).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  const config = supabaseConfig();
  if (!config) return null;
  client = createClient(config.url, config.publishableKey, {
    auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
