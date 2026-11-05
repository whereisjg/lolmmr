# 내전 MMR 밸런서

롤(LoL) 내전 친구 약 20명용 팀 밸런싱 도구. 승패만으로 Elo 기반 MMR을 갱신하고, 참가자를 평균 MMR 차이가 가장 작게 두 팀으로 나눈다.

## 현재 상태
- 단일 파일 `index.html` (HTML + CSS + vanilla JS, 빌드 없음, 외부 라이브러리 없음)
- Claude 아티팩트로 배포: https://claude.ai/artifact/HpJkteQe4aXS2sTck9qZKi (capabilities `db`). 공유 저장은 아티팩트 `db` 런타임에 의존
- 저장소 우선순위: `FIREBASE_CONFIG`가 있으면 Firestore(로그인 없이 공유, GitHub Pages 배포용) → 아티팩트 `db` → `localStorage`(이 기기에만 저장)
- Firestore compat SDK(gstatic 10.12.2)는 `repo`가 쓰는 API와 같은 모양이라 `this.db`에 그대로 넣는다. 보안 규칙은 `firestore.rules`(players, matches, series, trash 공개 읽기/쓰기)
- UI 언어는 한국어. 폰트는 Google Fonts(Noto Sans KR, Chakra Petch)
- 아티팩트로 다시 올릴 때는 `<body>` 안쪽(`<title>`부터 `</script>`까지)만 게시한다. 저장소 파일의 doctype/head 래퍼는 단독 실행용

## 작업 규칙
- 먼저 `index.html`의 기존 패턴(저장소 래퍼 `repo`, `render*` 함수, CSS 토큰)을 읽고 따른다
- 수정은 최소 범위로. 구조 개편이나 프레임워크 도입은 요청 시에만
- 색은 `:root` 토큰만 사용. 라이트/다크 모두 정의되어 있으므로 하드코딩 금지
- 코드, 기술 용어는 영어, 화면 문구는 한국어
- 변경 후 확인: 스크립트 구문(`node --check`), 순수 로직 샘플 실행, 폰 폭(약 400px)에서 가로 스크롤 없음

## 데이터 모델 (db 컬렉션)
- `players/{id}`: `name`, `mmr`(정수), `pos`(선호 포지션 키 배열, 최대 2개, 0번이 주 포지션. 없거나 빈 배열 = 상관없음), `games`, `wins`, `losses`(세트 기준), `sWins`, `sLosses`(시리즈 기준, 시리즈가 끝나는 세트에서만 갱신), `setStreak`(세트 기준 연속, 매 세트 갱신, 가속에 사용), `riotNames[]`(결과창 닉네임 자동 연결용), `aliases[]`(AKA, 카톡 붙여넣기 선택용), `lates`(지각 횟수), `lateLog[]`(지각마다 깎은 점수), `streak`(시리즈 기준 연승 양수/연패 음수, 시리즈가 끝나는 세트에서만 `nextStreak`로 갱신. `시리즈 종료`로 중단하면 변화 없음), `ts`
- `matches/{id}`: `ts`, `blue[]`, `red[]`(선수 id), `names{id:이름}`, `roles{id:포지션}`(배정 포지션, 이전 기록엔 없음), `series`(시리즈 id), `game`(세트 번호), `deltas{id:증감}`, `winner`('blue'|'red'), `pBlue`(블루 예상 승률 %), `prevStreak{id:n}`(시리즈를 끝낸 세트에만. 취소 시 되돌릴 이전 연속 값), `prevSetStreak{id:n}`(매 세트. 최근 경기 삭제 시 되돌릴 이전 세트 연속 값), `stats{id:{team,name,champion,level,kills,deaths,assists,cs,gold,damage,items[],extra[{key,value}]}}`, `statsMeta{duration,winner,teams,notes,ts}`(결과창 인식 결과)
- `series/current`: 진행 중 시리즈 공유 문서. `active`, `sid`, `blue[]`, `red[]`, `roles`, `key`, `score{blue,red}`, `done`, `winner`, `ts`. 시리즈가 끝나면 `done:true`로 결과를 남기고(같은 팀으로 한 번 더 / 결과 닫기), 닫으면 `{active:false}`
- 3판 2선 / 5판 3선: 시리즈 문서 `wins`(2|3, 없으면 `SERIES_WINS`=2, `winsOf`). 1세트 전에만 시리즈 라벨 버튼 `#btnBo`로 전환, 기기별 `localStorage` `mmr-bo`가 새 시리즈 기본값(`nextWins`), `같은 팀으로 한 번 더`는 이전 값 유지. 경기 문서에도 `wins` 기록(삭제로 시리즈 복원 시 사용). 한 번 짠 팀으로 한쪽이 `wins`승할 때까지 유지. MMR은 세트마다 갱신. 시리즈 중에는 참가자 변경과 다시 짜기 불가, `시리즈 종료`로 중단
- 기록/취소는 `repo.recordGame`/`repo.undoGame`. Firebase는 transaction + `FieldValue.increment`로 처리하고 경기 id를 `{sid}-g{세트}`로 고정해 중복 기록을 막는다(충돌 시 code `stale`). 아티팩트 db/local은 순차 쓰기
- 같은 팀/다른 팀 조건: 기기별 `localStorage` `mmr-cons` `{same:[[id..]], diff:[[a,b]]}`. 같은 팀 묶음 최대 5명(겹치면 합침), 다른 팀은 2명 쌍. `pickSplit`의 `fitsCons`로 조합을 거른 뒤 기존 규칙 적용. 만족하는 조합이 없으면 null
- 삭제는 `repo.trashGame`: 아무 경기나 선택 가능. `deltas`·전적·시리즈 전적을 역으로 적용하고 경기를 `trash/{id}`(원본 + `deletedAt`)로 옮긴다. 가장 최근 경기일 때만 연승(`prevStreak`, `prevSetStreak`)과 진행 중 시리즈를 되돌린다. 이전 경기는 그 경기 증감만 빼므로 이후 경기의 증감은 재계산하지 않는다
- 휴지통: 기록 탭 아래. `repo.restoreGame`(증감·전적 재적용, 연승·시리즈는 그대로) / `repo.purgeTrash`(완전 삭제, 2단계 확인)
- `localStorage` 모드: 키 `mmr-balancer-v1`에 `{players:{}, matches:{}}`. 참가자 선택은 `mmr-sel`

## 결과창 인식
- `worker/scoreboard.js`: Cloudflare Worker. POST `{image(base64), mime}` → Gemini `generateContent`(responseSchema, 기본 `gemini-3.8-flash`, env `GEMINI_MODEL`) → `{result}`. 키는 Worker Secret `GEMINI_API_KEY`. Origin은 `ALLOWED_ORIGINS`만 허용
- `worker/apps-script.gs`: 같은 기능의 Google Apps Script 웹 앱. **현재 사용 중**(`VISION_URL`). Cloudflare에서 Gemini가 `User location is not supported`를 낼 때 사용(Google 서버라 지역 제한 없음). 키는 스크립트 속성 `GEMINI_API_KEY`. Origin 검사 불가. PROMPT/SCHEMA는 scoreboard.js와 같게 유지
- 사이트: 요청은 `text/plain`(preflight 없음)으로 보내 두 중계 모두 호환. `VISION_URL`이 있으면 기록 카드에 결과창 올리기 버튼. 이미지는 긴 변 2000px JPEG로 줄여 보냄 → `autoMap`(riotNames, 이름 일치/포함. 대소문자·공백·#태그 무시, l/I/1/|/i와 O/0/o는 같은 글자로 비교)으로 선수 연결 → 사용자가 확인 후 `repo.updateMatch`로 저장(이미 stats가 있으면 `mergeStat`으로 합침: 새로 읽힌 값만 덮고 null·빈 값은 기존 유지, extra는 key 기준 합침. 점수판 탭 + 통계 탭처럼 여러 장 올리기용), 연결한 닉네임은 `riotNames`에 추가

## 리플레이(.rofl) 업로드
- 기록 카드의 `리플레이 올리기`: 파일 끝 2MB만 읽어 `parseReplayText`로 `{"gameLength","statsJson"}`를 찾고(ROFL2 확인, 2026-11 기준) 결과창과 같은 모양으로 변환. AI·서버 없음
- 챔피언(`SKIN`)·아이템 ID는 Data Dragon ko_KR(`lolNames`, `localStorage` `mmr-ddragon` 하루 캐시)로 한국어 이름 변환. 실패 시 원문
- 이름은 `RIOT_ID_GAME_NAME#RIOT_ID_TAG_LINE`, CS는 미니언+정글, 딜량은 `TOTAL_DAMAGE_DEALT_TO_CHAMPIONS`, `extra`에 받은 피해·시야·와드·멀티킬 등. 팀 100=blue, 200=red(게임 내 진영)
- 이후 선수 연결·저장·합치기는 결과창 업로드와 같음
- 팀 짜기의 `리플레이로 기록`(다시 짜기/시리즈 종료 오른쪽, 블루·레드 승리 버튼은 그 아래 줄): 진행 중 시리즈에 리플레이 여러 개를 한 번에. 파일 이름의 경기 번호(`replayGameId`, 클수록 나중)로 세트 순서를 정하고, `autoMap`으로 연결된 선수의 게임 내 진영 다수결(`replayWinner`)로 시리즈 기준 승리 팀을 판정 → 미리보기 → `recordGame` + `updateMatch(stats)` 순서대로. 시리즈가 끝나면 남은 파일은 버림. `statsMeta.gameId`로 이미 기록된 리플레이는 제외. 닉네임 연결이 0명이면 기록 불가
- 끝난 시리즈 화면의 `리플레이로 통계 추가`(attach 모드): 승패·MMR은 건드리지 않고 `mergeStat`으로 합쳐 붙임. 같은 경기 번호가 이미 붙은 세트가 있으면 그 세트로(빠진 선수 보충용 재업로드 허용), 아니면 아직 리플레이가 없는 세트에 경기 번호순. 리플레이 승패가 기록과 다르면 `기록과 다름` 경고. 기본은 순서대로 배정하되 미리보기에서 세트를 직접 고를 수 있고, 같은 세트를 두 번 고르면 막음
- 리플레이 일괄 처리 공통: 같은 선택 안의 같은 경기 번호도 제외, 이름 바뀐 파일(번호 없음)은 맨 뒤(`byGameId`). 통계는 `recordGame(..., extra)`로 경기 문서에 함께 써서 gameId 누락을 막음. 저장 반영 대기(`waitFor`)가 8초를 넘으면 멈추고 알림. 시리즈가 바뀌면(sid·done) 열려 있던 미리보기는 버림. 통계 저장은 `statsPatch` + `learnRiotNames` 공용(빈 값은 기존 유지). 자동 연결 안 된 닉네임은 미리보기 `닉네임이 연결되지 않은 플레이어`에서 직접 선수를 고르면(`plan.extra`, `applyExtraMap`) 모든 파일에 적용되고 승패도 다시 판정

## 알고리즘
- 시작 MMR: 아이언 700, 브론즈 850, 실버 1000, 골드 1150, 플래티넘 1300, 에메랄드 1450, 다이아 이상 1600
- 팀 MMR = 평균. 기대 승률 `E = 1 / (1 + 10^((Rb - Ra) / 400))`
- 증감 = `round(K × 가속 × (결과 − E))`, 결과는 승 1 / 패 0. K는 10판 미만 48, 이후 32. E는 팀 평균끼리 비교(개인 MMR vs 상대 평균 방식은 균형 판에서 점수가 평균으로 몰려 쓰지 않음)
- 용맹의 방패(비선호 포지션 감점 완화): 선호 포지션이 있는 선수가 그 밖으로 배정돼(`isOffRole`, 배정은 `series.roles`) 지면 감점 ×0.5 (가속 적용 후). 이길 때는 그대로. 팀 카드 선수 옆에 `방패`, 위쪽 요약에 `용맹의 방패 n명` 표시
- 가속 `streakMult`: 세트 기준(`setStreak`) n연승(n≥2) 중 승리 또는 n연패 중 패배면 ×(1+0.1n), 상한 없음(10연속 ×2). 그 외 ×1. 이름은 연승가속/연패가속. 팀 카드에 `연승가속 ×1.n` 표시
- 팀 분할: 선택 인원(2~10, 짝수)의 모든 반분 조합(10명이면 126개, 0번 선수는 항상 A팀)을 평균 차이 순으로 정렬 → 최소 차이 + 10점 이내 상위 12개 중 무작위. 직전과 같은 조합은 피함. 블루/레드는 무작위 배정
- 포지션: 키 `top`/`jungle`/`mid`/`adc`/`support`. 최소 차이 + `POS_SLACK`(30) 안의 조합마다 `assignRoles`로 팀 내 서로 다른 포지션을 배정해(우선순위: 비선호 최소 → 주 포지션 최대 → 겹치면 MMR 높은 선수 우선) 비선호 배정 수(`off`)를 구하고, `off`가 가장 적은 조합만 남긴 뒤 위 규칙(+10, 상위 12, 직전 제외)을 적용. MMR은 포지션과 무관하게 하나

- 이스터에그(사용법에 안 적음): 리플레이·결과창 stats의 `extra` `펜타킬` 1번당 MMR +`PENTA_BONUS`(5). 일괄 기록 시 `deltas`에 포함하고 `matches.pentaBonus{id:점수}` 기록, 나중에 통계를 붙일 때는 `awardPenta`로 차액만 지급(중복 없음). deltas에 들어가 삭제·복원 시 함께 움직임. 기록 카드에 `펜타` 딱지

## 화면 구성
- 순위 1위(`kingId`: 한 세트 이상 뛴 선수 중 MMR 최고, 동점은 가나다순)는 모든 화면에서 황금 이름(`royalName`: 왕관 + 반짝이는 이름). 팀 짜기 칩(`.royal-chip`), 팀 카드, 기록 카드, 선수 목록, 순위 줄, 통계 카드
- 딱지(배치·비겁자·방패·연승가속/연패가속·펜타)는 `data-tip`에 설명. 누르면 말풍선(`.tip-pop`, document 캡처 클릭)으로 표시, 바깥 클릭·스크롤·탭 이동 시 닫힘. 새 딱지도 `data-tip`으로
- 탭은 hash 라우팅: `#teams`, `#ranking`, `#history`, `#stats`, `#players`. 상단 `사용법` 버튼 → `#help`(탭 줄에는 없음). 기능을 바꾸면 사용법 문구도 같이 고칠 것
- 지각: 진행 중 시리즈 화면 승리 버튼 아래 `#lateSel` + `#lateAmt`(`LATE_OPTIONS` 10/20/30, 기본 10) + `#btnLate`(2단계 확인) → 즉시 MMR −점수, `lates` +1, `lateLog`에 추가. 경기 기록과 무관(기록 탭에 안 남음). 취소는 선수 편집 패널 `지각 1회 취소`(마지막 점수만큼 +, `lateLog` 없으면 30으로 간주). 순위·선수 목록에 빨간 `지각 n` 딱지(`lateTag`, data-tip)
- 카톡 글 붙여넣기(`#pasteBox`, `parsePaste`): 공백·쉼표·줄바꿈으로 나눈 단어 중 등록된 선수 이름이나 AKA(`aliases`, 편집 패널)과 같은 것만 골라 선택을 교체(성+이름 `김강래`→강래, `@멘션`은 카톡 이름 안에 포함된 가장 긴 이름. 후보가 여럿이면 인정 안 함. @멘션이 있으면 @단어만 없음으로 알림)(최대 10명, 시리즈 중 불가). 없는 한글/영문 2글자 이상 단어는 `선수 목록에 없음`으로 알리고, 아래 `찾지 못한 이름`(`state.pasteUnknown`, `renderPasteMap`)에서 선수를 고르면 그 선수 `aliases`에 추가 + 선택
- 팀 짜기: 참가자 선택 칩 → 팀 짜기 또는 직접 짜기(MMR 순 번갈아 배정 후 시작) → 선수를 누른 뒤 같은 팀 선수를 누르면 포지션만 교환(시리즈 중 언제나, `series.roles` 갱신), 상대 팀 선수면 팀 교환(1세트 전에만, 서로의 포지션을 그대로 넘겨받음) → 승률 막대와 두 팀 카드(배정 포지션, 비선호 배정은 금색, 예상 증감 표시) → 다시 짜기(`makeSplit(ids)`: 기기별 참가자 선택이 아니라 지금 팀 선수로 다시 짜고 선택도 맞춤) / 블루 승리 / 레드 승리. `초기화`(2단계 확인)는 참가자 선택·같은 팀/다른 팀 조건·짜인 팀(진행 중 시리즈)을 지움. 기록·MMR은 유지
- 순위: 한 세트도 안 뛴 선수(games 0)는 숨김(개수 표시). MMR 내림차순, 시리즈 전적, 세트 전적, 연속(시리즈 기준 2연승/2연패 이상), 시리즈 승률, 배치(10판 미만) 표시, 선호 포지션이 1개(주 포지션만)면 빨간 `비겁자` 딱지. 1위 줄은 전부 금색 + 빛이 지나가는 배경(`royal-sweep`), 이름 반짝임(`.royal`), 떠오르는 왕관(♛). reduced-motion이면 정지. 토큰 `--gold-shine`, `--gold-glint`
- 기록: 최근 30경기, 선수별 증감, 경기별 삭제(2단계 확인, 휴지통으로), 휴지통(복원/완전 삭제)
- 통계: 선수 카드는 순위와 같은 MMR 내림차순, 순위 1위는 황금 카드(`.royal-card`, 같은 반짝임). 탭을 열 때 `repo.allMatches()`로 전체 경기를 받아 `aggregateStats`(결과창 stats 있는 경기만)로 집계. 선수별 카드(판수·승률, 평균 K/D/A·KDA 비율, 평균 CS·골드·딜, 모스트 챔피언 3)와 많이 나온 챔피언 10
- 선수: 개별 추가(선호 포지션 선택), 이름 일괄 추가(줄바꿈/쉼표), 편집 패널(이름, MMR, 선호 포지션, 롤 닉네임 `riotNames` 쉼표 구분), 목록에 닉네임 없음 표시, 삭제(2단계 확인)

## 알려진 한계
- 라인별 MMR 없음 (선호 포지션만 반영, MMR은 하나)
- 아티팩트 db/local 모드는 쓰기가 원자적이지 않음 (Firebase만 transaction)
- 선수 동시 편집은 마지막 저장이 남음
- 20명이 동시에 두 판을 돌리는 상황은 고려하지 않음 (한 판 최대 10명)
- Firestore 규칙이 공개라 링크를 아는 누구나 데이터를 지우거나 바꿀 수 있음

## 다음 작업 후보 (우선순위 순)
1. (완료) 선호 포지션 최대 2개 입력, 팀 분할 시 포지션 배정 반영. 라인별 MMR은 보류
2. (완료) 같은 팀 / 다른 팀 지정
3. 20명 중 10명 로테이션 추천 (오늘 적게 뛴 사람 우선)
4. 경기 MVP 가산점 (선택 입력)
   - 보류: 리플레이 성적 가속. 같은 포지션 맞상대와 비율 지표(킬 관여·딜 비중·분당 CS·분당 시야·데스 비중·탱킹 비중)를 포지션별 가중치로 비교해 −1~+1 점수 → 증감 배율 최대 ±20%(승리 시 ×1.2~0.8, 패배 시 감점 ×0.8~1.2). 리플레이로 기록한 세트만 적용 가능
5. (완료) Firebase Firestore 지원
6. (완료) 중복 기록 방지 (Firebase transaction)

## 확인 방법
- 구문: `node --check`로 `<script>` 내용 검사
- 로직: `// ---------- 순수 로직` ~ `// ---------- 저장소` 구간(`expected`, `splitAll`, `pickSplit`, `computeDeltas`)을 따로 떼어 샘플 선수로 실행
- 화면: 폰 폭(약 400px)과 데스크톱, 라이트/다크 모두에서 확인
