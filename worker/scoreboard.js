// Cloudflare Worker: 롤 게임 결과창 이미지 → Gemini로 읽어 JSON 반환
// 배포: Cloudflare 대시보드 > Workers > Create > 이 파일 내용 붙여넣기 > Deploy
// 설정: Settings > Variables and Secrets 에 GEMINI_API_KEY(Secret) 추가
//       (선택) GEMINI_MODEL 로 모델 변경. 기본 gemini-2.5-flash
// 요청: POST { image: "<base64, data: 접두어 없이>", mime: "image/jpeg" }
// 응답: { result: {...} } 또는 { error: "..." }

const ALLOWED_ORIGINS = ['https://whereisjg.github.io'];
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

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
const json = (body, status, origin) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (req.method !== 'POST') return json({ error: 'POST만 지원합니다.' }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: '허용되지 않은 사이트입니다.' }, 403, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, 500, origin);

    let body;
    try { body = await req.json(); } catch { return json({ error: '잘못된 요청입니다.' }, 400, origin); }
    const image = typeof body.image === 'string' ? body.image : '';
    const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(body.mime) ? body.mime : 'image/jpeg';
    if (!image || image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: '이미지가 없거나 너무 큽니다.' }, 400, origin);

    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: image } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 }
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini 오류 ${res.status}`;
      return json({ error: res.status === 429 ? '무료 사용량을 넘었습니다. 잠시 후 다시 시도하세요.' : msg }, res.status === 429 ? 429 : 502, origin);
    }
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts.map(p => p.text || '').join('');
    try { return json({ result: JSON.parse(text) }, 200, origin); }
    catch { return json({ error: '결과창을 읽지 못했습니다. 더 선명한 이미지로 다시 시도하세요.' }, 502, origin); }
  }
};
