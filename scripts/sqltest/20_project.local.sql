-- ============================================================================
-- 로컬 검증 전용 — data09-12 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B 두 명과 비로그인(anon)을 번갈아 흉내 내어
--  ① 본인 행만 보이는가 ② anon 은 아무것도 못 하는가
--  ③ CHECK·UNIQUE 가 걸리는가 ④ 여러 줄 메일 본문이 그대로 저장되는가
--  ⑤ 함수 권한에 PUBLIC·anon 이 남지 않았는가 를 잰다.
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 지정한 SQLSTATE 로 실패해야 통과. 현재 역할(invoker)로 실행된다.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice '  OK   %', p_label; return; end if;
    raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 % — %)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %  (기대 SQLSTATE % 인데 성공했다)', p_label, p_state;
end;
$fn$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com')
on conflict (id) do nothing;

do $t$ begin raise notice '[프로젝트] data09-12 — 소유자 격리 · anon 차단 · 제약 · 메일 문안 · 함수 권한'; end $t$;

-- ----------------------------------------------------------------------------
-- 1. 사용자 A 가 설정·문안·업체·PO 를 등록한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  insert into public.workspace (sender_name, sender_company) values ('구매 담당', '예시 회사');
  -- 여러 줄 본문은 달러 인용으로 넣는다 — E'' 없이 '\n' 을 쓰면 글자 그대로 저장된다
  insert into public.mail_template (key, subject, body)
  values ('oc_followup', '[Reminder] Order Confirmation request - {SUPPLIER}',
$txt$Dear {CONTACT},

We have not yet received the Order Confirmation (OC) for the following purchase order(s):

{PO_LIST}

Best regards,
{SENDER}$txt$);
  insert into public.supplier (code, name, contact, to_addr, domains)
  values ('EX-A01', 'Alpha Precision GmbH (예시)', 'Anna Keller', 'anna.keller@alpha-precision.example.com', 'alpha-precision.example.com');
  insert into public.purchase_order (po_no, supplier_code, item, po_date, sent_date)
  values ('EX4500010001', 'EX-A01', 'Bearing housing', '2026-09-01', '2026-09-01');
  -- 업체 마스터에 없는 코드의 PO 도 대장에 남는다(도구의 「업체 미등록」 표시)
  insert into public.purchase_order (po_no, supplier_code) values ('EX4500010099', 'NOT-IN-LIST');

  perform public._assert_eq((select owner_id from public.purchase_order where po_no = 'EX4500010001'),
    '11111111-1111-1111-1111-111111111111'::uuid, 'owner_id 기본값이 auth.uid() 로 채워진다');
  perform public._assert_eq((select count(*) from public.purchase_order), 2::bigint,
    'A 는 자기 PO 를 본다 (업체 미등록 PO 포함)');
  perform public._assert((select strpos(body, E'\n') > 0 and strpos(body, '\n') = 0 from public.mail_template where key = 'oc_followup'),
    '여러 줄 메일 본문이 실제 줄바꿈으로 저장된다 (글자 \n 이 아니다)');
end $t$;
commit;

-- updated_at 트리거
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  update public.purchase_order set oc_date = '2026-09-03' where po_no = 'EX4500010001';
  perform public._assert((select updated_at > created_at from public.purchase_order where po_no = 'EX4500010001'),
    'updated_at 트리거가 수정 시각을 갱신한다');
end $t$;
commit;

-- 도착 통지(A/N) · 항차등록 · 이력 (2026-09-29 저녁 추가)
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
declare n bigint;
begin
  update public.purchase_order set bl_no = 'ALGS2609001', eta = '2026-10-24', an_received = true where po_no = 'EX4500010001';
  insert into public.arrival_notice (mail_key, forwarder, bl_no, vessel, voyage, eta, po_nos, src, body)
  values ('an1abc', 'Alpha Logistics (예시)', 'ALGS2609001', 'EXAMPLE STAR', '012E', '2026-10-24', 'EX4500010001',
          '{"eta": "ETA : 24-OCT-2026"}'::jsonb,
$txt$HBL NO. : ALGS2609001
ETA     : 24-OCT-2026$txt$);
  perform public._assert_raises($s$insert into public.arrival_notice (mail_key) values ('an1abc')$s$,
    '23505', '같은 A/N 메일은 한 번만 저장된다');
  perform public._assert_raises($s$insert into public.arrival_notice (mail_key, src) values ('an2', '[]'::jsonb)$s$,
    '23514', 'A/N 근거 원문(src)은 JSON 객체다');
  insert into public.voyage_registration (po_no, bl_key, bl_no, registered_on, eta_at_registration)
  values ('EX4500010001', 'ALGS2609001', 'ALGS2609001', '2026-09-29', '2026-10-24');
  perform public._assert_raises($s$insert into public.voyage_registration (po_no, bl_key, registered_on) values ('EX4500010001', 'ALGS2609001', '2026-09-30')$s$,
    '23505', '같은 PO × B/L 의 항차등록은 한 줄이다');
  perform public._assert_raises($s$insert into public.voyage_registration (po_no, bl_key, registered_on) values ('EX4500010001', 'algs-2609', '2026-09-30')$s$,
    '23514', 'bl_key 는 영문 대문자·숫자만');
  insert into public.voyage_history (action, po_no, bl_no, registered_on, eta) values ('register', 'EX4500010001', 'ALGS2609001', '2026-09-29', '2026-10-24');
  perform public._assert_raises($s$insert into public.voyage_history (action, po_no) values ('delete_all', 'EX4500010001')$s$,
    '23514', '이력 구분은 register·unregister·eta_confirm 만');
  perform public._assert_raises($s$update public.voyage_history set eta = '2026-12-31'$s$,
    '42501', '이력은 본인도 고칠 수 없다 (UPDATE 권한 없음)');
  perform public._assert_raises($s$delete from public.voyage_history$s$,
    '42501', '이력은 본인도 지울 수 없다 (DELETE 권한 없음)');
  perform public._assert_eq((select count(*) from public.voyage_history), 1::bigint, '이력 1줄이 그대로 남는다');
  perform public._assert((select strpos(body, E'\n') > 0 from public.arrival_notice where mail_key = 'an1abc'),
    'A/N 본문 여러 줄이 실제 줄바꿈으로 저장된다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 2. 사용자 B — A 의 행을 보지도, 고치지도, 지우지도, 대신 쓰지도 못한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
declare n bigint;
begin
  perform public._assert_eq(
    (select count(*) from public.workspace) + (select count(*) from public.mail_template)
    + (select count(*) from public.supplier) + (select count(*) from public.purchase_order)
    + (select count(*) from public.arrival_notice) + (select count(*) from public.voyage_registration)
    + (select count(*) from public.voyage_history),
    0::bigint, 'B 에게는 A 의 행이 7개 표 어디에서도 보이지 않는다');

  update public.supplier set to_addr = 'attacker@example.com' where code = 'EX-A01';
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 UPDATE 는 A 의 업체 메일 주소에 닿지 않는다');

  delete from public.purchase_order;
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 DELETE 는 A 의 PO 에 닿지 않는다');

  perform public._assert_raises(
    $s$insert into public.purchase_order (owner_id, po_no) values ('11111111-1111-1111-1111-111111111111', 'EX4500019999')$s$,
    '42501', 'B 는 owner_id 를 A 로 적어 대신 쓸 수 없다');

  -- UNIQUE 는 사용자별이다 — B 도 같은 PO 번호·업체 코드를 쓸 수 있다
  insert into public.workspace default values;
  insert into public.purchase_order (po_no) values ('EX4500010001');
  insert into public.supplier (code, name) values ('EX-A01', 'B 의 업체');
  perform public._assert_eq((select count(*) from public.purchase_order), 1::bigint,
    '같은 PO 번호라도 사용자가 다르면 따로 저장된다');
end $t$;
commit;

-- B 가 자기 행의 owner_id 를 A 로 바꿔 넘기려 한다
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
begin
  -- UPDATE 의 WITH CHECK 만 따로 재려면 WHERE 없이 쓴다. WHERE 가 있으면 SELECT 정책이
  -- 새 행에도 걸려 WITH CHECK 가 빠져도 막히므로 검사가 헛돌 수 있다.
  -- 다른 제약에 먼저 걸리지 않도록 A 에게 없는 종류(po_mail)의 문안으로 잰다.
  insert into public.mail_template (key, subject, body) values ('po_mail', 's', 'b');
  perform public._assert_raises(
    $s$update public.mail_template set owner_id = '11111111-1111-1111-1111-111111111111'$s$,
    '42501', 'B 는 자기 행이 있어도 owner_id 를 A 로 넘길 수 없다 (with check)');
end $t$;
commit;

do $t$
begin
  perform public._assert_eq((select to_addr from public.supplier
      where owner_id = '11111111-1111-1111-1111-111111111111' and code = 'EX-A01'),
    'anna.keller@alpha-precision.example.com', 'B 의 시도 뒤에도 A 의 업체 메일 주소는 그대로다');
  perform public._assert_eq((select count(*) from public.purchase_order
      where owner_id = '11111111-1111-1111-1111-111111111111'), 2::bigint,
    'B 의 시도 뒤에도 A 의 PO 는 그대로다');
end $t$;

-- ----------------------------------------------------------------------------
-- 3. 비로그인(anon) — 읽기도 쓰기도 막힌다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '';
set local role anon;
do $t$
declare t text;
begin
  foreach t in array array['workspace','mail_template','supplier','purchase_order','arrival_notice','voyage_registration','voyage_history']
  loop
    perform public._assert_raises(format('select * from public.%I', t), '42501', 'anon 은 ' || t || ' 를 읽을 수 없다');
  end loop;
  perform public._assert_raises(
    $s$insert into public.supplier (code, name) values ('X', 'x')$s$, '42501', 'anon 은 업체를 등록할 수 없다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 4. 정책 구조
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  select string_agg(p.polname, ', ') into v_bad
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         not like '%owner_id = auth.uid()%';
  perform public._assert(v_bad is null,
    '모든 정책이 owner_id = auth.uid() 로 묶여 있다' || coalesce(' (발견: ' || v_bad || ')', ''));

  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    26::bigint, '정책 수가 26개다 (6개 표 × 4 + 이력 2, 재실행해도 늘지 않는다)');
end $t$;

-- ----------------------------------------------------------------------------
-- 5. CHECK · UNIQUE
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  perform public._assert_raises($s$insert into public.purchase_order (po_no) values ('EX4500010001')$s$,
    '23505', '같은 사용자의 PO 번호 중복은 UNIQUE 가 막는다');
  perform public._assert_raises($s$insert into public.purchase_order (po_no) values ('   ')$s$,
    '23514', 'PO 번호는 비워 둘 수 없다');
  perform public._assert_raises($s$insert into public.supplier (code, name) values ('EX-A01', '중복')$s$,
    '23505', '같은 사용자의 업체 코드 중복은 UNIQUE 가 막는다');
  perform public._assert_raises($s$insert into public.supplier (code, name) values ('EX-Z99', '')$s$,
    '23514', '업체명은 비워 둘 수 없다');
  perform public._assert_raises($s$insert into public.mail_template (key, subject, body) values ('oc_followup', 's', 'b')$s$,
    '23505', '같은 종류의 메일 문안은 하나만 둔다');
  perform public._assert_raises($s$insert into public.mail_template (key, subject, body) values ('marketing', 's', 'b')$s$,
    '23514', '메일 문안 종류는 정해진 5종만 받는다');
  perform public._assert_raises($s$update public.workspace set oc_wait_days = -1$s$,
    '23514', 'OC 대기 일수는 음수가 될 수 없다');
  perform public._assert_raises($s$update public.workspace set weight_tol_pct = 150$s$,
    '23514', '중량 허용 오차(%)는 0~100 이다');
  -- 2026-09-29 추가 칸: 품목 줄은 배열, 항차 체크리스트는 객체만, 운송기간 기본값은 매뉴얼 값
  perform public._assert_raises($s$insert into public.purchase_order (po_no, lines) values ('M269990001', '{}'::jsonb)$s$,
    '23514', 'PO 품목 줄(lines)은 JSON 배열이다');
  perform public._assert_raises($s$insert into public.purchase_order (po_no, voyage) values ('M269990002', '[]'::jsonb)$s$,
    '23514', '항차 체크리스트(voyage)는 JSON 객체다');
  perform public._assert_eq((select transit_us from public.workspace limit 1), 60, '미국 운송기간 기본 60일');
  perform public._assert_raises($s$insert into public.workspace default values$s$,
    '23505', '작업 공간은 사용자당 한 행이다');
  perform public._assert_raises($s$insert into public.purchase_order (po_no, po_date) values ('EX4500010050', '2026-13-01')$s$,
    '22008', '없는 날짜는 받지 않는다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 6. 함수 권한 · search_path · 표 권한
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  -- proacl 이 NULL 이면 "기본값 = PUBLIC 에 EXECUTE" 라는 뜻이다. NULL 도 실패로 본다.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.privilege_type = 'EXECUTE'
                        and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid)));
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다 (예외로 둔 함수도 없음)' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and not coalesce('search_path=public' = any(p.proconfig), false);
  perform public._assert(v_bad is null,
    '모든 함수에 search_path = public 이 고정돼 있다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  perform public._assert(v_bad is null,
    'anon 에 표 권한이 남지 않았다 (Supabase 자동 부여를 끊었다)' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;

-- 정리 (슈퍼유저로 — 이력도 지운다)
delete from public.voyage_history;
delete from public.voyage_registration;
delete from public.arrival_notice;
delete from public.purchase_order;
delete from public.supplier;
delete from public.mail_template;
delete from public.workspace;
delete from auth.users where email in ('a@example.com', 'b@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
