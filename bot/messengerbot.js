// 내전 MMR 카톡 봇 (메신저봇R, 레거시 API). 조회 + 참가 명단(series/roster)만 쓴다. 승패·MMR은 건드리지 않음.
// 설치: 메신저봇R 앱 → 봇 추가 → 이 파일 내용 붙여넣기 → 컴파일 → 켜기. 카톡 알림 접근 허용 필요.
// ROOMS에 단톡방 이름(일부만 써도 됨)을 넣으면 그 방에서만 반응(비우면 모든 방).
// 주의: 카톡 버전에 따라 메신저봇R이 단톡방 이름 대신 보낸 사람 이름을 room으로 받으면 ROOMS가 모든 메시지를 걸러 버림. 그때는 비워 둘 것.

var ROOMS = [];
var SITE = 'https://whereisjg.github.io/lolmmr/';
var BASE = 'https://firestore.googleapis.com/v1/projects/lolmmr-25378/databases/(default)/documents/';
var POS = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' };
var ORDER = ['top', 'jungle', 'mid', 'adc', 'support'];

// 읽기: 문서 없음(404)은 {}, 네트워크·서버 오류는 2번 더 시도(폰 네트워크가 가끔 한 번씩 끊김)
function fetchJson(path) {
  for (var i = 0; ; i++) {
    try {
      var res = org.jsoup.Jsoup.connect(BASE + path).ignoreContentType(true).ignoreHttpErrors(true).timeout(8000).execute(), code = res.statusCode();
      if (code === 404) return {};
      if (code !== 200) throw new Error('HTTP ' + code);
      return JSON.parse(res.body());
    } catch (e) {
      if (i >= 2) throw e;
      java.lang.Thread.sleep(400 * (i + 1));
    }
  }
}
// Firestore commit (여러 쓰기를 한 번에, 원자적). 다시 시도하지 않음(!등록이 두 번 들어가지 않게). 응답은 읽어서 연결을 닫음
function commit(writes) {
  org.jsoup.Jsoup.connect(BASE.replace(/\/$/, '') + ':commit').ignoreContentType(true).timeout(8000)
    .header('Content-Type', 'application/json').requestBody(JSON.stringify({ writes: writes }))
    .method(org.jsoup.Connection.Method.POST).execute().body();
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
  s = obj(fetchJson('series/current').fields || {});
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
  var p = finder(all)(name, true);
  if (!p) return "'" + name + "' 선수를 찾지 못했습니다.";
  var rank = r.indexOf(p) + 1, sw = p.sWins || 0, sl = p.sLosses || 0, s = streakText(p.streak || 0);
  var pos = (p.pos || []).map(function (k) { return POS[k]; }).join('/') || '상관없음';
  return '[' + p.name + ']\n' +
    'MMR ' + p.mmr + (rank ? ' (' + rank + '위)' : ' (순위 없음)') + '\n' +
    '시리즈 ' + sw + '승 ' + sl + '패' + (sw + sl ? ' (' + Math.round(sw * 100 / (sw + sl)) + '%)' : '') + '\n' +
    '세트 ' + (p.wins || 0) + '승 ' + (p.losses || 0) + '패' + (s ? ' · ' + s : '') + '\n' +
    '포지션 ' + pos + (p.avoid ? ' · 기피 ' + POS[p.avoid] : '');
}

// ---------- 참가 명단: series/roster {day, ids[], out[], ts}. 날짜는 한국 시간 오전 6시에 바뀜(새벽 게임 포함). out = 오늘 !불참한 사람
var ROSTER = 'series/roster', MAX = 10;
var DOC = 'projects/lolmmr-25378/databases/(default)/documents/' + ROSTER;
function rosterDay() { return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); }
// 읽기 오류는 삼키지 않는다(예전엔 빈 명단으로 보여서 "0/10"이 나옴)
function rawRoster() { return obj(fetchJson(ROSTER).fields || {}); }
// 모집 중 = !내전으로 연 명단이 오늘 것(open, day). 아니면 null
function openRoster() { var r = rawRoster(); return r.open && r.day === rosterDay() ? { ids: r.ids || [], note: r.note || '', out: r.out || [] } : null; }
// 쓰기 뒤 다시 읽기: 쓰기는 이미 됐으니 읽기가 실패하면 예상 명단(fb)으로 보여 준다
function rosterAfter(fb) { try { return openRoster() || fb; } catch (e) { return fb; } }
function strs(a) { return { arrayValue: a.length ? { values: a.map(function (x) { return { stringValue: x }; }) } : {} }; }
// !내전: 명단을 새로 연다(보낸 사람은 바로 참가)
function startRoster(ids, note, by) {
  commit([{ update: { name: DOC, fields: { day: { stringValue: rosterDay() }, open: { booleanValue: true }, ids: strs(ids), note: { stringValue: note }, by: { stringValue: by } } },
    updateTransforms: [{ fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }] }]);
}
function changeRoster(ids, add) {
  var t = { fieldPath: 'ids' }, o = { fieldPath: 'out' }, v = strs(ids).arrayValue;
  t[add ? 'appendMissingElements' : 'removeAllFromArray'] = v;
  o[add ? 'removeAllFromArray' : 'appendMissingElements'] = v; // !불참한 사람은 !독려 목록에서 뺀다
  commit([{ transform: { document: DOC, fieldTransforms: [t, o, { fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }] } }]);
}

// 이름 찾기(사이트 카톡 붙여넣기와 같은 규칙): 이름·AKA 일치 → 앞뒤 포지션 단어 떼기 → 성+이름 → (보낸 사람만) 카톡 이름 안에 든 가장 긴 이름
var POS_WORDS = '서포터|서폿|원딜|정글|미드|바텀|탑|봇|top|jungle|jg|mid|adc|bot|support|sup';
var POS_HEAD = new RegExp('^(?:' + POS_WORDS + ')(.{2,})$'), POS_TAIL = new RegExp('^(.{2,}?)(?:' + POS_WORDS + ')$');
function key(x) { return String(x).replace(/\s+/g, '').toLowerCase(); }
function finder(list) {
  var by = Object.create(null); // 'constructor' 같은 말이 Object 기본 속성으로 잡히지 않게
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
// r = openRoster() 결과 {ids, note}. 제목에 시간(note) 표시
function rosterText(r, map) {
  var ids = r.ids, title = '[오늘 내전' + (r.note ? ' ' + r.note : '') + '] ';
  if (!ids.length) return title + '0/' + MAX + '\n!참가 로 신청하세요.';
  var main = ids.slice(0, MAX), wait = ids.slice(MAX);
  return title + main.length + '/' + MAX + (main.length === MAX ? ' 모집 완료' : '') + '\n' +
    main.map(function (id, i) { return (i + 1) + '. ' + nameOf(map, id); }).join('\n') +
    (wait.length ? '\n\n대기: ' + wait.map(function (id) { return nameOf(map, id); }).join(', ') : '');
}
// !참가 / !불참: 이름을 쓰면 그 사람들, 없으면 보낸 사람(카톡 이름)
function cmdJoin(args, sender, add) {
  var list = players(), map = {}, find = finder(list), who = [], miss = [];
  list.forEach(function (p) { map[p.id] = p; });
  args.forEach(function (a) { var p = find(a, false); if (p) { if (who.indexOf(p.id) < 0) who.push(p.id); } else miss.push(a); });
  var note = '';
  // 이름이 하나도 안 맞으면: !참가는 뒤의 말을 메모로 보고 보낸 사람 자신(못 찾은 단어는 알려 줌), !불참은 남을 잘못 빼지 않게 그대로 실패
  if (!who.length && (add || !args.length)) {
    if (args.length) note = "\n('" + miss.join(' ') + "'은(는) 선수 이름이 아니라서 본인 신청으로 처리. 새 친구면 !등록 이름 먼저)";
    miss = [];
    var me = find(sender, true);
    if (me) { who.push(me.id); if (!find(sender, false)) note += "\n(카톡 이름 '" + sender + "'을 " + me.name + '(으)로 인식. 틀리면 사이트 AKA에 카톡 이름을 넣어 주세요)'; }
    else miss.push(sender);
  }
  var cur = openRoster();
  if (!cur) return '모집 중인 내전이 없습니다. !내전 으로 모집을 시작하세요.';
  if (!who.length) return "'" + miss.join(', ') + "' 선수를 찾지 못했습니다. 사이트 선수 탭 편집에서 AKA에 카톡 이름을 넣어 주세요.";
  var before = cur.ids;
  changeRoster(who, add);
  var ar = rosterAfter({ note: cur.note, out: [], ids: add ? before.concat(who.filter(function (id) { return before.indexOf(id) < 0; }))
    : before.filter(function (id) { return who.indexOf(id) < 0; }) }), after = ar.ids, head;
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
  return head + note + (miss.length ? '\n(못 찾은 이름: ' + miss.join(', ') + ')' : '') + '\n\n' + rosterText(ar, map);
}
function cmdRoster() {
  var r = openRoster();
  if (!r) return '모집 중인 내전이 없습니다. !내전 으로 모집을 시작하세요.';
  var map = {}; players().forEach(function (p) { map[p.id] = p; });
  return rosterText(r, map);
}
// !독려: 남은 자리·시간·지금 참가자 + 최근 30일 안에 뛴(또는 등록한, players.ts) 사람 중 아직 신청 안 한 사람(오늘 !불참한 사람 제외)
// 내전 명언: 자리가 남았을 때 하나를 무작위로 붙인다
var CHEERS = ['안 오면 지상렬', '잠은 죽어서도 잘 수 있지만 내전은 못 한다', '오늘 빠지면 내일 단톡에서 내가 빠진다', '협곡은 기다려 주지 않는다',
  '내일 출근은 내일의 내가 한다', 'MMR은 참가한 자에게만 오른다', '숙제는 내일, 내전은 오늘', '한 판만 하자는 말은 아직 한 번도 지켜진 적 없다',
  '안 오는 자, 순위표에서 잊히리라', '피곤은 핑계, 내전은 운명', '술은 다음에도 마실 수 있지만 오늘 내전은 오늘뿐', '롤드컵은 못 가도 내전은 간다',
  '지는 건 괜찮다. 안 오는 게 문제다', '인생은 짧고 내전은 길다', '헬스는 내일도 열린다', '오늘의 불참은 평생의 놀림거리'];
function cmdCheer() {
  var r = openRoster();
  if (!r) return '모집 중인 내전이 없습니다. !내전 21시 처럼 먼저 모집을 시작하세요.';
  var list = players(), map = {}; list.forEach(function (p) { map[p.id] = p; });
  var ids = r.ids.filter(function (id) { return map[id]; }), n = Math.min(ids.length, MAX), left = MAX - n;
  var title = '[오늘 내전' + (r.note ? ' ' + r.note : '') + '] ';
  if (!left) return title + MAX + '명 모집 완료!' + (ids.length > MAX ? ' 대기 ' + (ids.length - MAX) + '명.' : '') + '\n못 오게 되면 !불참 으로 자리를 비워 주세요.';
  var since = Date.now() - 30 * 864e5;
  var rest = list.filter(function (p) { return ids.indexOf(p.id) < 0 && r.out.indexOf(p.id) < 0 && (p.ts || 0) >= since; })
    .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return '📣 ' + title + (!n ? '아직 0명입니다!' : (left === 1 ? '딱 1자리' : left + '자리') + ' 남았습니다! (' + n + '/' + MAX + ')') + '\n' +
    (!n ? '첫 참가자가 되어 주세요. ' : left === 1 ? '막차 타실 분? ' : '') + '!참가 로 신청하세요.\n' +
    '"' + CHEERS[Math.floor(Math.random() * CHEERS.length)] + '"' +
    (n ? '\n\n참가: ' + ids.slice(0, MAX).map(function (id) { return map[id].name; }).join(', ') : '') +
    (rest.length ? '\n' + (n ? '' : '\n') + '오늘 되시나요? ' + rest.map(function (p) { return p.name; }).join(', ') : '');
}
// !내전 [메모]: 오늘 내전 모집 시작. 이미 모집 중이면 명단만 보여 주고, !내전 새로 로 다시 시작
function cmdStart(args, sender) {
  var list = players(), map = {}, cur = openRoster();
  list.forEach(function (p) { map[p.id] = p; });
  var fresh = args[0] === '새로', note = (fresh ? args.slice(1) : args).join(' ');
  if (cur && cur.ids.length && !fresh) return '이미 모집 중입니다. 새로 모으려면 !내전 새로, 시간만 바꾸려면 !시간 22시30분\n\n' + rosterText(cur, map);
  var me = finder(list)(sender, true);
  startRoster(me ? [me.id] : [], note, sender);
  return '[내전 모집 시작]' + (note ? ' ' + note : '') + '\n!참가 / !불참 으로 신청하세요. 선착순 ' + MAX + '명, 넘으면 대기.' +
    (me ? '\n' + me.name + ' 참가' : '') + '\n\n' + rosterText(rosterAfter({ ids: me ? [me.id] : [], note: note }), map);
}
// !시간 22시30분: 모집 중인 명단의 시간(note)만 바꿈. 명단은 그대로
function cmdTime(text) {
  var cur = openRoster();
  if (!cur) return '모집 중인 내전이 없습니다. !내전 22시 처럼 시간과 함께 모집을 시작하세요.';
  if (!text) return cur.note ? '오늘 내전 시간: ' + cur.note : '시간이 아직 없습니다. !시간 22시30분 처럼 정하세요.';
  commit([{ update: { name: DOC, fields: { note: { stringValue: text } } }, updateMask: { fieldPaths: ['note'] },
    updateTransforms: [{ fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }] }]);
  var map = {}; players().forEach(function (p) { map[p.id] = p; });
  return '내전 시간 변경: ' + (cur.note ? cur.note + ' → ' : '') + text + '\n\n' + rosterText(rosterAfter({ ids: cur.ids, note: text }), map);
}

// !등록 이름 [티어] [포지션 최대 2개]: 사이트 선수 추가와 같은 모양(fresh). 티어 없으면 실버 1000
var TIERS = [['아이언', 700, '아이언'], ['브론즈', 850, '브론즈'], ['실버', 1000, '실버'], ['골드', 1150, '골드'], ['플래', 1300, '플래티넘'], ['에메', 1450, '에메랄드'], ['다이아', 1600, '다이아']];
var POS_KEY = { '탑': 'top', 'top': 'top', '정글': 'jungle', 'jg': 'jungle', 'jungle': 'jungle', '미드': 'mid', 'mid': 'mid',
  '원딜': 'adc', '바텀': 'adc', '봇': 'adc', 'adc': 'adc', 'bot': 'adc', '서폿': 'support', '서포터': 'support', 'sup': 'support', 'support': 'support' };
function newDocId() { var c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', o = ''; for (var i = 0; i < 20; i++) o += c.charAt(Math.floor(Math.random() * c.length)); return o; }
function cmdRegister(args) {
  var name = (args[0] || '').slice(0, 20);
  if (!name) return '사용법: !등록 이름 [티어] [포지션]\n예: !등록 현욱 골드 정글 미드 (티어 없으면 실버)';
  if (!/^[0-9A-Za-z가-힣]+$/.test(name)) return '이름은 한글·영문·숫자로만 써 주세요.';
  var list = players(), k = key(name);
  var same = list.filter(function (p) { return key(p.name) === k || (p.aliases || []).some(function (a) { return key(a) === k; }); })[0];
  if (same) return "'" + name + "'은(는) 이미 있습니다" + (same.name !== name ? ' (' + same.name + '의 AKA)' : '') + '.';
  var tier = TIERS[2], pos = [], bad = [];
  args.slice(1).forEach(function (a) {
    var lk = a.toLowerCase(), t = TIERS.filter(function (x) { return a.indexOf(x[0]) === 0; })[0];
    var pk = Object.prototype.hasOwnProperty.call(POS_KEY, lk) ? POS_KEY[lk] : null;
    if (t) tier = t; else if (pk) { if (pos.indexOf(pk) < 0 && pos.length < 2) pos.push(pk); } else bad.push(a);
  });
  if (bad.length) return "'" + bad.join(', ') + "'을(를) 모르겠습니다. 티어(아이언~다이아)나 포지션(탑 정글 미드 원딜 서폿)만 써 주세요.";
  commit([{ update: { name: 'projects/lolmmr-25378/databases/(default)/documents/players/' + newDocId(), fields: {
    name: { stringValue: name }, mmr: { integerValue: String(tier[1]) }, pos: strs(pos),
    games: { integerValue: '0' }, wins: { integerValue: '0' }, losses: { integerValue: '0' }, ts: { integerValue: String(Date.now()) } } },
    currentDocument: { exists: false } }]);
  return name + ' 등록 완료 (' + tier[2] + ' ' + tier[1] + (pos.length ? ', ' + pos.map(function (x) { return POS[x]; }).join('/') : ', 포지션 상관없음') + ')\n' +
    '이제 !참가 로 신청할 수 있습니다. 카톡 이름이 ' + name + '과 다르면 사이트 선수 편집에서 AKA에 카톡 이름을 넣어 주세요.';
}

var HELP = '[내전봇 사용법]\n\n■ 내전 모집 (선착순 10명)\n!내전 21시 : 모집 시작 (시간 메모 가능)\n!내전 새로 : 명단 비우고 다시 시작\n!시간 22시30분 : 시간만 변경 (명단 유지)\n!참가 / !불참 : 신청·취소\n!참가 강래 원빈 : 대신 신청\n!명단 : 지금 명단\n!독려 : 남은 자리·아직 신청 안 한 사람 알림\n!등록 현욱 골드 정글 : 새 선수 등록 (티어·포지션 생략 가능)\n\n■ 조회\n!순위 : MMR 순위\n!팀 : 진행 중 팀·점수\n!전적 이름 : 개인 전적\n!사이트 : 사이트 주소';

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
  if (c === '!독려') return cmdCheer();
  if (c === '!내전') return cmdStart(m.slice(1), sender || '');
  if (c === '!등록') return cmdRegister(m.slice(1));
  if (c.indexOf('!시간') === 0) return cmdTime(msg.trim().slice(3).trim()); // !시간22시30분 처럼 붙여 써도 됨
  return null;
}

// 같은 메시지가 두 카톡 계정(내 계정 + 봇 계정)으로 동시에 들어오면 먼저 온 하나만 답한다
// 알림은 스레드 여러 개에서 동시에 올 수 있어 putIfAbsent(원자적)로 검사
var recent = typeof java !== 'undefined' ? new java.util.concurrent.ConcurrentHashMap() : null;
function dup(k) {
  if (!recent) return false; // node 테스트
  var now = Date.now(), it = recent.entrySet().iterator();
  while (it.hasNext()) if (now - it.next().getValue() > 5000) it.remove();
  return recent.putIfAbsent(k, now) != null;
}
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  if (msg.charAt(0) !== '!') return;
  if (dup(sender + '|' + msg)) return;
  if (ROOMS.length && !ROOMS.some(function (r) { return String(room).indexOf(r) >= 0; })) return; // 방 이름에 포함되면 인정(이모지 등)
  try {
    var out = handle(msg, sender);
    if (out) replier.reply(out);
  } catch (e) {
    replier.reply('불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

// API2로 만든 봇에서도 동작하도록(레거시면 BotManager가 없어 건너뜀)
if (typeof BotManager !== 'undefined') {
  BotManager.getCurrentBot().addListener(Event.MESSAGE, function (m) {
    response(m.room, m.content, m.author.name, m.isGroupChat, { reply: function (t) { m.reply(t); } });
  });
}
if (typeof module !== 'undefined') module.exports = { handle: handle, setFetch: function (f) { fetchJson = f; }, setCommit: function (f) { commit = f; } };
