-- ============================================================================
-- data09-12 — 외자재 운영관리 Agent (해외 발주 PO · OC · EXW · 선적서류 관리)
-- Supabase(PostgreSQL) DB 스키마 + RLS
--
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--              (Dashboard → SQL Editor → 이 파일 전체를 붙여넣고 Run)
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  지금 도구는 브라우저 localStorage 의 `data09-12.db` 한 칸에 전부 저장합니다.
--  그 안의 묶음을 아래 표로 나눴습니다. 필드 이름은 도구의 이름을 그대로 썼고,
--  SQL 예약어와 겹치는 업체의 `to`(수신 메일)만 `to_addr` 로 바꿨습니다.
--
--  표 목록
--    workspace        판단 기준값 · 보내는 사람 정보 · 열 매핑 · 예시 여부   (1인 1행)
--    mail_template    상황별 영문 메일 문안 6종 (제목·본문, 2026-09-30 원산지증명서 요청 추가)
--    supplier         업체 마스터 (Contact List)
--    purchase_order   PO 관리 대장 (송부 · OC · EXW · ETD · A/N · 선적서류)
--    arrival_notice   포워더 도착 통지(A/N)에서 읽은 값 — B/L 한 건 = 한 줄 (2026-09-29 저녁 추가, 밤: 실물 양식 칸 추가)
--    voyage_registration  항차등록 완료 표시 — B/L 한 줄(HBL, 없으면 MBL), 그 B/L 의 PO 는 po_nos (2026-09-29 밤: PO × B/L → B/L)
--    voyage_history   항차등록 완료 · 취소 · 조정 ETA 반영 이력 (기록성 — 읽기·쓰기만, 고치기·지우기 없음)
--    invoice_doc      읽은 공급사 Invoice 헤더 (2026-09-30 「Invoice PDF → 엑셀」 — PDF 원본은 두지 않음)
--    invoice_line     Invoice 부품 줄 — PO 번호(줄·PO 구역·헤더)·품번·수량·단가·금액·검산용 원문
--    co_request       원산지증명서(C/O) 요청 — 통관팀 요청 한 건 = 한 줄, 상태·날짜 (2026-09-30)
--    co_request_history  C/O 요청 등록·고침·상태 변경 이력 (기록성 — 읽기·쓰기만)
--
--  권한 원칙 : 모든 행은 만든 사람(owner_id = auth.uid())만 보고 고칩니다.
--              기록성 데이터는 voyage_history · co_request_history 이며 UPDATE·DELETE 정책·권한을 두지 않는다.
--              (받은 메일·Weekly Order Status·Packing List 는 그때그때 파일로
--               읽어 비교만 하고 저장하지 않는다)
--  이 스키마는 수강생 본인 프로젝트 전제라 테이블 이름에 접두사를 붙이지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 작업 공간 — localStorage 의 settings · mappings · _sample
create table if not exists public.workspace (
  owner_id        uuid primary key default auth.uid(),
  oc_wait_days    int not null default 3 check (oc_wait_days >= 0),        -- 송부 후 OC 대기 일수
  exw_soon_days   int not null default 7 check (exw_soon_days >= 0),       -- EXW 임박 기준 일수
  exw_grace_days  int not null default 0 check (exw_grace_days >= 0),      -- 출고 준수 허용 일수
  weight_tol_kg   numeric not null default 0 check (weight_tol_kg >= 0),   -- 중량 허용 오차(kg)
  weight_tol_pct  numeric not null default 0 check (weight_tol_pct between 0 and 100),  -- 중량 허용 오차(%)
  po_regex        text not null default '',                                -- PO 번호 찾기 정규식
  oc_keywords     text not null default 'order confirmation, order acknowledgement, OC, confirmation',
  sender_name     text not null default '',
  sender_email    text not null default '',
  sender_company  text not null default '',
  sender_dept     text not null default '',
  mappings        jsonb not null default '{}'::jsonb                       -- 엑셀 가져오기 열 매핑(종류별)
                  check (jsonb_typeof(mappings) = 'object'),
  sample          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 상황별 메일 문안 — 종류마다 한 행
create table if not exists public.mail_template (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  key         text not null
              check (key in ('po_mail', 'oc_followup', 'delivery_check', 'docs_request', 'an_missing')),
  subject     text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,key'
  constraint mail_template_uniq unique (owner_id, key)
);

-- 업체 마스터 — 같은 업체 코드는 덮어쓴다(도구의 mergeSuppliers 와 같다)
create table if not exists public.supplier (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  code        text not null check (length(trim(code)) > 0),
  name        text not null check (length(trim(name)) > 0),
  contact     text not null default '',
  to_addr     text not null default '',          -- 수신 메일, 여러 개는 '; '
  cc          text not null default '',          -- 참조 메일, 여러 개는 '; '
  phone       text not null default '',
  country     text not null default '',
  domains     text not null default '',          -- 받은 메일의 업체 판별용 도메인
  checklist   text not null default '',          -- 업체별 요청 사항(메일 본문에 들어감)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,code'
  constraint supplier_uniq unique (owner_id, code)
);

-- PO 관리 대장 — 같은 PO 번호는 한 줄
--  supplier_code 는 외래키로 묶지 않는다. 도구는 업체 마스터에 없는 코드의 PO 도
--  대장에 남기고 「업체 미등록」으로 표시하기 때문이다.
create table if not exists public.purchase_order (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  po_no          text not null check (length(trim(po_no)) > 0),
  supplier_code  text not null default '',
  item           text not null default '',
  po_date        date,
  sent_date      date,          -- PO 메일 송부일
  oc_date        date,          -- Order Confirmation 접수일
  exw_promised   date,          -- 약속 EXW DATE
  exw_actual     date,          -- 실제 출고일
  etd            date,
  an_received    boolean not null default false,   -- Arrival Notice 수신
  docs_received  boolean not null default false,   -- 선적서류 수신
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- 같은 PO 가 두 줄이면 OC 미접수·EXW 임박 판정이 두 번 잡힌다.
  -- upsert onConflict = 'owner_id,po_no'
  constraint purchase_order_uniq unique (owner_id, po_no)
);
create index if not exists purchase_order_supplier_idx on public.purchase_order (owner_id, supplier_code);

-- 2026-09-29 메일 자료 반영분 — 이미 만든 표에도 붙도록 add column if not exists (재실행 안전)
alter table public.workspace add column if not exists oc_request_days int not null default 7 check (oc_request_days >= 0);  -- 발주 메일의 OC 요청 일수
alter table public.workspace add column if not exists transit_us   int not null default 60 check (transit_us >= 0);    -- 항차 매뉴얼 지역별 평균 운송기간(일)
alter table public.workspace add column if not exists transit_eu   int not null default 90 check (transit_eu >= 0);
alter table public.workspace add column if not exists transit_jpcn int not null default 15 check (transit_jpcn >= 0);
alter table public.workspace add column if not exists transit_in   int not null default 45 check (transit_in >= 0);
alter table public.workspace alter column oc_keywords set default 'order confirmation, order acknowledgement, OC, confirmation, O.A/O.C';

alter table public.purchase_order add column if not exists delivery_date date;                          -- PO 납기(구매발주서 Contract Delivery Date)
alter table public.purchase_order add column if not exists oc_no         text not null default '';      -- 공급사 OC 번호
alter table public.purchase_order add column if not exists followup_date date;                          -- 마지막 OC 팔로우업
alter table public.purchase_order add column if not exists lines         jsonb not null default '[]'::jsonb   -- PO 품목 줄
  check (jsonb_typeof(lines) = 'array');
alter table public.purchase_order add column if not exists voyage        jsonb not null default '{}'::jsonb   -- 항차 체크리스트 {단계: 완료일}
  check (jsonb_typeof(voyage) = 'object');

-- 2026-09-29 저녁 — 도착 통지(A/N) 탭
alter table public.purchase_order add column if not exists bl_no text not null default '';   -- B/L 번호(A/N 을 PO 에 붙이는 두 번째 열쇠)
alter table public.purchase_order add column if not exists eta   date;                       -- 가장 최근 A/N 의 ETA
create index if not exists purchase_order_bl_idx on public.purchase_order (owner_id, bl_no);

-- A/N 메일 한 통 = 한 줄. 도구는 메일 원본(첨부)을 저장하지 않고 읽은 값과 본문 앞부분만 둔다.
create table if not exists public.arrival_notice (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  mail_key     text not null check (length(trim(mail_key)) > 0),   -- 도구의 id(보낸 사람·제목·시각·본문 해시) — 같은 메일 두 번 방지
  file_name    text not null default '',
  received_on  date,
  received_at  timestamptz,
  sender       text not null default '',
  subject      text not null default '',
  forwarder    text not null default '',
  bl_no        text not null default '',
  mbl_no       text not null default '',
  vessel       text not null default '',
  voyage       text not null default '',
  etd          date,
  eta          date,
  pol          text not null default '',
  pod          text not null default '',
  containers   text not null default '',          -- 'EXMU1234565(40HC), …'
  po_nos       text not null default '',          -- 글에서 찾은 PO 번호, 쉼표로
  packages     text not null default '',          -- '6 PLTS'
  weight       text not null default '',          -- '2,480.50 KGS' (원문 단위 그대로)
  parsed       jsonb not null default '{}'::jsonb check (jsonb_typeof(parsed) = 'object'),   -- 처음 읽은 값(고친 칸 표시용)
  src          jsonb not null default '{}'::jsonb check (jsonb_typeof(src) = 'object'),      -- 칸별 근거 원문 줄
  body         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,mail_key'
  constraint arrival_notice_uniq unique (owner_id, mail_key)
);
create index if not exists arrival_notice_bl_idx on public.arrival_notice (owner_id, bl_no);

-- 항차등록 완료 — PO 번호 × B/L(분할 선적이면 B/L 마다). bl_key = 영문·숫자만 대문자로(도구의 anKey)
create table if not exists public.voyage_registration (
  id                   bigint generated always as identity primary key,
  owner_id             uuid not null default auth.uid(),
  po_no                text not null check (length(trim(po_no)) > 0),
  bl_key               text not null check (bl_key ~ '^[A-Z0-9]+$'),
  bl_no                text not null default '',
  registered_on        date not null,                -- 사람이 고른 항차등록일
  eta_at_registration  date,                         -- 등록 때 ETA — 뒤에 A/N ETA 가 바뀌면 「등록 후 ETA 변경」
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,po_no,bl_key'
  constraint voyage_registration_uniq unique (owner_id, po_no, bl_key)
);

-- 이력 — 기록성. 한 번 쓰면 고치거나 지우지 않는다(정책·권한 모두 select·insert 만)
create table if not exists public.voyage_history (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  at             timestamptz not null default now(),
  action         text not null check (action in ('register', 'unregister', 'eta_confirm')),
  po_no          text not null check (length(trim(po_no)) > 0),
  bl_no          text not null default '',
  registered_on  date,
  eta_from       date,
  eta            date
);
create index if not exists voyage_history_po_idx on public.voyage_history (owner_id, po_no, at);

-- 2026-09-29 밤 — 실물 「도착일정통지」 양식(해상 본문 표·엑셀·B/L PDF, 항공 메일) 반영
--  · A/N 한 줄 = B/L 한 건. 메일 한 통에 B/L 이 여럿이면 여러 줄이고, mail_key 끝에 B/L 열쇠가 붙는다.
--  · TMS NO 는 받은 실물에 칸이 없어 어느 값인지 확인 중 — 도구가 설정의 칸 이름으로 찾은 값을 그대로 둔다.
alter table public.arrival_notice add column if not exists tms_no          text not null default '';
alter table public.arrival_notice add column if not exists req_no          text not null default '';   -- 신청번호(HKM… 모양)
alter table public.arrival_notice add column if not exists shipper         text not null default '';
alter table public.arrival_notice add column if not exists incoterms       text not null default '';
alter table public.arrival_notice add column if not exists local_ar        text not null default '';   -- 원문 그대로 'USD : 987.65' 모양
alter table public.arrival_notice add column if not exists local_ar_ccy    text not null default '';
alter table public.arrival_notice add column if not exists local_ar_amount numeric(14, 2);
alter table public.arrival_notice add column if not exists cargo_type      text not null default '';   -- 화물형태 'LCL'·'F40'
alter table public.arrival_notice add column if not exists transport_mode  text not null default '';   -- '해상'·'항공'·'' — 참고용, 필수 아님
create index if not exists arrival_notice_tms_idx on public.arrival_notice (owner_id, tms_no);

--  · 항차등록은 B/L 별(요청: 「메일에 기재된 B/L 건에 대한 항차 등록 여부 관리」). 열쇠 = bl_key.
alter table public.voyage_registration add column if not exists po_nos text not null default '';   -- 그 B/L 의 PO, 쉼표로
alter table public.voyage_registration add column if not exists tms_no text not null default '';
alter table public.voyage_registration alter column po_no set default '';
alter table public.voyage_registration drop constraint if exists voyage_registration_po_no_check;
-- 예전 판(PO × B/L 한 줄)으로 쌓인 줄은 B/L 하나로 합친다: 가장 이른 등록일 줄을 남기고 PO 를 po_nos 로 모은다.
-- 예전 제약이 있을 때만 돈다 — 두 번째 실행부터는 아무것도 하지 않는다.
do $mig$
begin
  if exists (select 1 from pg_constraint where conname = 'voyage_registration_uniq' and conrelid = 'public.voyage_registration'::regclass) then
    with g as (
      select owner_id, bl_key, (array_agg(id order by registered_on, id))[1] as keep_id,
             string_agg(distinct nullif(trim(po_no), ''), ', ' order by nullif(trim(po_no), '')) as pos
      from public.voyage_registration group by owner_id, bl_key
    ), u as (
      update public.voyage_registration v set po_nos = coalesce(g.pos, '') from g where v.id = g.keep_id returning v.id
    )
    delete from public.voyage_registration v using g
     where v.owner_id = g.owner_id and v.bl_key = g.bl_key and v.id <> g.keep_id;
    alter table public.voyage_registration drop constraint voyage_registration_uniq;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'voyage_registration_bl_uniq' and conrelid = 'public.voyage_registration'::regclass) then
    -- upsert onConflict = 'owner_id,bl_key'
    alter table public.voyage_registration add constraint voyage_registration_bl_uniq unique (owner_id, bl_key);
  end if;
end;
$mig$;

-- 이력도 B/L 별: PO 가 대장에 없는 B/L 도 남기므로 po_no 는 비어도 되고(여럿이면 쉼표), TMS NO 를 함께 둔다.
alter table public.voyage_history add column if not exists tms_no text not null default '';
alter table public.voyage_history alter column po_no set default '';
alter table public.voyage_history drop constraint if exists voyage_history_po_no_check;
create index if not exists voyage_history_bl_idx on public.voyage_history (owner_id, bl_no, at);

-- 2026-09-30 — 패들릿 「프로젝트 개선」 요청 4가지
--  ① Cummins EXW 는 구분 HCE 만 보기가 기본(설정) — 켜고 끌 수 있음
alter table public.workspace add column if not exists cum_gubun      text    not null default 'HCE';
alter table public.workspace add column if not exists cum_gubun_only boolean not null default true;
--  ② A/N 에 적힌 Invoice 번호(항공 HAWB 사본 「INV:」, A/N 엑셀 「Invoice No」) — Invoice → B/L → 항차등록 확인의 첫 열쇠
alter table public.arrival_notice add column if not exists invoice_nos text not null default '';   -- 여럿이면 쉼표로
create index if not exists arrival_notice_inv_idx on public.arrival_notice (owner_id, invoice_nos);
--  ③ 메일 문안 종류에 원산지증명서 요청(co_request) 추가
alter table public.mail_template drop constraint if exists mail_template_key_check;
alter table public.mail_template add constraint mail_template_key_check
  check (key in ('po_mail', 'oc_followup', 'delivery_check', 'docs_request', 'an_missing', 'co_request'));

--  ④ Invoice PDF → 엑셀: 읽은 Invoice 헤더와 부품 줄(PDF 원본은 저장하지 않는다)
create table if not exists public.invoice_doc (
  id               bigint generated always as identity primary key,
  owner_id         uuid not null default auth.uid(),
  doc_key          text not null check (length(trim(doc_key)) > 0),   -- 도구의 id
  file_name        text not null default '',
  engine           text not null default '',          -- '전자 PDF' · '붙여넣은 글' · 'AI(반자동)' · 'AI(자동)'
  invoice_no       text not null default '',
  invoice_date     date,
  date_ambiguous   boolean not null default false,    -- 03/04/2026 처럼 일·월을 가릴 수 없었음
  supplier_name    text not null default '',
  currency         text not null default '' check (currency = '' or currency ~ '^[A-Z]{3}$'),
  incoterms        text not null default '',
  incoterms_place  text not null default '',
  po_no            text not null default '',          -- 위쪽(헤더) PO. 줄마다 PO 는 invoice_line.po_no
  bl_no            text not null default '',          -- Invoice 에 적힌 B/L·AWB(있을 때)
  stated_sub_total numeric(16, 2),
  stated_total     numeric(16, 2),
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,doc_key'
  constraint invoice_doc_uniq unique (owner_id, doc_key)
);
create index if not exists invoice_doc_no_idx on public.invoice_doc (owner_id, invoice_no);

create table if not exists public.invoice_line (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  invoice_id   bigint not null references public.invoice_doc (id) on delete cascade,
  line_no      int not null check (line_no > 0),
  po_no        text not null default '',
  po_from      text not null default '' check (po_from in ('', '줄', 'PO 구역', '헤더', '고침')),
  part_no      text not null default '',
  description  text not null default '',
  qty          numeric(16, 4),
  unit_price   numeric(18, 6),
  amount       numeric(16, 2),
  guessed      boolean not null default false,        -- 수량 × 단가 = 금액이 안 맞아 자리로 짐작한 줄
  edited       boolean not null default false,
  source_line  text not null default '',              -- 읽은 원문 줄
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint invoice_line_uniq unique (invoice_id, line_no)
);
create index if not exists invoice_line_po_idx on public.invoice_line (owner_id, po_no);

--  ⑤ 원산지증명서(C/O) 요청 관리 — 요청 한 건 = 한 줄, 상태 이력은 기록성(고치기·지우기 없음)
create table if not exists public.co_request (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  req_key        text not null check (length(trim(req_key)) > 0),   -- 도구의 id
  requested_on   date not null,
  requester      text not null default '',             -- 통관팀 담당
  bl_no          text not null default '',
  invoice_no     text not null default '',
  po_no          text not null default '',             -- 여럿이면 쉼표로
  supplier_code  text not null default '',
  co_type        text not null default '',             -- 통관팀이 요청한 서식 이름 그대로
  due_date       date,
  status         text not null default 'requested'
                 check (status in ('requested', 'drafted', 'sent', 'received', 'forwarded', 'cancelled')),
  sent_on        date,
  received_on    date,
  forwarded_on   date,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint co_request_ref_check check (length(trim(bl_no || invoice_no || po_no)) > 0),   -- 번호 하나는 있어야
  -- upsert onConflict = 'owner_id,req_key'
  constraint co_request_uniq unique (owner_id, req_key)
);
create index if not exists co_request_status_idx on public.co_request (owner_id, status, due_date);

create table if not exists public.co_request_history (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  req_key      text not null check (length(trim(req_key)) > 0),
  at           timestamptz not null default now(),
  action       text not null check (action in ('create', 'edit', 'status')),
  status_from  text not null default '',
  status_to    text not null default '',
  event_on     date,                                   -- 그 일이 있었던 날(사람이 고름)
  ref          text not null default '',               -- 'Invoice … · B/L … · PO …'
  note         text not null default ''
);
create index if not exists co_request_history_idx on public.co_request_history (owner_id, req_key, at);

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거
--
--  search_path 를 고정한다. 고정하지 않으면 호출자의 search_path 에 따라
--  엉뚱한 스키마의 객체를 잡을 수 있다.
-- ----------------------------------------------------------------------------

-- 2026-09-30 (2) — 원산지증명서 소급문구: 「B/L DATE 선적일 기준 7일 이상 지난 건에 대해 소급문구 적용 필요」
--   경과일 = 기준일(발급(예정)일 → 수령일 → 설정 기준) − B/L DATE, 기준 일수 이상이면 「소급문구 필요」(js/co.js coRetro)
alter table public.co_request add column if not exists bl_date    date;   -- B/L DATE(선적일) — A/N 의 ETD(On Board) 등에서 채움
alter table public.co_request add column if not exists issue_date date;   -- C/O 발급(예정)일 — 소급 판정 기준일(비우면 설정 기준)
alter table public.workspace add column if not exists co_retro_days   int  not null default 7 check (co_retro_days >= 1);
alter table public.workspace add column if not exists co_retro_basis  text not null default 'today' check (co_retro_basis in ('today', 'requested'));
alter table public.workspace add column if not exists co_retro_phrase text not null default '';   -- 비우면 ISSUED RETROSPECTIVELY(통관팀 확인 전 임시값)
alter table public.workspace add column if not exists co_retro_line   text not null default '';   -- 메일에 넣을 소급 발급 요청 문장(비우면 기본 문장)
alter table public.invoice_doc add column if not exists bl_date date;     -- Invoice 에 적힌 B/L DATE(있을 때)

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['workspace', 'mail_template', 'supplier', 'purchase_order', 'arrival_notice', 'voyage_registration', 'invoice_doc', 'invoice_line', 'co_request']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만
-- ----------------------------------------------------------------------------

alter table public.workspace      enable row level security;
alter table public.mail_template  enable row level security;
alter table public.supplier       enable row level security;
alter table public.purchase_order enable row level security;
alter table public.arrival_notice      enable row level security;
alter table public.voyage_registration enable row level security;
alter table public.voyage_history      enable row level security;
alter table public.invoice_doc         enable row level security;
alter table public.invoice_line        enable row level security;
alter table public.co_request          enable row level security;
alter table public.co_request_history  enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['workspace', 'mail_template', 'supplier', 'purchase_order', 'arrival_notice', 'voyage_registration', 'invoice_doc', 'co_request']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- 이력은 읽기·쓰기 정책만. UPDATE·DELETE 정책이 없으므로 본인도 고치거나 지울 수 없다.
drop policy if exists voyage_history_select on public.voyage_history;
drop policy if exists voyage_history_insert on public.voyage_history;
create policy voyage_history_select on public.voyage_history for select to authenticated using (owner_id = auth.uid());
create policy voyage_history_insert on public.voyage_history for insert to authenticated with check (owner_id = auth.uid());
-- Invoice 부품 줄: 본인 행 + 붙는 Invoice 도 본인 것이어야 한다.
-- 외래키 검사는 RLS 를 거치지 않으므로, 이게 없으면 남의 invoice_doc id 에 줄을 붙일 수 있다.
drop policy if exists invoice_line_select on public.invoice_line;
drop policy if exists invoice_line_insert on public.invoice_line;
drop policy if exists invoice_line_update on public.invoice_line;
drop policy if exists invoice_line_delete on public.invoice_line;
create policy invoice_line_select on public.invoice_line for select to authenticated using (owner_id = auth.uid());
create policy invoice_line_insert on public.invoice_line for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.invoice_doc d where d.id = invoice_id and d.owner_id = auth.uid()));
create policy invoice_line_update on public.invoice_line for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from public.invoice_doc d where d.id = invoice_id and d.owner_id = auth.uid()));
create policy invoice_line_delete on public.invoice_line for delete to authenticated using (owner_id = auth.uid());
drop policy if exists co_request_history_select on public.co_request_history;
drop policy if exists co_request_history_insert on public.co_request_history;
create policy co_request_history_select on public.co_request_history for select to authenticated using (owner_id = auth.uid());
create policy co_request_history_insert on public.co_request_history for insert to authenticated with check (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. 표 권한 — Supabase 는 새 표마다 anon 에도 전 권한을 자동으로 붙인다.
--    정책이 anon 을 막지만, 권한 자체도 끊어 두 겹으로 막는다.
-- ----------------------------------------------------------------------------

revoke all on public.workspace, public.mail_template, public.supplier, public.purchase_order,
  public.arrival_notice, public.voyage_registration, public.voyage_history,
  public.invoice_doc, public.invoice_line, public.co_request, public.co_request_history
  from anon;
grant select, insert, update, delete
  on public.workspace, public.mail_template, public.supplier, public.purchase_order,
     public.arrival_notice, public.voyage_registration, public.invoice_doc, public.invoice_line, public.co_request
  to authenticated;
-- 이력: 두 겹(정책 + 권한)으로 읽기·쓰기만
revoke update, delete, truncate on public.voyage_history from authenticated;
grant select, insert on public.voyage_history to authenticated;
revoke update, delete, truncate on public.co_request_history from authenticated;
grant select, insert on public.co_request_history to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 ALTER DEFAULT PRIVILEGES 로 신규 함수마다
--       anon·authenticated·service_role 에 자동 부여
--  PUBLIC 만 지우면 anon=X 가 남아 비로그인 호출이 그대로 뚫린다.
--  (RLS 정책 식은 auth.uid() 만 쓰므로 anon 에 남겨 둘 함수가 없다.)
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
-- 트리거 전용 함수는 authenticated 를 남긴다. 직접 호출하면
-- "can only be called as trigger" 로 죽으므로 무해하다.
grant execute on function public.set_updated_at() to authenticated;

-- ============================================================================
-- 끝.
-- ============================================================================
