# Supabase DB 스크립트

이 폴더에는 이 도구의 저장 데이터를 PostgreSQL(Supabase)로 옮길 때 쓰는 스키마가 들어 있습니다.
지금 도구는 아직 브라우저 저장소(localStorage)만 씁니다.
DB 에 연결하는 코드는 다음 단계에서 붙입니다.

## 왜 DB 가 필요한가

지금은 모든 저장값이 브라우저 localStorage 의 `data09-12.db` 한 칸에 들어 있습니다.
그래서 다음과 같은 한계가 있습니다.

- **PO 관리 대장이 한 PC 에 갇힙니다.** 송부일·OC 접수일·약속 EXW DATE·실제 출고일·A/N·선적서류 수신 여부는 담당자가 바뀌어도 이어서 봐야 하는 기록입니다. 휴가나 인수인계 때 다른 사람이 같은 대장을 열 수 없습니다.
- **대장이 지워질 수 있습니다.** 브라우저 데이터를 지우거나 PC 를 바꾸면 「OC 미접수」「EXW 임박」을 판정하던 근거가 모두 사라집니다.
- **업체 연락처가 흩어집니다.** Contact List 를 가져와 다듬은 업체 마스터(수신·참조 메일, 도메인, 업체별 요청 사항)를 팀이 함께 쓰려면 한곳에 있어야 합니다.
- **PO 가 쌓이면 저장이 실패합니다.** localStorage 는 보통 5MB 안팎입니다.

받은 메일(.eml)·Weekly Order Status·Packing List 는 지금처럼 그때그때 파일로 읽어 비교만 합니다. DB 에는 올리지 않습니다.

## 테이블

| 테이블 | 용도 | localStorage 대응 |
|---|---|---|
| `workspace` | 판단 기준값(OC 대기·EXW 임박·출고 준수·중량 허용 오차), PO 번호 규칙, OC 키워드, 보내는 사람 정보, 엑셀 열 매핑, 예시 여부 (1인 1행) | `data09-12.db` 의 `settings` · `mappings` · `_sample` |
| `mail_template` | 상황별 영문 메일 문안 5종(발주·OC 팔로우업·납기 확인·선적서류 요청·A/N 확인) | `data09-12.db` 의 `templates{}` |
| `supplier` | 업체 마스터 (Contact List) | `data09-12.db` 의 `suppliers[]` |
| `purchase_order` | PO 관리 대장 (2026-09-29 저녁: `bl_no`·`eta` 칸 추가) | `data09-12.db` 의 `pos[]` |
| `arrival_notice` | 포워더 도착 통지(A/N) 메일에서 읽은 값 — 메일 한 통이 한 줄, 칸별 근거 원문(`src`)과 처음 읽은 값(`parsed`) | `data09-12.db` 의 `an.mails[]` |
| `voyage_registration` | 항차등록 완료 표시 — PO 번호 × B/L 한 줄, 등록일과 등록 때 ETA | `data09-12.db` 의 `an.regs{}` |
| `voyage_history` | 항차등록 완료·취소·조정 ETA 반영 이력(기록성) | `data09-12.db` 의 `an.history[]` |

필드 이름은 도구의 이름을 그대로 썼습니다.
SQL 예약어와 겹치는 업체의 `to`(수신 메일)만 `to_addr` 로 바꿨습니다.
`settings` 안의 값은 이름 그대로(`oc_wait_days` 등) `workspace` 의 칸이 되었습니다.

`purchase_order.supplier_code` 는 업체 마스터에 외래키로 묶지 않았습니다.
도구가 업체 마스터에 없는 코드의 PO 도 대장에 남기고 「업체 미등록」으로 표시하기 때문입니다.

기록성 데이터는 `voyage_history` 하나입니다. 읽기·쓰기 정책과 권한만 두어, 본인도 고치거나 지울 수 없습니다(등록을 취소하면 「등록 취소」 줄이 새로 쌓입니다). A/N 의 ETA 변경 이력은 저장하지 않고 `arrival_notice` 의 받은 순서에서 계산합니다.

### 권한

- 모든 표에 RLS(행 수준 보안)를 켰습니다.
- 모든 행은 만든 사람만 보고 고칠 수 있습니다(`owner_id = auth.uid()`). `owner_id` 는 로그인한 사용자로 자동으로 채워집니다.
- 자기 행의 `owner_id` 를 남에게 넘기는 수정도 막습니다.
- 로그인하지 않은 사용자(anon)는 어떤 표도 읽거나 쓸 수 없습니다.
- 같은 PO 번호, 같은 업체 코드, 같은 종류의 메일 문안이 두 번 들어가지 않도록 UNIQUE 제약을 두었습니다. 앱에서 upsert 할 때는 `onConflict` 를 표의 UNIQUE 조합(예: `owner_id,po_no`)으로 지정해야 합니다.
- 메일 문안 종류 5종, 기준값의 범위(음수 금지, 중량 오차 0~100%)는 CHECK 제약으로 막습니다.

메일 문안처럼 여러 줄인 글을 SQL 로 직접 넣을 때는 달러 인용(`$txt$ … $txt$`)으로 씁니다.
`'첫 줄\n둘째 줄'` 처럼 쓰면 줄바꿈이 아니라 글자 `\n` 이 그대로 저장됩니다.

## 적용 방법

1. <https://supabase.com> 에 가입합니다.
2. 새 프로젝트를 만듭니다. 이 도구 전용으로 본인 프로젝트를 쓰는 것을 전제로 하므로 테이블 이름에 접두사를 붙이지 않았습니다.
3. 왼쪽 메뉴에서 **SQL Editor** 를 엽니다.
4. `supabase/schema.sql` 의 내용을 전부 붙여넣습니다.
5. **Run** 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표는 건너뛰고 정책·트리거는 지우고 다시 만듭니다.

## 확인 방법

1. 왼쪽 메뉴 **Table Editor** 에 위 7개 표가 보이는지 확인합니다.
2. 각 표 이름 옆에 RLS 가 켜져 있는지(「RLS disabled」 경고가 없는지) 확인합니다.
3. **Authentication → Policies** 에서 표마다 SELECT·INSERT·UPDATE·DELETE 정책 4개(`voyage_history` 는 SELECT·INSERT 2개)가 붙어 있는지 봅니다.
4. SQL Editor 에서 아래를 실행해 함수 권한에 `anon` 이 없는지 봅니다.

```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
```

## 앱 연결은 다음 단계입니다

이 스크립트는 표와 권한만 만듭니다. 도구의 `js/store.js` 는 아직 localStorage 를 씁니다.
Supabase 에 저장하려면 다음 단계에서 로그인과 저장·불러오기 코드를 붙여야 합니다.
여러 담당자가 같은 대장을 함께 쓰려면 팀 단위 권한도 그때 더합니다.

## 로컬 검증 방법

운영에서 처음 실행하지 않도록, 임시 로컬 PostgreSQL 에 실제로 적용해 검사하는 도구를 함께 두었습니다.

```sh
./scripts/sqltest/run.sh
```

PostgreSQL 16 이상이 필요합니다(macOS: `brew install postgresql@17`).
임시 DB 를 만들어 쓰고 끝나면 지우므로 기존 설치에는 영향이 없습니다.

검사 내용은 다음과 같습니다.

- 스키마를 두 번 적용해도 오류가 없는가
- 사용자 A 의 행이 사용자 B 에게 보이지 않고, 고치거나 지울 수도 없는가
- 자기 행을 남에게 넘길 수 없는가
- 로그인하지 않은 사용자는 아무것도 읽거나 쓸 수 없는가
- CHECK·UNIQUE 제약이 잘못된 값과 중복을 막는가
- 여러 줄 메일 본문이 실제 줄바꿈으로 저장되는가
- 함수 실행 권한에 PUBLIC·anon 이 남지 않았는가

검사용 SQL(`scripts/sqltest/*.local.sql`)은 로컬 전용입니다.
Supabase 운영 DB 에서 실행하면 스스로 멈추도록 가드가 들어 있습니다.
