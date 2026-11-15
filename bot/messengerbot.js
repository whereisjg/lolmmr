// 내전 MMR 카톡 봇 (메신저봇R, 레거시 API). 조회 + 참가 명단(series/roster)만 쓴다. 승패·MMR은 건드리지 않음.
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
// Firestore commit (여러 쓰기를 한 번에, 원자적)
function commit(writes) {
  org.jsoup.Jsoup.connect(BASE.replace(/\/$/, '') + ':commit').ignoreContentType(true).timeout(8000)
    .header('Content-Type', 'application/json').requestBody(JSON.stringify({ writes: writes }))
    .method(org.jsoup.Connection.Method.POST).execute();
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

// ---------- 참가 명단: series/roster {day, ids[], ts}. 날짜는 한국 시간 오전 6시에 바뀜(새벽 게임 포함)
var ROSTER = 'series/roster', MAX = 10;
var DOC = 'projects/lolmmr-25378/databases/(default)/documents/' + ROSTER;
function rosterDay() { return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); }
function rawRoster() { try { return obj(fetchJson(ROSTER).fields || {}); } catch (e) { return {}; } }
function readRoster() { var r = rawRoster(); return r.day === rosterDay() ? (r.ids || []) : []; }
function changeRoster(ids, add) {
  var writes = [];
  if (rawRoster().day !== rosterDay()) writes.push({ update: { name: DOC, fields: { day: { stringValue: rosterDay() }, ids: { arrayValue: {} } } } });
  var t = { fieldPath: 'ids' };
  t[add ? 'appendMissingElements' : 'removeAllFromArray'] = { values: ids.map(function (id) { return { stringValue: id }; }) };
  writes.push({ transform: { document: DOC, fieldTransforms: [t, { fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }] } });
  commit(writes);
}

// 이름 찾기(사이트 카톡 붙여넣기와 같은 규칙): 이름·AKA 일치 → 앞뒤 포지션 단어 떼기 → 성+이름 → (보낸 사람만) 카톡 이름 안에 든 가장 긴 이름
var POS_WORDS = '서포터|서폿|원딜|정글|미드|바텀|탑|봇|top|jungle|jg|mid|adc|bot|support|sup';
var POS_HEAD = new RegExp('^(?:' + POS_WORDS + ')(.{2,})$'), POS_TAIL = new RegExp('^(.{2,}?)(?:' + POS_WORDS + ')$');
function key(x) { return String(x).replace(/\s+/g, '').toLowerCase(); }
function finder(list) {
  var by = {};
  list.forEach(function (p) { (p.aliases || []).forEach(function (a) { by[key(a)] = p; }); });
  list.forEach(function (p) { by[key(p.name)] = p; });
  var names = Object.keys(by).filter(function (n) { return n.length >= 2; });
  function only(hit) {
    var ps = []; hit.forEach(function (n) { if (ps.indexOf(by[n]) < 0) ps.push(by[n]); });
    return ps.length === 1 ? ps[0] : null;
  }
  return function (word, loose) {
    var k = key(word);
    if (by[k]) return by[k];
    k = k.replace(/^[^0-9a-z가-힣]+|[^0-9a-z가-힣]+$/g, '');
    if (!k) return null;
    if (by[k]) return by[k];
    var m = POS_HEAD.exec(k) || POS_TAIL.exec(k);
    if (m && by[m[1]]) return by[m[1]];
    if (/^[가-힣]{3,}$/.test(k)) { var s = only(names.filter(function (n) { return k.length === n.length + 1 && k.slice(1) === n; })); if (s) return s; }
    if (loose) {
      var hit = names.filter(function (n) { return k.indexOf(n) >= 0; }), len = 0;
      hit.forEach(function (n) { if (n.length > len) len = n.length; });
      return only(hit.filter(function (n) { return n.length === len; }));
    }
    return null;
  };
}
function nameOf(map, id) { return map[id] ? map[id].name : '?'; }
function rosterText(ids, map) {
  if (!ids.length) return '[오늘 참가 명단] 아직 없습니다. !참가 로 신청하세요.';
  var main = ids.slice(0, MAX), wait = ids.slice(MAX);
  return '[오늘 참가 명단] ' + main.length + '/' + MAX + (main.length === MAX ? ' 마감' : '') + '\n' +
    main.map(function (id, i) { return (i + 1) + '. ' + nameOf(map, id); }).join('\n') +
    (wait.length ? '\n\n대기: ' + wait.map(function (id) { return nameOf(map, id); }).join(', ') : '');
}
// !참가 / !불참: 이름을 쓰면 그 사람들, 없으면 보낸 사람(카톡 이름)
function cmdJoin(args, sender, add) {
  var list = players(), map = {}, find = finder(list), who = [], miss = [];
  list.forEach(function (p) { map[p.id] = p; });
  if (args.length) args.forEach(function (a) { var p = find(a, false); if (p) { if (who.indexOf(p.id) < 0) who.push(p.id); } else miss.push(a); });
  else { var me = find(sender, true); if (me) who.push(me.id); else miss.push(sender); }
  if (!who.length) return "'" + miss.join(', ') + "' 선수를 찾지 못했습니다. 사이트 선수 탭 편집에서 AKA에 카톡 이름을 넣어 주세요.";
  var before = readRoster();
  changeRoster(who, add);
  var after = readRoster(), head;
  if (add) {
    var fresh = who.filter(function (id) { return before.indexOf(id) < 0; });
    head = fresh.length ? fresh.map(function (id) { return nameOf(map, id); }).join(', ') + ' 참가' : '이미 참가 중입니다.';
    if (before.length < MAX && after.length >= MAX) head += '\n10명 모였습니다! 사이트 팀 짜기에서 [카톡 명단 불러오기]를 누르세요.';
  } else {
    var gone = who.filter(function (id) { return before.indexOf(id) >= 0; });
    head = gone.length ? gone.map(function (id) { return nameOf(map, id); }).join(', ') + ' 불참' : '명단에 없습니다.';
    var up = after.slice(0, MAX).filter(function (id) { return before.slice(0, MAX).indexOf(id) < 0; });
    if (up.length) head += '\n대기에서 올라옴: ' + up.map(function (id) { return nameOf(map, id); }).join(', ');
  }
  return head + (miss.length ? '\n(못 찾은 이름: ' + miss.join(', ') + ')' : '') + '\n\n' + rosterText(after, map);
}
function cmdRoster() {
  var map = {}; players().forEach(function (p) { map[p.id] = p; });
  return rosterText(readRoster(), map);
}

var HELP = '[내전 봇]\n!참가 / !불참 오늘 명단 신청·취소 (!참가 이름 이름 으로 대신 신청)\n!명단 오늘 참가 명단\n!순위 MMR 순위\n!팀 진행 중 시리즈 팀·점수\n!전적 이름 개인 전적\n!사이트 사이트 주소';

function handle(msg, sender) {
  var m = msg.trim().split(/\s+/), c = m[0];
  if (c === '!도움' || c === '!명령어') return HELP;
  if (c === '!순위') return cmdRank();
  if (c === '!팀') return cmdTeam();
  if (c === '!전적') return cmdPlayer(m.slice(1).join(' '));
  if (c === '!사이트') return SITE;
  if (c === '!참가') return cmdJoin(m.slice(1), sender || '', true);
  if (c === '!불참') return cmdJoin(m.slice(1), sender || '', false);
  if (c === '!명단') return cmdRoster();
  return null;
}

function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  if (msg.charAt(0) !== '!') return;
  if (ROOMS.length && ROOMS.indexOf(room) < 0) return;
  try {
    var out = handle(msg, sender);
    if (out) replier.reply(out);
  } catch (e) {
    replier.reply('불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

if (typeof module !== 'undefined') module.exports = { handle: handle, setFetch: function (f) { fetchJson = f; }, setCommit: function (f) { commit = f; } };
