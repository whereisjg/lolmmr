// Google Apps Script: 롤 게임 결과창 이미지 → Gemini로 읽어 JSON 반환
// Cloudflare Worker가 "User location is not supported" 오류를 낼 때 쓰는 대체 중계.
// Google 서버에서 Gemini를 부르므로 지역 제한에 걸리지 않는다.
// 배포:
//   1. https://script.google.com > 새 프로젝트 > 이 파일 내용 붙여넣기 > 저장
//   2. 프로젝트 설정(톱니) > 스크립트 속성 > GEMINI_API_KEY 추가 (선택: GEMINI_MODEL)
//   3. 배포 > 새 배포 > 유형: 웹 앱 > 실행: 나 / 액세스 권한: 모든 사용자 > 배포 > 권한 승인
//   4. 나온 웹 앱 URL(.../exec)을 사이트의 VISION_URL에 넣는다
// 요청: POST(text/plain) { image: "<base64>", mime: "image/jpeg" }
// 응답: { result: {...} } 또는 { error: "..." }

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const PROMPT = `이 이미지는 리그 오브 레전드 게임 종료 후 결과창(점수판) 스크린샷이다.
화면에 보이는 정보를 빠짐없이 JSON으로 옮겨라.
- players: 화면에 보이는 모든 플레이어. 팀별로 위에서 아래 순서.
  - team: 왼쪽/위쪽 또는 파란 팀이면 "blue", 반대쪽/빨간 팀이면 "red", 알 수 없으면 "unknown"
  - name: 소환사 이름(닉네임) 그대로. 태그(#KR1 등)가 보이면 포함
  - champion: 챔피언 이름. 한국어 클라이언트면 한국어 이름 그대로
  - 숫자 칸(level, kills, deaths, assists, cs, gold, damage)은 보이는 값만 숫자로. 안 보이면 null
  - items: 아이템 이름을 알아볼 수 있으면 이름, 아니면 빈 배열
  - extra: 위 항목에 없는데 화면에 보이는 플레이어별 값(예: 시야 점수, 받은 피해, 와드, 룬, 스펠)을 {key, value} 문자열로 모두
- winner: 이긴 팀 "blue"/"red", 알 수 없으면 "unknown"
- duration: 게임 시간 문자열(예 "31:42"), 없으면 ""
- teams: 팀 합계(킬, 골드, 타워, 드래곤, 바론 등)가 보이면 팀별 {key, value} 목록
- notes: 읽기 어려웠던 부분이 있으면 짧게
숫자를 추측하지 말고, 읽을 수 없으면 null로 둔다.`;

const KV = { type: 'OBJECT', properties: { key: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['key', 'value'] };
const NUM = { type: 'INTEGER', nullable: true };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    winner: { type: 'STRING', enum: ['blue', 'red', 'unknown'] },
    duration: { type: 'STRING' },
    players: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          team: { type: 'STRING', enum: ['blue', 'red', 'unknown'] },
          name: { type: 'STRING' },
          champion: { type: 'STRING' },
          level: NUM, kills: NUM, deaths: NUM, assists: NUM, cs: NUM, gold: NUM, damage: NUM,
          items: { type: 'ARRAY', items: { type: 'STRING' } },
          extra: { type: 'ARRAY', items: KV }
        },
        required: ['team', 'name', 'champion', 'kills', 'deaths', 'assists']
      }
    },
    teams: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { team: { type: 'STRING' }, stats: { type: 'ARRAY', items: KV } }, required: ['team', 'stats'] }
    },
    notes: { type: 'STRING' }
  },
  required: ['winner', 'players']
};

function out(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return out({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ error: '잘못된 요청입니다.' }); }
  const image = typeof body.image === 'string' ? body.image : '';
  const mime = ['image/jpeg', 'image/png', 'image/webp'].indexOf(body.mime) >= 0 ? body.mime : 'image/jpeg';
  if (!image || image.length * 0.75 > MAX_IMAGE_BYTES) return out({ error: '이미지가 없거나 너무 큽니다.' });

  const model = props.getProperty('GEMINI_MODEL') || 'gemini-3.8-flash';
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: image } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 }
    })
  });
  const code = res.getResponseCode();
  let data = null;
  try { data = JSON.parse(res.getContentText()); } catch (err) {}
  if (code !== 200) {
    const msg = (data && data.error && data.error.message) || ('Gemini 오류 ' + code);
    return out({ error: code === 429 ? '무료 사용량을 넘었습니다. 잠시 후 다시 시도하세요.' : msg });
  }
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = parts ? parts.map(function (p) { return p.text || ''; }).join('') : '';
  try { return out({ result: JSON.parse(text) }); }
  catch (err) { return out({ error: '결과창을 읽지 못했습니다. 더 선명한 이미지로 다시 시도하세요.' }); }
}
