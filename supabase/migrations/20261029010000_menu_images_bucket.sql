-- 메뉴 사진 저장소: 공개 Storage 버킷 menu-images
-- 근거: 팀 결정 (2026-10-29). 개발 명세 SEC-007은 리뷰 이미지용 비공개 버킷을 다루며, 이 버킷은 그것과 별개다.
--
-- 규칙:
--   버킷  = menu-images (공개). 파일 경로는 menus/<메뉴 UUID>.<확장자> (png, jpg).
--   DB    = menus.image_ref에는 버킷 안의 경로만 저장한다 (예: menus/<UUID>.png). 버킷 이름·전체 URL은 저장하지 않는다.
--           앱이 <프로젝트 URL>/storage/v1/object/public/menu-images/<image_ref>로 조립한다 (프로젝트를 옮겨도 주소가 깨지지 않게).
--   읽기  = 공개 버킷이라 URL로 누구나 읽는다. 읽기용 정책은 필요 없다.
--   쓰기  = 앱 키(anon/authenticated)의 업로드·수정·삭제를 허용하지 않는다. 업로드는 관리자(service_role/대시보드)로만 한다.
--   목록  = 목록 조회(list)용 정책도 만들지 않는다. 앱은 경로를 알고 있어서 파일 목록을 훑을 필요가 없다.
--   제한  = 파일 크기 2MiB 이하, 형식 image/png · image/jpeg. (사진은 약 1MB가 확인됨. 경계에 걸리지 않게 여유를 둔다)
--
-- storage.objects는 RLS가 켜져 있고 정책이 없으면 앱 키는 읽기·쓰기가 모두 막힌다.
-- 그래서 이 파일은 storage.objects에 정책을 만들지 않는다. (공개 버킷의 URL 읽기는 정책 없이도 된다)
-- 정책을 추가하려면 새 migration으로 하고 008 테스트도 함께 바꾼다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
