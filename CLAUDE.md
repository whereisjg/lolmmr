# 내전 MMR 밸런서

롤(LoL) 내전 친구 약 20명용 팀 밸런싱 도구. 승패만으로 Elo 기반 MMR을 갱신하고, 참가자를 평균 MMR 차이가 가장 작게 두 팀으로 나눈다.

## 현재 상태
- 단일 파일 `index.html` (HTML + CSS + vanilla JS, 빌드 없음, 외부 라이브러리 없음)
- Claude 아티팩트로 배포: https://claude.ai/artifact/HpJkteQe4aXS2sTck9qZKi (capabilities `db`). 공유 저장은 아티팩트 `db` 런타임에 의존
- 저장소 우선순위: `FIREBASE_CONFIG`가 있으면 Firestore(로그인 없이 공유, GitHub Pages 배포용) → 아티팩트 `db` → `localStorage`(이 기기에만 저장)
- Firestore compat SDK(gstatic 10.12.2)는 `repo`가 쓰는 API와 같은 모양이라 `this.db`에 그대로 넣는다. 보안 규칙은 `firestore.rules`(players, matches 공개 읽기/쓰기)
- UI 언어는 한국어. 폰트는 Google Fonts(Noto Sans KR, Chakra Petch)
- 아티팩트로 다시 올릴 때는 `<body>` 안쪽(`<title>`부터 `</script>`까지)만 게시한다. 저장소 파일의 doctype/head 래퍼는 단독 실행용

## 작업 규칙
- 먼저 `index.html`의 기존 패턴(저장소 래퍼 `repo`, `render*` 함수, CSS 토큰)을 읽고 따른다
- 수정은 최소 범위로. 구조 개편이나 프레임워크 도입은 요청 시에만
- 색은 `:root` 토큰만 사용. 라이트/다크 모두 정의되어 있으므로 하드코딩 금지
- 코드, 기술 용어는 영어, 화면 문구는 한국어
- 변경 후 확인: 스크립트 구문(`node --check`), 순수 로직 샘플 실행, 폰 폭(약 400px)에서 가로 스크롤 없음

## 데이터 모델 (db 컬렉션)
- `players/{id}`: `name`, `mmr`(정수), `pos`(선호 포지션 키 배열, 최대 2개, 0번이 주 포지션. 없거나 빈 배열 = 상관없음), `games`, `wins`, `losses`, `ts`
- `matches/{id}`: `ts`, `blue[]`, `red[]`(선수 id), `names{id:이름}`, `roles{id:포지션}`(배정 포지션, 이전 기록엔 없음), `series`(시리즈 id), `game`(세트 번호), `deltas{id:증감}`, `winner`('blue'|'red'), `pBlue`(블루 예상 승률 %)
- `series/current`: 진행 중 시리즈 공유 문서. `active`, `sid`, `blue[]`, `red[]`, `roles`, `key`, `score{blue,red}`, `ts`. 끝나면 `{active:false}`
- 3판 2선: 한 번 짠 팀으로 한쪽이 2승(`SERIES_WINS`)할 때까지 유지. MMR은 세트마다 갱신. 시리즈 중에는 참가자 변경과 다시 짜기 불가, `시리즈 종료`로 중단
- 기록/취소는 `repo.recordGame`/`repo.undoGame`. Firebase는 transaction + `FieldValue.increment`로 처리하고 경기 id를 `{sid}-g{세트}`로 고정해 중복 기록을 막는다(충돌 시 code `stale`). 아티팩트 db/local은 순차 쓰기
- 같은 팀/다른 팀 조건: 기기별 `localStorage` `mmr-cons` `{same:[[id..]], diff:[[a,b]]}`. 같은 팀 묶음 최대 5명(겹치면 합침), 다른 팀은 2명 쌍. `pickSplit`의 `fitsCons`로 조합을 거른 뒤 기존 규칙 적용. 만족하는 조합이 없으면 null
- 취소는 `deltas`를 역으로 적용 후 경기 삭제하고, 그 세트의 시리즈를 점수를 되돌려 복원
- `localStorage` 모드: 키 `mmr-balancer-v1`에 `{players:{}, matches:{}}`. 참가자 선택은 `mmr-sel`

## 알고리즘
- 시작 MMR: 아이언 700, 브론즈 850, 실버 1000, 골드 1150, 플래티넘 1300, 에메랄드 1450, 다이아 이상 1600
- 팀 MMR = 평균. 기대 승률 `E = 1 / (1 + 10^((Rb - Ra) / 400))`
- 증감 = `round(K × (결과 − E))`, 결과는 승 1 / 패 0. K는 10판 미만 48, 이후 32
- 팀 분할: 선택 인원(2~10, 짝수)의 모든 반분 조합(10명이면 126개, 0번 선수는 항상 A팀)을 평균 차이 순으로 정렬 → 최소 차이 + 10점 이내 상위 12개 중 무작위. 직전과 같은 조합은 피함. 블루/레드는 무작위 배정
- 포지션: 키 `top`/`jungle`/`mid`/`adc`/`support`. 최소 차이 + `POS_SLACK`(30) 안의 조합마다 `assignRoles`로 팀 내 서로 다른 포지션을 배정해 비선호 배정 수(`off`)를 구하고, `off`가 가장 적은 조합만 남긴 뒤 위 규칙(+10, 상위 12, 직전 제외)을 적용. MMR은 포지션과 무관하게 하나

## 화면 구성
- 탭은 hash 라우팅: `#teams`, `#ranking`, `#history`, `#players`
- 팀 짜기: 참가자 선택 칩 → 팀 짜기 → 승률 막대와 두 팀 카드(배정 포지션, 비선호 배정은 금색, 예상 증감 표시) → 다시 짜기 / 블루 승리 / 레드 승리
- 순위: MMR 내림차순, 전적, 승률, 배치(10판 미만) 표시
- 기록: 최근 30경기, 선수별 증감, 마지막 경기 취소(2단계 확인)
- 선수: 개별 추가(선호 포지션 선택), 이름 일괄 추가(줄바꿈/쉼표), 편집 패널(이름, MMR), 삭제(2단계 확인)

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
5. (완료) Firebase Firestore 지원
6. (완료) 중복 기록 방지 (Firebase transaction)

## 확인 방법
- 구문: `node --check`로 `<script>` 내용 검사
- 로직: `// ---------- 순수 로직` ~ `// ---------- 저장소` 구간(`expected`, `splitAll`, `pickSplit`, `computeDeltas`)을 따로 떼어 샘플 선수로 실행
- 화면: 폰 폭(약 400px)과 데스크톱, 라이트/다크 모두에서 확인
