// 내전 MMR 카톡 봇 (메신저봇R, 레거시 API). 조회 전용: Firestore REST를 읽기만 한다.
// 설치: 메신저봇R 앱 → 봇 추가 → 이 파일 내용 붙여넣기 → 컴파일 → 켜기. 카톡 알림 접근 허용 필요.
// ROOMS에 단톡방 이름을 넣으면 그 방에서만 반응(비우면 모든 방).

var ROOMS = [];
var SITE = 'https://whereisjg.github.io/lolmmr/';
var BASE = 'https://firestore.googleapis.com/v1/projects/lolmmr-25378/databases/(default)/documents/';
var POS = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' };
var ORDER = ['top', 'jungle', 'mid', 'adc', 'support'];

function fetchJson(path) {
  var body = org.jsoup.Jsoup.connect(BASE + path).ignoreContentType(true).timeout(8000).execute().body();
  return JSON.parse(body);
}

// Firestore 값 → 일반 값
function val(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return obj(v.mapValue.fields || {});
  return null;
}
function obj(f) { var o = {}; for (var k in f) o[k] = val(f[k]); return o; }

function players() {
  var out = [], token = '';
  do {
    var j = fetchJson('players?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    (j.documents || []).forEach(function (d) {
      var p = obj(d.fields || {}); p.id = d.name.split('/').pop(); out.push(p);
    });
    token = j.nextPageToken || '';
  } while (token);
  return out;
}
function ranked(list) {
  return list.filter(function (p) { return (p.games || 0) > 0; })
    .sort(function (a, b) { return (b.mmr - a.mmr) || (a.name < b.name ? -1 : 1); });
}
function streakText(n) { return n >= 2 ? n + '연승' : n <= -2 ? (-n) + '연패' : ''; }

function cmdRank() {
  var r = ranked(players());
  if (!r.length) return '아직 기록이 없습니다.';
  return '[MMR 순위]\n' + r.map(function (p, i) {
    var s = streakText(p.streak || 0);
    return (i === 0 ? '♛ ' : (i + 1) + '. ') + p.name + ' ' + p.mmr + ' (' + (p.wins || 0) + '승 ' + (p.losses || 0) + '패' + (s ? ', ' + s : '') + ')';
  }).join('\n');
}

function cmdTeam() {
  var s;
  try { s = obj(fetchJson('series/current').fields || {}); } catch (e) { s = {}; }
  if (!s.active) return '진행 중인 시리즈가 없습니다.';
  var map = {}; players().forEach(function (p) { map[p.id] = p; });
  var roles = s.roles || {}, score = s.score || {}, wins = s.wins || 2;
  function side(ids) {
    ids = (ids || []).slice().sort(function (a, b) { return ORDER.indexOf(roles[a]) - ORDER.indexOf(roles[b]); });
    var sum = 0;
    var lines = ids.map(function (id) {
      var p = map[id] || { name: '?', mmr: 0 }; sum += p.mmr;
      return (POS[roles[id]] || '-') + ' ' + p.name + ' ' + p.mmr;
    });
    return { lines: lines, avg: ids.length ? Math.round(sum / ids.length) : 0 };
  }
  var b = side(s.blue), r = side(s.red);
  var head = s.done ? '[시리즈 종료] ' + (s.winner === 'blue' ? '블루' : '레드') + ' 승리' : '[' + (wins * 2 - 1) + '판 ' + wins + '선 진행 중]';
  return head + ' 블루 ' + (score.blue || 0) + ' : ' + (score.red || 0) + ' 레드\n\n' +
    '블루 (평균 ' + b.avg + ')\n' + b.lines.join('\n') + '\n\n' +
    '레드 (평균 ' + r.avg + ')\n' + r.lines.join('\n');
}

function cmdPlayer(name) {
  if (!name) return '사용법: !전적 이름';
  var all = players(), r = ranked(all);
  var p = all.filter(function (x) { return x.name === name || (x.aliases || []).indexOf(name) >= 0; })[0];
  if (!p) return "'" + name + "' 선수를 찾지 못했습니다.";
  var rank = r.indexOf(p) + 1, sw = p.sWins || 0, sl = p.sLosses || 0, s = streakText(p.streak || 0);
  var pos = (p.pos || []).map(function (k) { return POS[k]; }).join('/') || '상관없음';
  return '[' + p.name + ']\n' +
    'MMR ' + p.mmr + (rank ? ' (' + rank + '위)' : ' (순위 없음)') + '\n' +
    '시리즈 ' + sw + '승 ' + sl + '패' + (sw + sl ? ' (' + Math.round(sw * 100 / (sw + sl)) + '%)' : '') + '\n' +
    '세트 ' + (p.wins || 0) + '승 ' + (p.losses || 0) + '패' + (s ? ' · ' + s : '') + '\n' +
    '포지션 ' + pos + (p.avoid ? ' · 기피 ' + POS[p.avoid] : '');
}

var HELP = '[내전 봇]\n!순위 MMR 순위\n!팀 진행 중 시리즈 팀·점수\n!전적 이름 개인 전적\n!사이트 사이트 주소';

function handle(msg) {
  var m = msg.trim().split(/\s+/), c = m[0];
  if (c === '!도움' || c === '!명령어') return HELP;
  if (c === '!순위') return cmdRank();
  if (c === '!팀') return cmdTeam();
  if (c === '!전적') return cmdPlayer(m.slice(1).join(' '));
  if (c === '!사이트') return SITE;
  return null;
}

function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  if (msg.charAt(0) !== '!') return;
  if (ROOMS.length && ROOMS.indexOf(room) < 0) return;
  try {
    var out = handle(msg);
    if (out) replier.reply(out);
  } catch (e) {
    replier.reply('불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

if (typeof module !== 'undefined') module.exports = { handle: handle, setFetch: function (f) { fetchJson = f; } };
