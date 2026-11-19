# -*- coding: utf-8 -*-
"""임베디드 Postgres에 Supabase 환경을 최소한으로 흉내 내고 migration을 적용한다. 시험 전용(tests/test_yeopgi_db.py)."""
import io, os, re, tempfile, pgserver, psycopg2

PRE = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
"""
SHIM = """
create or replace function no_plan() returns setof text language sql as $f$ select ''::text $f$;
create or replace function finish() returns setof text language sql as $f$ select ''::text $f$;
create or replace function ok(boolean, text default '') returns text language plpgsql as $f$
begin
  if $1 is not true then raise exception 'NOT OK: %', $2; end if;
  return 'ok - ' || $2;
end $f$;
create or replace function is(anyelement, anyelement, text default '') returns text language plpgsql as $f$
begin
  if $1 is distinct from $2 then raise exception 'NOT OK: % (got %, want %)', $2, $1, $2; end if;
  return 'ok - ' || $3;
end $f$;
"""

def start():
    d = tempfile.mkdtemp(prefix='pgenv')
    srv = pgserver.get_server(d, cleanup_mode='stop')
    conn = psycopg2.connect(srv.get_uri())
    conn.autocommit = True
    return srv, conn

def run(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)

def apply(conn, names):
    raise NotImplementedError('이 시험은 저장소 migration을 직접 읽는다')
    for n in names:
        sql = io.open(MIG + n, encoding='utf-8').read()
        try:
            run(conn, sql)
            print('applied', n)
        except Exception as e:
            print('FAILED', n, str(e).splitlines()[0])
            raise
