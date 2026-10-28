import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { supabaseConfig } from '@/config/data-source';

let client: SupabaseClient | null = null;

/**
 * Supabase 클라이언트. URL과 publishable(anon) 키만 쓴다. 이 둘은 앱 번들에 들어가도 되는 공개 값이고, 보호는 서버의 RLS가 한다.
 * service_role·secret 키는 앱 어디에도 넣지 않는다.
 *
 * 아직 로그인(Supabase Auth)을 연결하지 않았으므로 세션을 저장하거나 갱신하지 않는다. 로그인을 연결할 때 이 옵션을 바꾼다.
 * 설정이 없으면 null이다(부르는 쪽이 설정 오류로 처리한다).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  const config = supabaseConfig();
  if (!config) return null;
  client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
