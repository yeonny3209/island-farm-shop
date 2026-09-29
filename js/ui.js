/* 작은 섬 농장 가게 — 화면과 조작
 * 규칙은 Engine 에 있고, 여기서는 그리기와 입력만 다룬다. */
(() => {
  'use strict';

  const D = GameData;
  const E = Engine;
  const B = D.BALANCE;
  const SAVE_KEY = 'island-farm-shop/save-v1';
  // 안드로이드 앱(Capacitor) 안에서 실행 중인지. 앱은 https://localhost 에서 돈다.
  const IS_APP = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform())
    || (location.protocol === 'https:' && location.hostname === 'localhost');
  const APK_URL = 'https://github.com/yeonny3209/island-farm-shop/releases/latest/download/island-farm-shop.apk';

  const $ = (sel, root = document) => root.querySelector(sel);
  const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
  const emo = (e, cls = '') => `<span class="emo ${cls}">${e}</span>`;
  // '으로/로': 받침이 없거나 ㄹ 받침이면 '로'
  const withRo = (w) => {
    const code = w.charCodeAt(w.length - 1);
    const fin = (code - 0xAC00) % 28;
    return w + (code >= 0xAC00 && code <= 0xD7A3 && fin !== 0 && fin !== 8 ? '으로' : '로');
  };
  // 가공품은 병(🍯/🥫) 위에 원래 작물을 작게 겹쳐 그린다
  const itemEmo = (id, cls = '') => {
    const it = E.ITEM[id];
    if (it.kind === 'crop') return emo(it.emoji, cls);
    return `<span class="emo prod ${cls}" title="${it.name}">${it.emoji}<i>${E.CROP[it.crop].emoji}</i></span>`;
  };
  const stars = (rep) => {
    const n = Math.max(0, Math.min(5, Math.round(rep / 20)));
    return `<span class="stars" aria-label="평판 ${Math.round(rep)}점">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
  };

  const hud = $('#hud');
  const main = $('#main');
  const bar = $('#actionbar');
  const modalEl = $('#modal');

  let S = null;
  const ui = {
    tab: 'farm',
    tool: 'water',
    seed: null,
    paint: null,
    biz: null,
    openWarn: false,
    sleepWarn: false,
    selSlot: null,
    skip: { days: 1, open: true, harvest: true },
    savePending: null,
    saveCode: '',
    codeIn: '',
    installPrompt: null,
    jarPick: {},
    seedQty: {},
    allSeeds: false,
    repay: 0,
    modal: null,
  };

  const TOOLS = [
    { id: 'plant', emoji: '🌱', name: '심기', key: '1', cost: () => `체력 ${B.plantCost}` },
    { id: 'water', emoji: '💧', name: '물 주기', key: '2', cost: () => `체력 ${E.waterCost(S)}` },
    { id: 'harvest', emoji: '🧺', name: '수확', key: '3', cost: () => `체력 ${B.harvestCost}` },
    { id: 'sprinkler', emoji: '⛲', name: '스프링클러', key: '4', cost: () => `설치·회수 · 보유 ${S.sprinklers}개` },
    { id: 'remove', emoji: '✂️', name: '뽑기', key: '5', cost: () => '체력 0' },
  ];
  const DRAG_TOOLS = ['plant', 'water', 'harvest'];

  // ---------- 저장 ----------
  // 자동 저장: 하루가 끝날 때, 앱을 내리거나 닫을 때. 수동 저장: 슬롯 3개. 다른 기기로 옮길 때는 저장 코드.
  const SLOT_COUNT = 3;
  const slotKey = (n) => `island-farm-shop/slot-${n}`;

  function save() {
    if (!S) return;
    S.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (err) { /* 저장소를 쓸 수 없는 환경 */ }
  }
  function parseState(raw) {
    try {
      const s = E.migrate(typeof raw === 'string' ? JSON.parse(raw) : raw);
      return E.isValidSave(s) ? s : null;
    } catch (err) { return null; }
  }
  function loadSave() {
    try { return parseState(localStorage.getItem(SAVE_KEY)); } catch (err) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* 무시 */ }
  }
  function readSlot(n) {
    try {
      const raw = localStorage.getItem(slotKey(n));
      if (!raw) return null;
      const box = JSON.parse(raw);
      const state = parseState(box.state);
      return state ? { savedAt: box.savedAt, state } : null;
    } catch (err) { return null; }
  }
  function writeSlot(n) {
    try {
      localStorage.setItem(slotKey(n), JSON.stringify({ savedAt: Date.now(), state: S }));
      return true;
    } catch (err) { return false; }
  }
  function deleteSlot(n) {
    try { localStorage.removeItem(slotKey(n)); } catch (err) { /* 무시 */ }
  }

  // 저장 코드: JSON → (가능하면 gzip) → base64. 앞머리로 형식을 구분한다.
  const toB64 = (bytes) => { let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
  const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  async function exportCode() {
    const json = new TextEncoder().encode(JSON.stringify(S));
    if (typeof CompressionStream === 'function') {
      const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      return 'ISF1G.' + toB64(new Uint8Array(gz));
    }
    return 'ISF1J.' + toB64(json);
  }
  async function importCode(code) {
    const c = code.replace(/\s+/g, '');
    const m = /^ISF1([GJ])\.(.+)$/.exec(c);
    if (!m) return null;
    try {
      let bytes = fromB64(m[2]);
      if (m[1] === 'G') {
        if (typeof DecompressionStream !== 'function') return null;
        bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      }
      return parseState(new TextDecoder().decode(bytes));
    } catch (err) { return null; }
  }

  function describeState(s) {
    const sz = D.SEASONS[E.seasonOf(s.day)];
    const when = s.phase === 'night' ? '밤' : '낮';
    return `${E.yearOf(s.day) > 1 ? `${E.yearOf(s.day)}년차 ` : ''}${sz.emoji} ${sz.name} ${E.dayInSeason(s.day)}일차 ${when} · ${s.day}일째`;
  }
  function timeAgo(t) {
    if (!t) return '';
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return '방금';
    if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
    const d = new Date(t);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ---------- 알림 ----------
  let toastTimer = 0;
  function toast(msg, warn) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (warn ? ' warn' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
  }

  function floatText(x, y, text) {
    const el = document.createElement('div');
    el.className = 'float';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  // ---------- 전체 그리기 ----------
  function setTime() {
    let t = 'day';
    if (ui.modal === 'morning' || ui.modal === 'intro') t = 'morning';
    else if (S.phase === 'night') t = ui.biz && !ui.biz.finished ? 'dusk' : 'night';
    document.body.dataset.time = t;
    document.body.dataset.season = String(E.seasonOf(S.day));
  }

  function render() {
    setTime();
    renderHud();
    if (S.phase === 'day') renderDay();
    else if (ui.biz) renderBiz();
    else renderNight();
  }

  function renderHud() {
    const season = E.seasonOf(S.day);
    const sz = D.SEASONS[season];
    const W = D.WEATHER[S.weather];
    const F = D.WEATHER[S.forecast];
    const left = B.deadline - S.day;
    let sub;
    if (S.paidOffDay) sub = `${E.yearOf(S.day)}년차 · 빚 청산 완료`;
    else if (left > 0) sub = `빚 마감까지 ${left}일`;
    else sub = '오늘이 빚 마감일!';
    const paid = Math.max(0, Math.min(1, 1 - S.debt / B.startDebt));
    // 영업 장면이 재생되는 동안에는 팔린 만큼만 돈이 오른다
    const money = ui.biz && !ui.biz.finished ? S.money - ui.biz.res.revenue + ui.biz.revenue : S.money;
    hud.innerHTML = `
      <div class="hud-block hud-date">
        <span class="season-chip" data-s="${season}">${sz.emoji} ${sz.name}</span>
        <div><b class="num">${E.dayInSeason(S.day)}일차</b><small>${S.day}일째 · ${sub}</small></div>
      </div>
      <div class="hud-block wx" title="${W.desc}">${emo(W.emoji)}<div><b>${W.name}</b><small>내일 ${F.emoji} ${F.name}</small></div></div>
      <div class="hud-block money">${emo('💰', 'coin')}<div><b class="num">${fmt(money)}G</b><small>가진 돈</small></div></div>
      <div class="hud-block hud-debt hud-meter"><div style="flex:1">
        <small>남은 빚 <b class="num" style="font-size:17px">${fmt(S.debt)}G</b> · ${Math.round(paid * 100)}% 갚음</small>
        <div class="bar debt"><i style="width:${paid * 100}%"></i></div>
      </div></div>
      <div class="hud-block hud-energy hud-meter"><div style="flex:1">
        <small>체력 <b class="num" style="font-size:17px">${S.energy}</b> / ${B.maxEnergy}</small>
        <div class="bar energy ${S.energy < 25 ? 'low' : ''}"><i style="width:${(S.energy / B.maxEnergy) * 100}%"></i></div>
      </div></div>
      <div class="hud-menu">
        <button class="icon-btn" data-act="saves" title="저장" aria-label="저장 관리">${emo('💾')}</button>
        ${IS_APP ? '' : `<button class="icon-btn" data-act="install" title="앱으로 설치" aria-label="앱으로 설치">${emo('📲')}</button>`}
        <button class="icon-btn" data-act="help" title="도움말" aria-label="도움말">?</button>
        <button class="icon-btn" data-act="restart" title="처음부터 다시" aria-label="처음부터 다시">↺</button>
      </div>`;
  }

  // ---------- 낮: 밭 / 온실 / 가게 진열 ----------
  function renderDay() {
    const sum = E.farmSummary(S);
    main.innerHTML = `
      <div class="tabs" role="tablist" id="tabs">${tabsHtml()}</div>
      <section class="day">
        <div class="stage">${ui.tab === 'shop' ? shopStage() : ui.tab === 'work' ? workStage() : farmStage(ui.tab)}</div>
        <aside class="side" id="side">${ui.tab === 'shop' ? shopSide() : ui.tab === 'work' ? workSide() : farmSide(sum)}</aside>
      </section>`;
    renderDayBar(sum);
  }

  function tabsHtml() {
    const count = (area) => {
      if (area === 'gh' && !E.hasGreenhouse(S)) return 0;
      return E.activeIndices(S, area).filter((i) => E.isReady(E.areaTiles(S, area)[i])).length;
    };
    const shown = S.shelf.filter((sl) => sl && S.stock[sl.id] > 0).length;
    const tab = (id, label, badge) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${ui.tab === id}">${label}${badge ? `<span class="count">${badge}</span>` : ''}</button>`;
    const jars = E.machineCount(S);
    const busy = S.machines.filter(Boolean).length;
    return tab('farm', '🌾 밭', count('farm')) + tab('gh', '🏡 온실', count('gh'))
      + tab('work', `🏺 공방${jars ? ` <small>${busy}/${jars}</small>` : ''}`, 0)
      + tab('shop', `🏪 가게 진열 <small>${shown}/${E.shelfSlots(S)}</small>`, 0);
  }

  // ---------- 가공 공방 ----------
  function jarHtml(m, i) {
    if (m) {
      const out = E.ITEM[E.productOf(m.c)];
      const P = D.PROCESSES[E.CROP[m.c].proc];
      const done = (P.days - m.d) / P.days;
      return `<div class="jar busy">
        <div class="jar-pot">${emo('🏺')}<span class="jar-in emo">${E.CROP[m.c].emoji}</span></div>
        <div class="jar-body">
          <b>${out.name} ×${m.n}</b>
          <small>${m.d === 1 ? '내일 아침 완성' : `${m.d}일 뒤 아침 완성`} · 개당 ${out.base}G</small>
          <div class="bar jarbar"><i style="width:${Math.max(8, done * 100)}%"></i></div>
        </div>
      </div>`;
    }
    const ids = Object.keys(S.stock).filter((id) => E.CROP[id] && S.stock[id] > 0)
      .sort((a, b) => S.stock[b] - S.stock[a]);
    if (!ids.length) {
      return `<div class="jar empty"><div class="jar-pot">${emo('🏺')}</div>
        <div class="jar-body"><b>빈 항아리</b><small>창고에 넣을 작물이 없어요</small></div></div>`;
    }
    const pick = ui.jarPick[i] || {};
    const sel = ids.includes(pick.id) ? pick.id : ids[0];
    const max = Math.min(B.procBatch, S.stock[sel]);
    const qty = Math.max(1, Math.min(pick.qty || max, max));
    const crop = E.CROP[sel];
    const out = E.ITEM[E.productOf(sel)];
    const P = D.PROCESSES[crop.proc];
    const options = ids.map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${E.CROP[id].emoji} ${E.CROP[id].name} (창고 ${S.stock[id]}개)</option>`).join('');
    return `<div class="jar empty">
      <div class="jar-pot">${emo('🏺')}</div>
      <div class="jar-body">
        <b>빈 항아리</b>
        <select id="jarsel-${i}" data-jarsel="${i}" aria-label="${i + 1}번 항아리에 넣을 작물">${options}</select>
        <div class="jar-row">
          <span class="stepper"><button data-jarstep="${i}" data-d="-1" aria-label="하나 빼기">−</button><output class="num">${qty}</output><button data-jarstep="${i}" data-d="1" aria-label="하나 더">+</button></span>
          <button class="btn small primary" data-jarload="${i}">넣기</button>
        </div>
        <small class="jar-out">→ ${itemEmo(out.id)} ${out.name} ${qty}개 · 개당 ${out.base}G <s>${crop.base}G</s> · ${P.days}일</small>
      </div>
    </div>`;
  }

  function workshopHtml() {
    const n = E.machineCount(S);
    if (!n) {
      const cost = E.upgradeInfo(S, 'workshop').next.cost;
      return `<div class="locked-plot workshop-locked"><div>${emo('🏺')}아직 가공 공방이 없어요.<br>밤에 업그레이드에서 ${fmt(cost)}G에 지을 수 있어요.<br>
        <small>과일은 잼, 채소는 피클이 되어 더 비싸게 팔려요.</small></div></div>`;
    }
    return `<div class="jars">${S.machines.map(jarHtml).join('')}</div>`;
  }

  function workStage() {
    return `<div class="yard">
      <div class="meadow-head"><h2>가공 공방</h2><span class="hint">항아리 하나에 같은 작물을 ${B.procBatch}개까지 넣어요</span></div>
      ${workshopHtml()}
    </div>`;
  }

  function recipeRows() {
    return D.CROPS.map((c) => {
      const out = E.ITEM[E.productOf(c.id)];
      return `<tr><td>${emo(c.emoji)} ${c.name}</td><td>${c.base}G</td><td>${itemEmo(out.id)} ${out.name}</td><td>${out.base}G</td></tr>`;
    }).join('');
  }

  function workSide() {
    const prods = Object.keys(S.stock).filter((id) => E.ITEM[id].kind !== 'crop' && S.stock[id] > 0)
      .map((id) => `<span class="chip">${itemEmo(id)} ${E.ITEM[id].name} <b>${S.stock[id]}</b></span>`).join('');
    return `
      <section class="panel"><h3>가공품 창고</h3><div class="summary">${prods || '<span class="empty-note">아직 가공품이 없어요.</span>'}</div></section>
      <section class="panel"><h3>가공하는 법</h3>
        <ul class="help" style="padding-left:18px;margin:0;font-size:13px;display:flex;flex-direction:column;gap:4px">
          <li>과일은 ${D.PROCESSES.jam.emoji} 잼, 채소는 ${D.PROCESSES.pickle.emoji} 피클이 돼요. ${D.PROCESSES.jam.days}일 뒤 아침에 창고로 들어와요.</li>
          <li>항아리에 넣는 데는 체력이 들지 않아요. 낮에도 밤에도 넣을 수 있어요.</li>
          <li>가공품은 계절을 타지 않고 손님이 꾸준히 찾아요. 겨울에 특히 잘 팔려요.</li>
          <li>팔고 남은 작물이나 지난 계절 작물을 넣어 두면 좋아요.</li>
        </ul>
      </section>
      <section class="panel"><h3>가공품 가격표</h3>
        <div class="crop-table-wrap"><table class="crop-table"><thead><tr><th>작물</th><th>기준가</th><th>가공품</th><th>기준가</th></tr></thead>
        <tbody>${recipeRows()}</tbody></table></div>
      </section>`;
  }

  function rerender() {
    if (S.phase === 'day') renderDay();
    else if (!ui.biz) renderNight();
  }

  function coverage(area) {
    const set = new Set();
    const tiles = E.areaTiles(S, area);
    for (const i of E.activeIndices(S, area)) if (tiles[i].s) E.neighbors(S, area, i).forEach((n) => set.add(n));
    return set;
  }

  function tileView(area, i, cover) {
    const t = E.areaTiles(S, area)[i];
    const frozen = area === 'farm' && E.seasonOf(S.day) === 3 && !t.c && !t.s;
    let cls = frozen ? 'frozen' : (t.w ? 'wet' : '');
    if (ui.tool === 'sprinkler' && cover.has(i) && !t.s) cls += ' sprinkled';
    let inner = '';
    let label;
    if (t.s) {
      inner = emo('⛲', 'spr');
      label = '스프링클러';
    } else if (t.c) {
      const c = E.CROP[t.c];
      if (E.isReady(t)) {
        inner = `<span class="plant p3 emo">${c.emoji}</span><span class="spark emo">✨</span>`;
        label = `${c.name}, 수확 가능`;
      } else {
        const f = t.g / c.grow;
        const stage = f < 0.34 ? 0 : f < 0.67 ? 1 : 2;
        inner = `<span class="plant p${stage} emo">${stage === 0 ? '🌱' : stage === 1 ? '🌿' : c.emoji}</span>`;
        if (!t.w) inner += '<span class="thirst" aria-hidden="true"></span>';
        inner += `<span class="prog"><i style="width:${Math.round(f * 100)}%"></i></span>`;
        label = `${c.name}, ${t.g}/${c.grow}일 자람, ${t.w ? '물 줌' : '물 필요'}`;
      }
    } else {
      label = frozen ? '언 땅' : t.w ? '젖은 빈 땅' : '빈 땅';
    }
    return { cls, inner, label };
  }

  function tileHtml(area, i, cover) {
    if (!E.isActive(S, area, i)) return '<div class="tile locked" aria-hidden="true"></div>';
    const v = tileView(area, i, cover);
    return `<button class="tile ${v.cls}" data-i="${i}" aria-label="${v.label}">${v.inner}</button>`;
  }

  function tileInfo(area, i) {
    if (!E.isActive(S, area, i)) return '아직 개간하지 않은 땅이에요. 밤에 “밭 확장”으로 넓힐 수 있어요.';
    const t = E.areaTiles(S, area)[i];
    if (t.s) return '⛲ 스프링클러 — 매일 아침 주변 8칸에 물을 줘요.';
    if (!t.c) {
      if (area === 'farm' && E.seasonOf(S.day) === 3) return '🧊 겨울에는 야외 밭이 얼어요. 온실을 이용하세요.';
      return `빈 땅${t.w ? ' (젖어 있음)' : ''} — 🌱 심기 도구로 씨앗을 심어요.`;
    }
    const c = E.CROP[t.c];
    const regrow = c.regrow ? ` · 수확 후 ${c.regrow}일마다 다시 열려요` : '';
    if (E.isReady(t)) return `${c.emoji} ${c.name} — 다 자랐어요! 🧺 수확하세요.${regrow}`;
    return `${c.emoji} ${c.name} — ${t.g}/${c.grow}일 자람 · ${t.w ? '💧 오늘 물 줌' : '물이 필요해요'}${regrow}`;
  }

  function farmStage(area) {
    if (area === 'gh' && !E.hasGreenhouse(S)) {
      const cost = E.upgradeInfo(S, 'greenhouse').next.cost;
      return `<div class="island"><div class="meadow">
        <div class="meadow-head"><h2>온실</h2></div>
        <div class="locked-plot"><div>${emo('🏡')}아직 온실이 없어요.<br>밤에 업그레이드에서 ${fmt(cost)}G에 지을 수 있어요.<br>
          <small>계절과 상관없이 어떤 씨앗이든 키울 수 있고, 겨울에도 농사를 지을 수 있어요.</small></div></div>
      </div></div>`;
    }
    const W = E.areaWidth(area);
    const cover = coverage(area);
    let cells = '';
    for (let i = 0; i < W * W; i++) cells += tileHtml(area, i, cover);
    const n = area === 'gh' ? W : E.fieldSize(S);
    const title = area === 'gh' ? `온실 ${W}×${W}` : `우리 밭 ${n}×${n}`;
    const hint = area === 'gh' ? '비가 들지 않아요 · 어떤 씨앗이든 OK' : (n < 8 ? '풀숲은 밤에 밭을 넓히면 쓸 수 있어요' : '밭을 끝까지 넓혔어요');
    return `<div class="island"><div class="meadow ${area === 'gh' ? 'glasshouse' : ''}">
      <div class="meadow-head"><h2>${title}</h2><span class="hint">${hint}</span></div>
      <div class="plot ${area === 'gh' ? 'gh' : ''} tool-${ui.tool}" id="plot" data-area="${area}">${cells}</div>
      <div class="tile-info" id="tileInfo">칸에 마우스를 올리면 자세히 보여요. 누른 채 끌면 여러 칸을 한 번에!</div>
    </div></div>`;
  }

  function pickDefaultSeed(area) {
    if (ui.seed && S.seeds[ui.seed] > 0 && E.plantCheck(S, area, ui.seed).ok) return;
    const ids = Object.keys(S.seeds).filter((id) => S.seeds[id] > 0);
    ui.seed = ids.find((id) => E.plantCheck(S, area, id).ok) || ids[0] || null;
  }

  function farmSide(sum) {
    const area = ui.tab === 'gh' ? 'gh' : 'farm';
    pickDefaultSeed(area);
    const tools = TOOLS.map((t) => `
      <button class="tool" data-tool="${t.id}" aria-pressed="${ui.tool === t.id}">
        ${emo(t.emoji)}<span><span class="name">${t.name}</span><span class="cost">${t.cost()}</span></span><kbd>${t.key}</kbd>
      </button>`).join('');
    const seedIds = Object.keys(S.seeds).filter((id) => S.seeds[id] > 0)
      .sort((a, b) => E.CROP[a].season - E.CROP[b].season || E.CROP[a].base - E.CROP[b].base);
    const seeds = seedIds.length ? seedIds.map((id) => {
      const c = E.CROP[id];
      const chk = E.plantCheck(S, area, id);
      let meta;
      if (!chk.ok) meta = area === 'farm' && E.seasonOf(S.day) === 3 ? '온실에만 심을 수 있어요' : `${D.SEASONS[c.season].name} 작물 · 여기엔 못 심어요`;
      else if (chk.warn) meta = '계절 안에 다 못 자라요';
      else meta = `${D.TYPES[c.type].short} · ${c.regrow ? `${c.grow}일, 이후 ${c.regrow}일마다` : `${c.grow}일`}`;
      return `<button class="seed ${chk.ok ? '' : 'off'}" data-seed="${id}" aria-pressed="${ui.tool === 'plant' && ui.seed === id}">
        ${emo(c.emoji)}<span>${c.name} 씨앗<span class="meta">${meta}</span></span><span class="cnt num">×${S.seeds[id]}</span></button>`;
    }).join('') : '<p class="empty-note">씨앗이 없어요. 밤에 씨앗 가게에서 살 수 있어요.</p>';
    const chips = [
      sum.thirsty ? `<span class="chip warn">💧 물 필요 <b>${sum.thirsty}</b>칸</span>` : '<span class="chip ok">💧 물 다 줬어요</span>',
      sum.ready ? `<span class="chip warn">🧺 수확 가능 <b>${sum.ready}</b>칸</span>` : '',
      `<span class="chip">🌱 자라는 중 <b>${sum.growing}</b>칸</span>`,
    ].join('');
    return `
      <section class="panel"><h3>도구 <small>고른 뒤 칸을 눌러요</small></h3><div class="tools">${tools}</div></section>
      <section class="panel"><h3>씨앗 주머니</h3><div class="seedlist">${seeds}</div></section>
      <section class="panel"><h3>오늘 밭 상황</h3><div class="summary">${chips}</div></section>`;
  }

  // 가게 진열
  function tagInner(sl) {
    const price = E.priceOf(sl.id, sl.pct);
    const ch = E.chanceFor(S, sl.id, sl.pct);
    const cls = ch >= 0.65 ? 'hi' : ch >= 0.4 ? 'mid' : 'lo';
    return `<div class="price num">${price}<small>G</small></div>
      <div class="pct">기준가의 ${sl.pct}%</div>
      <div class="chance ${cls}">구매 확률 <b>${Math.round(ch * 100)}%</b></div>`;
  }

  function slotHtml(i) {
    const sl = S.shelf[i];
    if (!sl) {
      return `<div class="slot empty ${ui.selSlot === i ? 'selected' : ''}" data-slot="${i}" role="button" tabindex="0">
        <div>${emo('🧺')}<div><b>빈 진열칸</b></div><small>창고의 작물을 끌어다 놓거나<br>눌러서 올리세요</small></div></div>`;
    }
    const c = E.ITEM[sl.id];
    const stock = S.stock[sl.id] || 0;
    const qty = E.displayQty(S, sl.id);
    return `<div class="slot" data-slot="${i}">
      <div class="crate">${itemEmo(sl.id)}<div>
        <div class="cname">${c.name} ${sl.id === S.popular ? '<span class="popular-badge">인기</span>' : ''}</div>
        <div class="cmeta">${stock ? `진열 ${qty}개 · 창고 ${stock}개` : '창고에 없어서 오늘은 비어 있어요'}</div>
      </div></div>
      <div class="tag" data-tag="${i}">${tagInner(sl)}</div>
      <input type="range" id="price-${i}" data-price="${i}" min="${B.priceMin}" max="${B.priceMax}" step="${B.priceStep}" value="${sl.pct}" aria-label="${c.name} 가격 (기준가 대비 %)">
      <div class="slot-foot"><span>기준가 ${c.base}G</span><button class="btn small" data-clear="${i}">빼기</button></div>
    </div>`;
  }

  function shopStage() {
    const fc = E.customerForecast(S);
    const pop = E.CROP[S.popular];
    let slots = '';
    for (let i = 0; i < E.shelfSlots(S); i++) slots += slotHtml(i);
    return `<div class="shopfront"><div class="awning"></div>
      <div class="shop-info">
        <span class="chip">🌟 오늘의 인기 <b>${pop.emoji} ${pop.name}</b></span>
        <span class="chip">👥 예상 손님 <b>${fc.closed ? '휴업' : `${fc.min}~${fc.max}명`}</b></span>
        <span class="chip">가게 평판 ${stars(S.rep)}</span>
        <span class="chip">🧺 한 칸에 최대 <b>${B.shelfCap}</b>개</span>
      </div>
      <div class="slots" id="slots">${slots}</div>
    </div>`;
  }

  function shopSide() {
    const season = E.seasonOf(S.day);
    const rank = (id) => (E.ITEM[id].season === season ? 2 : E.ITEM[id].kind !== 'crop' ? 1 : 0);
    const ids = Object.keys(S.stock).filter((id) => S.stock[id] > 0)
      .sort((a, b) => rank(b) - rank(a) || E.ITEM[b].base - E.ITEM[a].base);
    const list = ids.length ? ids.map((id) => {
      const c = E.ITEM[id];
      const shown = S.shelf.some((sl) => sl && sl.id === id);
      const kind = c.kind !== 'crop' ? '가공품' : c.season === season ? '제철' : `${D.SEASONS[c.season].name} 작물`;
      const tags = [kind, id === S.popular ? '오늘 인기!' : ''].filter(Boolean).join(' · ');
      return `<button class="stock ${shown ? 'shown' : ''}" draggable="true" data-stock="${id}">
        ${itemEmo(id)}<span>${c.name}<span class="meta">기준가 ${c.base}G · ${tags}</span></span><span class="cnt num">×${S.stock[id]}</span></button>`;
    }).join('') : '<p class="empty-note">창고가 비었어요. 밭에서 수확하면 여기에 쌓여요.</p>';
    return `
      <section class="panel"><h3>창고 <small>끌어서 진열대로</small></h3><div class="stocklist">${list}</div></section>
      <section class="panel"><h3>손님과 가격</h3>
        <ul class="help" style="padding-left:18px;margin:0;font-size:13px;display:flex;flex-direction:column;gap:4px">
          <li>기준가로 팔면 손님 10명 중 8명이 사고, 1.5배면 3명만 사요.</li>
          <li>손님은 저마다 찾는 작물이 있어요. <b>제철 작물</b>과 <b>인기 작물</b>을 많이 찾아요.</li>
          <li>인기 작물은 40% 비싸게 받아도 기준가처럼 잘 팔려요.</li>
          <li>싸게 팔면 한 번에 여러 개 사 가요.</li>
          <li>비싸서 그냥 간 손님이 많으면 <b>평판</b>이 떨어지고, 내일 손님이 줄어요.</li>
          <li>가공품(잼·피클)은 계절을 타지 않고 손님이 꾸준히 찾아요. 겨울엔 더 많이 찾아요.</li>
          <li>안 팔린 작물은 창고에 남아요. 상하지 않아요.</li>
        </ul>
      </section>`;
  }

  function openWarnings(sum) {
    const w = [];
    if (sum.ready) w.push(`수확 안 한 작물 ${sum.ready}칸`);
    if (sum.thirsty && S.energy >= E.waterCost(S)) w.push(`물 안 준 작물 ${sum.thirsty}칸`);
    if (!S.shelf.some((sl) => sl && S.stock[sl.id] > 0)) w.push('진열한 작물이 없어요');
    return w;
  }

  function renderDayBar(sum) {
    const W = D.WEATHER[S.weather];
    const pop = E.CROP[S.popular];
    const warns = openWarnings(sum || E.farmSummary(S));
    const confirming = ui.openWarn && warns.length && !W.closed;
    let btns;
    const skipBtn = `<button class="btn" data-act="skip" title="날짜 건너뛰기">${emo('⏭️')} 건너뛰기</button>`;
    if (W.closed) btns = `${skipBtn}<button class="btn big primary" data-act="open">${emo('🌙')} 휴업하고 하루 마치기</button>`;
    else if (confirming) btns = '<button class="btn" data-act="cancelOpen">돌아가기</button><button class="btn big primary" data-act="open">그래도 문 열기</button>';
    else btns = `${skipBtn}<button class="btn big primary" data-act="open">${emo('🏪')} 가게 문 열기</button>`;
    bar.innerHTML = `<div class="actionbar-inner">
      <div class="info">
        ${confirming ? `<span class="warn">잠깐! ${warns.join(' · ')}</span>` : `<span>${emo(W.emoji)} ${W.name}${W.closed ? ' — 오늘은 가게를 열 수 없어요' : W.customers < 1 ? ' — 손님이 줄어요' : ''}</span>
        <span>🌟 오늘의 인기 ${emo(pop.emoji)} <b>${pop.name}</b></span>`}
      </div>
      <div class="btns">${btns}</div>
    </div>`;
  }

  // 밭 칸 조작 (누른 채 끌어서 여러 칸)
  function applyTool(btn) {
    const plot = $('#plot');
    if (!plot || !btn) return;
    const area = plot.dataset.area;
    const i = Number(btn.dataset.i);
    const p = ui.paint;
    const key = area + ':' + i;
    if (p.visited.has(key)) return;
    p.visited.add(key);
    const res = E.act(S, ui.tool, area, i, ui.seed);
    if (!res.ok) {
      if (!p.errShown && (!res.quiet || p.visited.size === 1)) {
        toast(res.msg, true);
        p.errShown = true;
      }
      return;
    }
    p.changed = true;
    if (res.harvested) {
      const r = btn.getBoundingClientRect();
      floatText(r.left + r.width / 2, r.top, `+1 ${emo(E.CROP[res.harvested].emoji)}`);
    }
    if (res.warn && !p.warnShown) { toast(res.warn, true); p.warnShown = true; }
    if (res.msg) toast(res.msg);
    if (ui.tool === 'sprinkler' || ui.tool === 'remove') {
      renderDay();
      renderHud();
      return;
    }
    const v = tileView(area, i, coverage(area));
    btn.className = 'tile ' + v.cls;
    btn.innerHTML = v.inner;
    btn.setAttribute('aria-label', v.label);
    const info = $('#tileInfo');
    if (info) info.textContent = tileInfo(area, i);
    renderHud();
  }

  function endPaint() {
    if (!ui.paint) return;
    const changed = ui.paint.changed;
    ui.paint = null;
    if (changed && S.phase === 'day' && (ui.tab === 'farm' || ui.tab === 'gh')) {
      const sum = E.farmSummary(S);
      $('#side').innerHTML = farmSide(sum);
      $('#tabs').innerHTML = tabsHtml();
      renderDayBar(sum);
    }
  }

  // ---------- 영업 ----------
  function startBusiness() {
    const res = E.openShop(S);
    ui.openWarn = false;
    ui.selSlot = null;
    if (!res) return;
    if (res.closed) {
      ui.biz = null;
      toast(`${D.WEATHER[res.weather].name} 때문에 오늘은 휴업했어요.`);
      render();
      return;
    }
    ui.biz = { res, speed: 1, timers: [], finished: false, served: 0, sold: 0, revenue: 0, left: {} };
    res.slots.forEach((sl) => { ui.biz.left[sl.i] = sl.qty; });
    render();
    runBusiness();
  }

  function renderBiz() {
    const b = ui.biz;
    const r = b.res;
    const W = D.WEATHER[r.weather];
    const slots = r.slots.map((sl) => `
      <div class="scene-slot ${b.left[sl.i] ? '' : 'sold-out'}" data-sslot="${sl.i}">
        ${itemEmo(sl.id)}<span class="left num">×<span data-left="${sl.i}">${b.left[sl.i]}</span></span><br>
        <span class="ptag num">${sl.price}G</span>
      </div>`).join('');
    main.innerHTML = `<section class="biz">
      <div class="scene" id="scene">
        <div class="awning"></div>
        <div class="scene-shelf" id="sceneShelf">${slots}</div>
        <div class="door" aria-hidden="true"></div>
        ${r.slots.length ? '' : '<div class="closed-sign">진열대가 텅 비었어요…</div>'}
      </div>
      <aside class="board panel">
        <h3>오늘 영업 <small>${emo(W.emoji)} ${W.name} · 평판 ${stars(r.repBefore)}</small></h3>
        <div class="tally">
          <div><b class="num" id="tCust">${b.served}</b><span>/ ${r.customers.length}명 손님</span></div>
          <div><b class="num" id="tSold">${b.sold}</b><span>개 판매</span></div>
          <div class="rev"><b class="num" id="tRev">${fmt(b.revenue)}</b><span>G 매출</span></div>
        </div>
        <ul class="log" id="bizLog"></ul>
      </aside>
    </section>`;
    renderBizBar();
  }

  function renderBizBar() {
    const b = ui.biz;
    if (!b) return;
    if (b.finished) {
      bar.innerHTML = `<div class="actionbar-inner"><div class="info"><span>영업 끝! 오늘 매출 <b class="num">${fmt(b.res.revenue)}G</b></span></div>
        <div class="btns"><button class="btn big primary" data-act="toNight">${emo('🌙')} 정산하러 가기</button></div></div>`;
    } else {
      bar.innerHTML = `<div class="actionbar-inner"><div class="info"><span>${emo('🏪')} 영업 중… 손님이 오가고 있어요</span></div>
        <div class="btns"><button class="btn" data-act="bizSpeed" aria-pressed="${b.speed > 1}">⏩ ${b.speed > 1 ? '보통 속도' : '빠르게'}</button>
        <button class="btn primary" data-act="bizSkip">건너뛰기</button></div></div>`;
    }
  }

  function bizWait(b, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => (b.finished ? reject(new Error('skip')) : resolve()), ms / b.speed);
      b.timers.push(t);
    });
  }

  function runBusiness() {
    const b = ui.biz;
    const custs = b.res.customers;
    if (!custs.length) { finishBusiness(); return; }
    let k = 0;
    const next = () => {
      if (ui.biz !== b || b.finished || k >= custs.length) return;
      customerWalk(b, custs[k]).catch(() => {});
      k++;
      b.timers.push(setTimeout(next, 650 / b.speed));
    };
    next();
  }

  async function customerWalk(b, c) {
    const scene = $('#scene');
    if (!scene) return;
    const sr = scene.getBoundingClientRect();
    const shelf = $('#sceneShelf').getBoundingClientRect();
    const floorY = shelf.bottom - sr.top + 18 + Math.random() * 60;
    const door = { x: 20, y: sr.height - 100 };
    const posOf = (slot) => {
      const el = scene.querySelector(`[data-sslot="${slot}"]`);
      const r = el.getBoundingClientRect();
      return { x: r.left - sr.left + r.width / 2 - 20 + (Math.random() * 30 - 15), y: floorY };
    };
    const el = document.createElement('div');
    el.className = 'cust';
    el.textContent = c.face;
    el.style.transition = 'none';
    el.style.transform = `translate(${door.x}px, ${door.y}px)`;
    el.style.opacity = '0';
    scene.appendChild(el);
    void el.offsetWidth;
    el.style.transition = '';
    const walk = 620;
    const move = (p) => {
      el.style.setProperty('--walk', `${walk / b.speed}ms`);
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    };
    const say = (html, kind) => {
      el.querySelectorAll('.bubble').forEach((x) => x.remove());
      const bub = document.createElement('div');
      bub.className = 'bubble ' + kind;
      bub.innerHTML = html;
      el.appendChild(bub);
    };
    try {
      el.style.opacity = '1';
      await bizWait(b, 40);
      if (c.visits.length) {
        for (const v of c.visits) {
          move(posOf(v.slot));
          await bizWait(b, walk);
          const cr = E.ITEM[v.id];
          if (v.qty) {
            say(`${itemEmo(v.id)}×${v.qty} +${fmt(v.pay)}G`, 'buy');
            recordSale(b, c, v);
          } else {
            say(pickLine(['비싸요…', '너무 비싸!', '다음에 살게요', '음… 비싸네']), 'no');
            logLine(`${c.face} ${cr.name} 비싸서 안 샀어요`, 'no');
          }
          await bizWait(b, 760);
        }
      } else {
        move({ x: sr.width * 0.45 + Math.random() * 60, y: floorY });
        await bizWait(b, walk);
        say(`${itemEmo(c.want)} 없네…`, 'no');
        logLine(`${c.face} ${E.ITEM[c.want].name} 찾다가 그냥 갔어요`, 'no');
        await bizWait(b, 760);
      }
      el.querySelectorAll('.bubble').forEach((x) => x.remove());
      move(door);
      el.style.opacity = '0';
      await bizWait(b, walk);
      el.remove();
      b.served++;
      const t = $('#tCust');
      if (t) t.textContent = b.served;
      if (b.served >= b.res.customers.length) finishBusiness();
    } catch (err) {
      el.remove();
    }
  }

  const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function recordSale(b, c, v) {
    b.sold += v.qty;
    b.revenue += v.pay;
    b.left[v.slot] -= v.qty;
    const left = document.querySelector(`[data-left="${v.slot}"]`);
    if (left) {
      left.textContent = b.left[v.slot];
      const box = left.closest('.scene-slot');
      box.classList.remove('bump');
      void box.offsetWidth;
      box.classList.add('bump');
      if (!b.left[v.slot]) box.classList.add('sold-out');
    }
    $('#tSold').textContent = b.sold;
    $('#tRev').textContent = fmt(b.revenue);
    renderHud();
    const mood = v.mood === 'happy' ? ' 😊' : '';
    logLine(`${c.face} ${itemEmo(v.id)}×${v.qty} <b>+${fmt(v.pay)}G</b>${mood}`, 'buy');
  }

  function logLine(html, cls) {
    const log = $('#bizLog');
    if (!log) return;
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    log.prepend(li);
  }

  function finishBusiness(skipped) {
    const b = ui.biz;
    if (!b || (b.finished && !skipped)) return;
    b.finished = true;
    b.timers.forEach(clearTimeout);
    b.timers = [];
    if (skipped) {
      document.querySelectorAll('.cust').forEach((el) => el.remove());
      b.served = b.res.customers.length;
      b.sold = b.res.sold;
      b.revenue = b.res.revenue;
      renderBiz();
    }
    setTime();
    renderHud();
    renderBizBar();
  }

  // ---------- 밤: 정산, 씨앗, 업그레이드, 빚 ----------
  function receiptHtml() {
    const r = S.today;
    const season = D.SEASONS[E.seasonOf(S.day)];
    const W = D.WEATHER[r.weather];
    let body;
    if (r.rest) {
      body = '<div class="row"><span>가게를 쉬었어요</span><span>0G</span></div>';
    } else if (r.closed) {
      body = `<div class="row"><span>${W.emoji} ${withRo(W.name)} 휴업</span><span>0G</span></div>`;
    } else if (!r.lines.length) {
      body = '<div class="row"><span>진열한 작물이 없었어요</span><span>0G</span></div>';
    } else {
      body = r.lines.map((ln) => {
        const c = E.ITEM[ln.id];
        return ln.qty
          ? `<div class="row"><span>${itemEmo(ln.id)} ${c.name} ×${ln.qty} @${ln.price}</span><span class="num">${fmt(ln.total)}</span></div>`
          : `<div class="row note"><span>${itemEmo(ln.id)} ${c.name} @${ln.price}</span><span>안 팔림</span></div>`;
      }).join('');
    }
    const missing = Object.keys(r.missing || {}).map((id) => `${itemEmo(id)}${r.missing[id]}`).join(' ');
    const rejected = (r.lines || []).filter((ln) => ln.rejected).map((ln) => `${itemEmo(ln.id)}${ln.rejected}`).join(' ');
    const rep = r.closed ? '' : `<div class="row"><span>가게 평판</span><span>${stars(S.rep)} ${r.repDelta > 0 ? '+' : ''}${r.repDelta}</span></div>`;
    const left = B.deadline - S.day;
    return `<div class="receipt">
      <h2>작은 섬 농장 가게</h2>
      <div class="sub">${season.name} ${E.dayInSeason(S.day)}일차 · ${S.day}일째 · ${W.emoji}</div>
      <hr>${body}<hr>
      <div class="row total"><span>합계</span><span class="num">${fmt(r.revenue)}G</span></div>
      ${r.closed ? '' : `<div class="row note"><span>손님 ${r.customers.length}명 · 산 손님 ${r.buyers}명</span><span>${r.sold}개</span></div>`}
      ${r.pricey ? `<div class="row note"><span>비싸서 그냥 간 손님 ${r.pricey}명</span><span>${rejected}</span></div>` : ''}
      ${r.empty ? `<div class="row note"><span>찾는 게 없어 간 손님 ${r.empty}명</span><span>${missing}</span></div>` : ''}
      ${rep}
      <hr>
      <div class="row big"><span>가진 돈</span><span class="num">${fmt(S.money)}G</span></div>
      <div class="row big ${S.debt ? 'red' : 'green'}"><span>남은 빚</span><span class="num">${S.debt ? fmt(S.debt) + 'G' : '없음 🎉'}</span></div>
      ${S.paidOffDay ? '' : `<div class="row"><span>마감까지</span><span>${left > 0 ? `${left}일` : '오늘이 마지막!'}</span></div>`}
    </div>`;
  }

  function debtPanel() {
    if (!S.debt) {
      return `<section class="panel"><h3>빚 갚기</h3><p style="margin:0">빚을 모두 갚았어요! ${S.paidOffDay}일째에 청산했어요. 이제 마음껏 농사지으세요.</p></section>`;
    }
    const max = Math.floor(Math.min(S.money, S.debt));
    ui.repay = Math.min(ui.repay, max);
    const left = B.deadline - S.day;
    const perDay = left > 0 ? Math.ceil(S.debt / left) : S.debt;
    const quick = [100, 500, 1000].filter((v) => v < max).map((v) => `<button class="btn small" data-repayset="${v}">${fmt(v)}</button>`).join('');
    return `<section class="panel"><h3>빚 갚기 <small>이자는 없어요</small></h3>
      <div class="repay-row">
        <output class="repay-amt num" id="repayAmt">${fmt(ui.repay)}G</output>
        ${quick}<button class="btn small" data-repayset="${max}">전부 (${fmt(max)})</button>
      </div>
      <input type="range" id="repayRange" min="0" max="${max}" step="10" value="${ui.repay}" aria-label="갚을 금액" ${max ? '' : 'disabled'}>
      <div class="repay-row" style="justify-content:space-between">
        <span class="repay-help">${left > 0 ? `마감까지 ${left}일 · 하루 평균 ${fmt(perDay)}G씩` : '오늘 안에 다 갚아야 해요!'}</span>
        <button class="btn gold" data-act="repay" ${ui.repay > 0 ? '' : 'disabled'}>갚기</button>
      </div>
    </section>`;
  }

  function freeTilesTomorrow() {
    let n = 0;
    const areas = E.hasGreenhouse(S) ? ['farm', 'gh'] : ['farm'];
    for (const area of areas) {
      if (area === 'farm' && E.seasonOf(S.day + 1) === 3) continue;
      const tiles = E.areaTiles(S, area);
      for (const i of E.activeIndices(S, area)) {
        const t = tiles[i];
        if (t.s) continue;
        const willWither = area === 'farm' && t.c && E.CROP[t.c].season !== E.seasonOf(S.day + 1);
        if (!t.c || willWither || (E.isReady(t) && !E.CROP[t.c].regrow)) n++;
      }
    }
    return n;
  }

  function seedPanel() {
    const tomorrow = S.day + 1;
    const season = E.seasonOf(tomorrow);
    const gh = E.hasGreenhouse(S);
    const list = E.seedShopList(S, ui.allSeeds && gh);
    const owned = Object.keys(S.seeds).filter((id) => S.seeds[id] > 0).map((id) => `${E.CROP[id].emoji}${S.seeds[id]}`).join(' ') || '없음';
    const rows = list.map((c) => {
      const q = ui.seedQty[c.id] || 0;
      const h = E.harvestsIfPlanted(c.id, tomorrow);
      let fit;
      if (c.season !== season || season === 3) fit = gh ? '<span class="fit">온실에 심을 수 있어요</span>' : '<span class="fit no">온실이 있어야 심을 수 있어요</span>';
      else fit = h ? `<span class="fit yes">내일 심으면 이번 계절에 ${h}번 수확</span>` : '<span class="fit no">내일 심으면 계절 안에 못 자라요</span>';
      const timing = c.regrow ? `${c.grow}일 뒤 첫 수확, 이후 ${c.regrow}일마다` : `${c.grow}일 뒤 수확`;
      return `<div class="shop-item">
        ${emo(c.emoji)}
        <div class="title">${c.name} <span class="type-chip ${c.type}">${D.TYPES[c.type].short}</span></div>
        <div class="buy">
          <span class="stepper"><button data-step="${c.id}" data-d="-1" aria-label="${c.name} 하나 빼기">−</button><output class="num">${q}</output><button data-step="${c.id}" data-d="1" aria-label="${c.name} 하나 더">+</button><button data-step="${c.id}" data-d="5" aria-label="${c.name} 다섯 개 더">+5</button></span>
          <button class="btn small primary" data-buyseed="${c.id}" ${q > 0 && S.money >= q * c.seed ? '' : 'disabled'}>사기 ${q ? fmt(q * c.seed) + 'G' : ''}</button>
        </div>
        <div class="desc">씨앗 ${c.seed}G · 기준가 ${c.base}G · ${timing}<br>${fit}</div>
      </div>`;
    }).join('');
    return `<section class="panel"><h3>씨앗 가게 <small>${D.SEASONS[season].name} 씨앗 · 내일 빈 칸 약 ${freeTilesTomorrow()}칸</small></h3>
      ${gh ? `<label class="toggle"><input type="checkbox" id="allSeeds" ${ui.allSeeds ? 'checked' : ''}> 온실용으로 모든 계절 씨앗 보기</label>` : ''}
      <div class="shop-list">${rows}</div>
      <p class="repay-help">가진 씨앗: ${owned}</p>
    </section>`;
  }

  function upgradePanel() {
    const items = D.UPGRADES.map((u) => {
      const info = E.upgradeInfo(S, u.id);
      const pips = u.levels.map((_, k) => `<i class="${k < info.lv ? 'on' : ''}"></i>`).join('');
      const next = info.next ? `다음: ${info.next.label}` : '최고 단계예요';
      return `<div class="shop-item">
        ${emo(u.emoji)}
        <div class="title">${u.name} <span class="lvl">${pips}</span></div>
        <div class="buy">${info.next
          ? `<button class="btn small gold" data-up="${u.id}" ${S.money >= info.next.cost ? '' : 'disabled'}>${fmt(info.next.cost)}G</button>`
          : '<span class="chip ok">완료</span>'}</div>
        <div class="desc">${u.desc}<br><b>${next}</b></div>
      </div>`;
    }).join('');
    const spr = `<div class="shop-item">
      ${emo('⛲')}
      <div class="title">스프링클러 <small class="type-chip">보유 ${S.sprinklers}개</small></div>
      <div class="buy"><button class="btn small gold" data-act="buySprinkler" ${S.money >= B.sprinklerCost ? '' : 'disabled'}>${fmt(B.sprinklerCost)}G</button></div>
      <div class="desc">빈 칸에 설치하면 매일 아침 주변 8칸에 물을 줘요. 밭이 넓어질수록 꼭 필요해요.</div>
    </div>`;
    return `<section class="panel"><h3>업그레이드</h3><div class="shop-list">${spr}${items}</div></section>`;
  }

  function renderNight() {
    main.innerHTML = `<section class="night">
      <div>${receiptHtml()}</div>
      <div class="night-panels">
        <div style="display:flex;flex-direction:column;gap:16px">${seedPanel()}${E.machineCount(S)
          ? `<section class="panel"><h3>가공 공방 <small>팔고 남은 작물을 항아리에</small></h3>${workshopHtml()}</section>` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:16px">${debtPanel()}${upgradePanel()}</div>
      </div>
    </section>`;
    renderNightBar();
  }

  function renderNightBar() {
    const F = D.WEATHER[S.forecast];
    const last = !S.paidOffDay && S.debt > 0 && S.day >= B.deadline;
    const info = last
      ? `<span class="warn">${ui.sleepWarn ? '정말 잘까요? 빚이 남은 채로 마감이 지나면 가게를 잃어요.' : '오늘이 마감일이에요! 자기 전에 빚을 모두 갚아야 해요.'}</span>`
      : `<span>내일 날씨 ${emo(F.emoji)} <b>${F.name}</b> — ${F.desc}</span>`;
    const btns = last && ui.sleepWarn
      ? '<button class="btn" data-act="cancelSleep">돌아가기</button><button class="btn big primary" data-act="sleep">그래도 잠자기</button>'
      : `${last ? '' : `<button class="btn" data-act="skip" title="며칠 건너뛰기">${emo('⏭️')} 며칠 건너뛰기</button>`}<button class="btn big primary" data-act="sleep">${emo('💤')} 잠자기</button>`;
    bar.innerHTML = `<div class="actionbar-inner"><div class="info">${info}</div><div class="btns">${btns}</div></div>`;
  }

  function goSleep() {
    const last = !S.paidOffDay && S.debt > 0 && S.day >= B.deadline;
    if (last && !ui.sleepWarn) { ui.sleepWarn = true; renderNightBar(); return; }
    ui.sleepWarn = false;
    const r = E.sleep(S);
    if (!r) return;
    save();
    if (S.over === 'fail') { render(); showFail(); return; }
    ui.tab = 'farm';
    ui.jarPick = {};
    ui.seedQty = {};
    ui.repay = 0;
    ui.openWarn = false;
    ui.modal = 'morning';
    render();
    showMorning();
  }

  // ---------- 모달 ----------
  function openModal(html, kind) {
    ui.modal = kind;
    modalEl.innerHTML = html;
    modalEl.hidden = false;
    setTime();
    const btn = modalEl.querySelector('.actions .btn.primary, .actions .btn');
    if (btn) btn.focus();
  }

  function closeModal() {
    const kind = ui.modal;
    ui.modal = null;
    modalEl.hidden = true;
    modalEl.innerHTML = '';
    setTime();
    if (kind === 'intro') showMorning();
    if (kind === 'skipped' && S.phase === 'day') showMorning();
  }

  // ---------- 저장 관리 ----------
  function showSaves() {
    const busy = !!(ui.biz && !ui.biz.finished);
    const auto = loadSave();
    const pending = ui.savePending;
    const slotRows = [];
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const box = readSlot(n);
      const info = box
        ? `<b>${describeState(box.state)}</b><small>💰 ${fmt(box.state.money)}G · ${box.state.debt ? `빚 ${fmt(box.state.debt)}G` : '빚 없음'} · ${timeAgo(box.savedAt)}</small>`
        : '<b class="muted">비어 있음</b><small>지금 게임을 여기에 저장할 수 있어요</small>';
      const label = (act, text, warnText) => (pending === `${act}-${n}` ? warnText : text);
      slotRows.push(`<div class="save-slot ${box ? '' : 'empty'}">
        <div class="slot-no num">${n}</div>
        <div class="slot-info">${info}</div>
        <div class="slot-btns">
          <button class="btn small gold ${pending === `save-${n}` ? 'warn' : ''}" data-saveslot="${n}" ${busy ? 'disabled' : ''}>${label('save', '저장', '덮어쓸까요?')}</button>
          ${box ? `<button class="btn small primary ${pending === `load-${n}` ? 'warn' : ''}" data-loadslot="${n}" ${busy ? 'disabled' : ''}>${label('load', '불러오기', '정말 불러올까요?')}</button>
          <button class="btn small ${pending === `del-${n}` ? 'warn' : ''}" data-delslot="${n}">${label('del', '지우기', '정말 지울까요?')}</button>` : ''}
        </div>
      </div>`);
    }
    openModal(`<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="svTitle">
      <h2 id="svTitle">${emo('💾')} 저장 관리</h2>
      <p class="lead">자동 저장: 하루가 끝날 때와 앱을 내리거나 닫을 때 저절로 저장돼요.<br>
        <small>${auto ? `마지막 자동 저장 — ${describeState(auto)} · ${timeAgo(auto.savedAt)}` : '아직 자동 저장이 없어요.'}</small></p>
      ${busy ? '<p class="warn-line">영업이 끝난 뒤에 저장하거나 불러올 수 있어요.</p>' : ''}
      <h3 class="sub-h">저장 슬롯</h3>
      <div class="save-slots">${slotRows.join('')}</div>
      <h3 class="sub-h">다른 기기로 옮기기</h3>
      <p class="repay-help">휴대폰 ↔ 태블릿, 웹 ↔ 앱 사이에서는 저장이 따로 보관돼요. 저장 코드를 만들어 다른 기기에 붙여 넣으면 이어서 할 수 있어요.</p>
      <div class="code-box">
        <div class="code-row"><button class="btn small" data-act="makeCode">저장 코드 만들기</button>
          ${ui.saveCode ? '<button class="btn small gold" data-act="copyCode">복사</button>' : ''}</div>
        ${ui.saveCode ? `<textarea id="codeOut" readonly rows="3" aria-label="저장 코드">${ui.saveCode}</textarea>` : ''}
        <textarea id="codeIn" rows="3" placeholder="다른 기기에서 만든 저장 코드를 여기에 붙여 넣으세요" aria-label="불러올 저장 코드">${ui.codeIn || ''}</textarea>
        <div class="code-row"><button class="btn small primary ${pending === 'import' ? 'warn' : ''}" data-act="importCode" ${busy ? 'disabled' : ''}>${pending === 'import' ? '지금 게임 대신 불러올까요?' : '코드로 불러오기'}</button></div>
      </div>
      <div class="actions"><button class="btn primary" data-act="closeModal">닫기</button></div>
    </div>`, 'saves');
  }

  function loadState(state) {
    if (ui.biz) { ui.biz.finished = true; ui.biz.timers.forEach(clearTimeout); ui.biz = null; }
    S = state;
    Object.assign(ui, { tab: 'farm', paint: null, openWarn: false, sleepWarn: false, selSlot: null, jarPick: {}, seedQty: {}, repay: 0, savePending: null, saveCode: '', codeIn: '' });
    save();
    modalEl.hidden = true;
    ui.modal = null;
    render();
    toast(`불러왔어요: ${describeState(S)}`);
    if (S.over === 'fail') showFail();
  }

  // ---------- 앱으로 설치 ----------
  function showInstall() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let pwa;
    if (ui.installPrompt) pwa = '<button class="btn gold" data-act="pwaInstall">홈 화면에 설치하기</button>';
    else if (ios) pwa = '<p>Safari 아래쪽의 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>를 누르세요.</p>';
    else pwa = '<p>브라우저 메뉴(⋮)에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르세요.</p>';
    openModal(`<div class="modal help" role="dialog" aria-modal="true" aria-labelledby="inTitle">
      <h2 id="inTitle">${emo('📲')} 앱으로 설치하기</h2>
      <h3>안드로이드 휴대폰 · 태블릿</h3>
      <p>APK 파일을 내려받아 설치하면 앱처럼 실행되고, 인터넷이 없어도 할 수 있어요.</p>
      <p><a class="btn big primary" href="${APK_URL}" rel="noopener">${emo('🤖')} APK 내려받기</a></p>
      <ol>
        <li>내려받은 <b>island-farm-shop.apk</b> 파일을 열어요.</li>
        <li>“출처를 알 수 없는 앱” 설치를 허용해 달라고 하면 허용해요 (처음 한 번).</li>
        <li><b>설치</b>를 누르고 <b>열기</b>!</li>
      </ol>
      <h3>아이폰 · 아이패드 · 그 밖의 기기</h3>
      <p>이 페이지를 홈 화면에 설치하면 앱처럼 전체 화면으로 열리고, 한 번 연 뒤에는 인터넷 없이도 돼요.</p>
      ${pwa}
      <p class="repay-help">웹에서 하던 게임은 앱으로 저절로 넘어가지 않아요. ${emo('💾')} 저장 → “저장 코드 만들기”로 옮기세요.</p>
      <div class="actions"><button class="btn primary" data-act="closeModal">닫기</button></div>
    </div>`, 'install');
  }

  // ---------- 날짜 건너뛰기 ----------
  function showSkip() {
    const sk = ui.skip;
    const left = B.deadline - S.day;
    const stopNote = !S.paidOffDay && S.debt > 0 && left < sk.days
      ? `<p class="warn-line">빚 마감일(${B.deadline}일째) 밤에서 멈춰요. 그때 남은 빚을 갚을 수 있어요.</p>` : '';
    openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="skTitle">
      <h2 id="skTitle">${emo('⏭️')} 날짜 건너뛰기</h2>
      <p class="lead">${S.phase === 'day' ? '오늘 남은 일을 건너뛰고' : '바로 잠자리에 들고'} 날짜를 넘겨요.</p>
      <div class="seg" role="group" aria-label="건너뛸 날 수">${[1, 3, 7].map((n) => `<button class="seg-btn" data-skipdays="${n}" aria-pressed="${sk.days === n}">${n}일</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="skipOpen" ${sk.open ? 'checked' : ''}><span>건너뛰는 날에도 가게 열기<small>지금 진열대와 가격 그대로 팔아요</small></span></label>
      <label class="check"><input type="checkbox" id="skipHarvest" ${sk.harvest ? 'checked' : ''}><span>다 자란 작물 수확하기<small>그날 체력으로 한 칸에 1씩</small></span></label>
      <ul class="skip-notes">
        <li>물은 비와 스프링클러가 준 칸만 받아요.</li>
        <li>씨앗을 심거나 사지는 않아요. 항아리는 계속 가공해요.</li>
      </ul>
      ${stopNote}
      <div class="actions"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="doSkip">${sk.days}일 건너뛰기</button></div>
    </div>`, 'skip');
  }

  function runSkip() {
    const log = [];
    let stopped = null;
    for (let k = 0; k < ui.skip.days; k++) {
      const r = E.skipDay(S, { open: ui.skip.open, harvest: ui.skip.harvest });
      log.push(r);
      if (r.stopped) { stopped = r.stopped; break; }
    }
    save();
    Object.assign(ui, { tab: 'farm', jarPick: {}, seedQty: {}, repay: 0, openWarn: false, sleepWarn: false, selSlot: null });
    ui.modal = null;
    render();
    showSkipped(log, stopped);
  }

  function showSkipped(log, stopped) {
    const total = log.reduce((a, r) => a + (r.sale ? r.sale.revenue : 0), 0);
    const notable = ['🏺', '🌸', '🌻', '🍁', '❄️', '🧊'];
    const rows = log.map((r) => {
      const sz = D.SEASONS[E.seasonOf(r.day)];
      let what;
      if (!r.sale) what = '밤 → 잠자기';
      else if (r.sale.rest) what = '가게 쉼';
      else if (r.sale.closed) what = `${D.WEATHER[r.sale.weather].emoji} ${withRo(D.WEATHER[r.sale.weather].name)} 휴업`;
      else what = `손님 ${r.sale.customers.length}명 · ${r.sale.sold}개 판매 · <b class="num">+${fmt(r.sale.revenue)}G</b>`;
      const notes = [];
      if (r.harvested) notes.push(`🧺 ${r.harvested}개 수확`);
      (r.morning ? r.morning.events : []).filter((e) => notable.includes(e.icon)).forEach((e) => notes.push(`${e.icon} ${e.text}`));
      return `<li><span class="skip-day">${sz.emoji} ${sz.name} ${E.dayInSeason(r.day)}일차</span>
        <span>${what}${notes.length ? `<small>${notes.join('<br>')}</small>` : ''}</span></li>`;
    }).join('');
    openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="skdTitle">
      <h2 id="skdTitle">${log.length}일을 건너뛰었어요</h2>
      <p class="lead">매출 합계 <b class="num">${fmt(total)}G</b> · 지금 ${describeState(S)}</p>
      <ul class="skip-log">${rows}</ul>
      ${stopped === 'deadline' ? '<p class="warn-line">빚 마감일 밤이에요. 잠들기 전에 남은 빚을 갚으세요!</p>' : ''}
      <div class="actions"><button class="btn big primary" data-act="closeModal">${S.phase === 'day' ? '오늘 아침 보기' : '확인'}</button></div>
    </div>`, 'skipped');
  }

  function showMorning() {
    const m = S.morning;
    const W = D.WEATHER[S.weather];
    const F = D.WEATHER[S.forecast];
    const pop = E.CROP[S.popular];
    const sz = D.SEASONS[E.seasonOf(S.day)];
    const events = m.events.map((e) => `<li>${emo(e.icon)}<span>${e.text}</span></li>`).join('');
    openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <div class="morning-sky" data-w="${S.weather}">${emo(W.emoji)}<div>
        <h2 id="mTitle">${sz.name} ${E.dayInSeason(S.day)}일차 아침</h2><p>${W.name} · ${W.desc}</p></div></div>
      <div class="pop-card">${emo(pop.emoji)}<div><b>오늘의 인기 작물: ${pop.name}</b>
        <p>찾는 손님이 많고, 40% 비싸게 받아도 기준가처럼 잘 팔려요.</p></div></div>
      <ul class="events">${events}
        <li>${emo(F.emoji)}<span>내일 예보: <b>${F.name}</b>${F.closed ? ' — 가게를 열 수 없는 날이에요. 미리 대비하세요!' : ''}</span></li>
      </ul>
      <div class="actions"><button class="btn big primary" data-act="closeModal">하루 시작하기</button></div>
    </div>`, 'morning');
  }

  function showIntro() {
    openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="iTitle">
      <div class="hero-emoji">${emo('🏝️')}</div>
      <h2 id="iTitle" style="text-align:center">작은 섬 농장 가게</h2>
      <p class="lead" style="text-align:center">작은 섬의 버려진 밭과 가게를 물려받았어요.<br>그런데 <b>빚 ${fmt(B.startDebt)}G</b>도 함께 물려받았어요.</p>
      <p>${B.deadline}일 안에 작물을 키워 내 가게에서 팔고 빚을 갚으세요. 하루는 이렇게 흘러가요.</p>
      <ul class="events">
        <li>${emo('🌅')}<span><b>아침</b> — 날씨와 오늘의 인기 작물을 확인해요.</span></li>
        <li>${emo('🌱')}<span><b>밭 작업</b> — 도구를 고르고 칸을 눌러요. 누른 채 끌면 여러 칸! 행동마다 체력을 써요.</span></li>
        <li>${emo('🧺')}<span><b>가게 준비</b> — 창고의 작물을 진열대에 올리고 가격을 정해요.</span></li>
        <li>${emo('🏪')}<span><b>영업</b> — 손님이 오가며 사거나 그냥 가요.</span></li>
        <li>${emo('🌙')}<span><b>밤</b> — 정산하고, 씨앗과 업그레이드를 사고, 빚을 갚고 잠들어요.</span></li>
      </ul>
      <p class="repay-help">한 계절은 ${B.seasonLength}일이에요. 겨울에는 온실이 없으면 야외 밭이 얼어요. 가공 공방을 지으면 작물을 잼과 피클로 만들 수 있어요. 진행은 자동 저장되고, ${emo('💾')} 버튼에서 슬롯 3개에 따로 저장할 수 있어요. ${emo('⏭️')} 건너뛰기로 날짜를 빨리 넘길 수도 있어요.</p>
      <div class="actions"><button class="btn big primary" data-act="closeModal">시작하기</button></div>
    </div>`, 'intro');
  }

  function showHelp() {
    const rows = D.CROPS.map((c) => `<tr><td>${emo(c.emoji)}</td><td>${c.name}</td><td>${D.SEASONS[c.season].name}</td><td>${D.TYPES[c.type].short}</td>
      <td>${c.seed}G</td><td>${c.regrow ? `${c.grow}일 → ${c.regrow}일마다` : `${c.grow}일`}</td><td>${c.base}G</td></tr>`).join('');
    openModal(`<div class="modal wide help" role="dialog" aria-modal="true" aria-labelledby="hTitle">
      <h2 id="hTitle">도움말</h2>
      <h3>밭</h3>
      <ul>
        <li>하루 체력은 ${B.maxEnergy}이에요. 심기 ${B.plantCost}, 물 주기 ${E.waterCost(S)}, 수확 ${B.harvestCost}을 써요. 물뿌리개를 개량하면 물 주기가 싸져요.</li>
        <li>작물은 그날 물을 받아야 밤사이 하루만큼 자라요. 비가 오면 야외 밭 전체가 젖어요.</li>
        <li>계절이 바뀌면 지난 계절 작물은 시들어요. 온실 작물은 시들지 않아요.</li>
        <li>단축키: 1 심기 · 2 물 주기 · 3 수확 · 4 스프링클러 · 5 뽑기</li>
      </ul>
      <h3>가게</h3>
      <ul>
        <li>기준가로 팔면 손님 80%가 사고, 1.5배면 30%만 사요. 진열대 한 칸에는 한 작물을 최대 ${B.shelfCap}개까지 올려요.</li>
        <li>손님은 제철 작물과 인기 작물을 많이 찾아요. 찾는 게 없으면 둘러보다 그냥 가기도 해요.</li>
        <li>가게 평판은 손님 수에 영향을 줘요. 적당한 값에 산 손님은 평판을 올리고, 비싸서 그냥 간 손님은 떨어뜨려요.</li>
        <li>비 오는 날은 손님이 줄고, 폭풍이 오는 날은 문을 열 수 없어요. 폭풍은 전날 예보로 알 수 있어요.</li>
      </ul>
      <h3>저장과 건너뛰기</h3>
      <ul>
        <li>${emo('💾')} 자동 저장: 하루가 끝날 때, 앱을 내리거나 닫을 때 저절로 저장돼요.</li>
        <li>${emo('💾')} 버튼에서 슬롯 3개에 따로 저장하고 불러올 수 있어요. 저장 코드로 다른 기기에 옮길 수도 있어요.</li>
        <li>${emo('⏭️')} 건너뛰기: 1일·3일·7일을 한 번에 넘겨요. 건너뛰는 날에도 가게를 열고 다 자란 작물을 거둘 수 있어요. 빚 마감일 밤에서는 멈춰요.</li>
      </ul>
      <h3>가공 공방</h3>
      <ul>
        <li>밤에 “가공 공방”을 지으면 항아리가 생겨요 (2개 → 4개 → 6개). 🏺 공방 탭이나 밤 화면에서 항아리에 작물을 넣어요.</li>
        <li>항아리 하나에 같은 작물을 ${B.procBatch}개까지 넣으면 ${D.PROCESSES.jam.days}일 뒤 아침에 가공품이 창고로 들어와요. 과일은 잼, 채소는 피클이 돼요.</li>
        <li>가공품은 기준가가 더 높고 계절을 타지 않아요. 손님이 꾸준히 찾고, 겨울엔 더 많이 찾아요.</li>
      </ul>
      <div class="crop-table-wrap"><table class="crop-table"><thead><tr><th>작물</th><th>기준가</th><th>가공품</th><th>기준가</th></tr></thead>
        <tbody>${recipeRows()}</tbody></table></div>
      <h3>작물 수치표</h3>
      <div class="crop-table-wrap"><table class="crop-table">
        <thead><tr><th></th><th>작물</th><th>계절</th><th>종류</th><th>씨앗</th><th>자라는 기간</th><th>기준가</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="actions"><button class="btn primary" data-act="closeModal">닫기</button></div>
    </div>`, 'help');
  }

  function statsHtml() {
    return `<div class="stat-grid">
      <div><b class="num">${fmt(S.stats.revenue)}G</b><span>총 매출</span></div>
      <div><b class="num">${fmt(S.stats.sold)}개</b><span>판 작물</span></div>
      <div><b class="num">${fmt(S.stats.customers)}명</b><span>다녀간 손님</span></div>
      <div><b class="num">${fmt(S.stats.bestDay)}G</b><span>최고 하루 매출</span></div>
    </div>`;
  }

  function showPaidOff() {
    openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pTitle">
      <div class="hero-emoji">${emo('🎉')}</div>
      <h2 id="pTitle" style="text-align:center">빚을 모두 갚았어요!</h2>
      <p class="lead" style="text-align:center">${S.day}일째에 ${fmt(B.startDebt)}G를 전부 갚았어요.<br>이제 이 섬의 밭과 가게는 온전히 당신의 것이에요.</p>
      ${statsHtml()}
      <div class="actions"><button class="btn big primary" data-act="closeModal">계속 농사짓기</button></div>
    </div>`, 'ending');
  }

  function showFail() {
    openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="fTitle">
      <div class="hero-emoji">${emo('🌧️')}</div>
      <h2 id="fTitle" style="text-align:center">마감일이 지났어요</h2>
      <p class="lead" style="text-align:center">빚 ${fmt(S.debt)}G를 갚지 못해 가게를 넘겨주게 됐어요.<br>다음엔 가을까지 조금 더 모아 볼까요?</p>
      ${statsHtml()}
      <div class="actions"><button class="btn big primary" data-act="newGame">처음부터 다시</button></div>
    </div>`, 'fail');
  }

  function showRestart() {
    openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rTitle">
      <h2 id="rTitle">처음부터 다시 할까요?</h2>
      <p class="lead">지금까지의 진행과 저장이 지워지고 1일째부터 새로 시작해요.</p>
      <div class="actions"><button class="btn" data-act="closeModal">계속하기</button><button class="btn primary" data-act="newGame">처음부터 다시</button></div>
    </div>`, 'restart');
  }

  function newGame() {
    if (ui.biz) { ui.biz.finished = true; ui.biz.timers.forEach(clearTimeout); }
    clearSave();
    S = E.newGame((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    Object.assign(ui, { tab: 'farm', tool: 'water', seed: null, paint: null, biz: null, openWarn: false, sleepWarn: false, selSlot: null, jarPick: {}, seedQty: {}, allSeeds: false, repay: 0 });
    save();
    modalEl.hidden = true;
    ui.modal = null;
    render();
    showIntro();
  }

  // ---------- 입력 ----------
  function placeStock(id, slot) {
    let target = slot;
    if (target == null) target = ui.selSlot;
    if (target == null) {
      const existing = S.shelf.findIndex((sl) => sl && sl.id === id);
      if (existing >= 0) { toast('이미 진열 중이에요. 가격은 진열칸에서 바꿀 수 있어요.'); return; }
      target = S.shelf.findIndex((sl) => !sl);
    }
    if (target < 0) { toast('빈 진열칸이 없어요. 칸 하나를 빼거나 밤에 진열대를 늘려 보세요.', true); return; }
    const res = E.setShelf(S, target, id);
    if (!res.ok) { toast(res.msg, true); return; }
    ui.selSlot = null;
    renderDay();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act],[data-tab],[data-tool],[data-seed],[data-stock],[data-slot],[data-clear],[data-step],[data-buyseed],[data-up],[data-repayset],[data-jarstep],[data-jarload],[data-skipdays],[data-saveslot],[data-loadslot],[data-delslot]');
    if (!el) return;
    const d = el.dataset;

    // 저장 슬롯: 덮어쓰기·불러오기·지우기는 한 번 더 눌러야 실행된다
    if (d.saveslot || d.loadslot || d.delslot) {
      const n = Number(d.saveslot || d.loadslot || d.delslot);
      const act = d.saveslot ? 'save' : d.loadslot ? 'load' : 'del';
      const key = `${act}-${n}`;
      const box = readSlot(n);
      const needConfirm = act !== 'save' || !!box;
      if (needConfirm && ui.savePending !== key) { ui.savePending = key; showSaves(); return; }
      ui.savePending = null;
      if (act === 'save') {
        if (writeSlot(n)) toast(`${n}번 슬롯에 저장했어요.`);
        else toast('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.', true);
        showSaves();
      } else if (act === 'load') {
        if (box) loadState(box.state);
      } else {
        deleteSlot(n);
        toast(`${n}번 슬롯을 지웠어요.`);
        showSaves();
      }
      return;
    }
    if (d.skipdays) { ui.skip.days = Number(d.skipdays); showSkip(); return; }

    if (d.act) {
      switch (d.act) {
        case 'saves': ui.savePending = null; showSaves(); return;
        case 'install': showInstall(); return;
        case 'pwaInstall':
          if (ui.installPrompt) { ui.installPrompt.prompt(); ui.installPrompt = null; }
          closeModal();
          return;
        case 'skip': if (!ui.biz) showSkip(); return;
        case 'doSkip': runSkip(); return;
        case 'makeCode':
          exportCode().then((code) => { ui.saveCode = code; ui.savePending = null; showSaves(); toast('저장 코드를 만들었어요. 복사해서 다른 기기에 붙여 넣으세요.'); })
            .catch(() => toast('저장 코드를 만들지 못했어요.', true));
          return;
        case 'copyCode': {
          const box = $('#codeOut');
          const fallback = () => { if (box) { box.focus(); box.select(); } toast('코드를 길게 눌러 복사해 주세요.'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ui.saveCode).then(() => toast('저장 코드를 복사했어요.'), fallback);
          else fallback();
          return;
        }
        case 'importCode': {
          const text = ($('#codeIn') && $('#codeIn').value) || ui.codeIn || '';
          ui.codeIn = text;
          if (!text.trim()) { toast('불러올 저장 코드를 붙여 넣어 주세요.', true); return; }
          importCode(text).then((state) => {
            if (!state) { ui.savePending = null; toast('저장 코드가 올바르지 않아요. 전체를 빠짐없이 붙여 넣었는지 확인해 주세요.', true); return; }
            if (ui.savePending !== 'import') { ui.savePending = 'import'; showSaves(); return; }
            loadState(state);
          });
          return;
        }
        case 'help': showHelp(); return;
        case 'restart': showRestart(); return;
        case 'newGame': newGame(); return;
        case 'closeModal': closeModal(); return;
        case 'open': {
          if (ui.modal) return;
          const W = D.WEATHER[S.weather];
          if (!W.closed && !ui.openWarn && openWarnings(E.farmSummary(S)).length) {
            ui.openWarn = true;
            renderDayBar();
            return;
          }
          startBusiness();
          return;
        }
        case 'cancelOpen': ui.openWarn = false; renderDayBar(); return;
        case 'bizSpeed': if (ui.biz) { ui.biz.speed = ui.biz.speed > 1 ? 1 : 2.5; renderBizBar(); } return;
        case 'bizSkip': finishBusiness(true); return;
        case 'toNight': ui.biz = null; render(); return;
        case 'sleep': goSleep(); return;
        case 'cancelSleep': ui.sleepWarn = false; renderNightBar(); return;
        case 'buySprinkler': {
          const r = E.buySprinkler(S, 1);
          toast(r.ok ? '스프링클러를 샀어요. 내일 밭에서 ⛲ 도구로 설치하세요.' : r.msg, !r.ok);
          render();
          return;
        }
        case 'repay': {
          const r = E.repay(S, ui.repay);
          if (!r.ok) { toast(r.msg, true); return; }
          ui.repay = 0;
          toast(`${fmt(r.amount)}G를 갚았어요.`);
          render();
          if (r.paidOff) showPaidOff();
          return;
        }
        default: return;
      }
    }
    if (d.tab) { ui.tab = d.tab; ui.openWarn = false; renderDay(); return; }
    if (d.tool) { ui.tool = d.tool; renderDay(); return; }
    if (d.seed) { ui.seed = d.seed; ui.tool = 'plant'; renderDay(); return; }
    if (d.stock) { placeStock(d.stock); return; }
    if (d.clear != null) { E.clearShelf(S, Number(d.clear)); renderDay(); return; }
    if (d.slot != null && el.classList.contains('empty')) {
      const i = Number(d.slot);
      ui.selSlot = ui.selSlot === i ? null : i;
      renderDay();
      if (ui.selSlot != null) toast('창고에서 올릴 작물을 누르세요.');
      return;
    }
    if (d.step) {
      const next = Math.max(0, (ui.seedQty[d.step] || 0) + Number(d.d));
      ui.seedQty[d.step] = next;
      renderNight();
      return;
    }
    if (d.buyseed) {
      const c = E.CROP[d.buyseed];
      const q = ui.seedQty[d.buyseed] || 0;
      const r = E.buySeeds(S, d.buyseed, q);
      if (!r.ok) { toast(r.msg, true); return; }
      ui.seedQty[d.buyseed] = 0;
      toast(`${c.name} 씨앗 ${q}개를 샀어요.`);
      render();
      return;
    }
    if (d.up) {
      const r = E.buyUpgrade(S, d.up);
      if (!r.ok) { toast(r.msg, true); return; }
      const u = E.UP[d.up];
      toast(`${u.name} 완료! ${u.levels[S.up[d.up] - 1].label}`);
      render();
      return;
    }
    if (d.repayset) {
      ui.repay = Number(d.repayset);
      renderNight();
      return;
    }
    if (d.jarstep != null || d.jarload != null) {
      const i = Number(d.jarstep != null ? d.jarstep : d.jarload);
      const sel = main.querySelector(`[data-jarsel="${i}"]`);
      if (!sel) return;
      const id = sel.value;
      const max = Math.min(B.procBatch, S.stock[id] || 0);
      const cur = Math.max(1, Math.min((ui.jarPick[i] && ui.jarPick[i].id === id && ui.jarPick[i].qty) || max, max));
      if (d.jarstep != null) {
        ui.jarPick[i] = { id, qty: Math.max(1, Math.min(max, cur + Number(d.d))) };
        rerender();
        return;
      }
      const r = E.loadMachine(S, i, id, cur);
      if (!r.ok) { toast(r.msg, true); return; }
      delete ui.jarPick[i];
      toast(`${E.CROP[id].name} ${cur}개를 항아리에 넣었어요. ${r.days}일 뒤 아침에 ${E.josa(E.ITEM[r.product].name, '이가')} 돼요.`);
      rerender();
    }
  });

  main.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.price != null) {
      const i = Number(t.dataset.price);
      E.setShelfPrice(S, i, Number(t.value));
      const tag = main.querySelector(`[data-tag="${i}"]`);
      if (tag) tag.innerHTML = tagInner(S.shelf[i]);
    } else if (t.id === 'repayRange') {
      ui.repay = Number(t.value);
      $('#repayAmt').textContent = fmt(ui.repay) + 'G';
      const btn = main.querySelector('[data-act="repay"]');
      if (btn) btn.disabled = !(ui.repay > 0);
    }
  });

  main.addEventListener('change', (e) => {
    if (e.target.id === 'allSeeds') { ui.allSeeds = e.target.checked; renderNight(); return; }
    if (e.target.dataset.jarsel != null) {
      const id = e.target.value;
      ui.jarPick[Number(e.target.dataset.jarsel)] = { id, qty: Math.min(B.procBatch, S.stock[id] || 0) };
      rerender();
    }
  });

  // 밭 칠하기
  main.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('#plot .tile');
    if (!btn || btn.classList.contains('locked') || e.button > 0 || ui.modal) return;
    e.preventDefault();
    ui.paint = { visited: new Set(), changed: false, errShown: false, warnShown: false, x: e.clientX, y: e.clientY };
    applyTool(btn);
    if (!DRAG_TOOLS.includes(ui.tool)) endPaint();
  });
  // 빠르게 끌면 칸을 건너뛰므로 지난 위치부터 지금 위치까지 촘촘히 훑는다
  function sweepTo(tx, ty) {
    const p = ui.paint;
    const steps = Math.max(1, Math.ceil(Math.hypot(tx - p.x, ty - p.y) / 8));
    for (let k = 1; k <= steps && ui.paint; k++) {
      const el = document.elementFromPoint(p.x + ((tx - p.x) * k) / steps, p.y + ((ty - p.y) * k) / steps);
      const btn = el && el.closest('#plot .tile');
      if (btn && !btn.classList.contains('locked')) applyTool(btn);
    }
    if (ui.paint) { ui.paint.x = tx; ui.paint.y = ty; }
  }
  document.addEventListener('pointermove', (e) => {
    if (ui.paint) { sweepTo(e.clientX, e.clientY); return; }
    const tile = e.target.closest && e.target.closest('#plot .tile');
    const info = $('#tileInfo');
    if (tile && info) {
      const plot = $('#plot');
      const i = tile.dataset.i != null ? Number(tile.dataset.i) : [...plot.children].indexOf(tile);
      info.textContent = tileInfo(plot.dataset.area, i);
    }
  });
  document.addEventListener('pointerup', (e) => {
    if (ui.paint) sweepTo(e.clientX, e.clientY);
    endPaint();
  });
  document.addEventListener('pointercancel', endPaint);

  // 창고 → 진열대 끌어다 놓기
  main.addEventListener('dragstart', (e) => {
    const s = e.target.closest('[data-stock]');
    if (!s) return;
    e.dataTransfer.setData('text/plain', s.dataset.stock);
    e.dataTransfer.effectAllowed = 'move';
  });
  main.addEventListener('dragover', (e) => {
    const slot = e.target.closest('[data-slot]');
    if (!slot) return;
    e.preventDefault();
    main.querySelectorAll('.slot.drop').forEach((x) => x !== slot && x.classList.remove('drop'));
    slot.classList.add('drop');
  });
  main.addEventListener('dragleave', (e) => {
    const slot = e.target.closest('[data-slot]');
    if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('drop');
  });
  main.addEventListener('drop', (e) => {
    const slot = e.target.closest('[data-slot]');
    if (!slot) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id && E.ITEM[id]) placeStock(id, Number(slot.dataset.slot));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal && ['help', 'restart', 'saves', 'install', 'skip'].includes(ui.modal)) { closeModal(); return; }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.slot.empty')) { e.target.click(); return; }
    if (ui.modal || S.phase !== 'day' || (ui.tab !== 'farm' && ui.tab !== 'gh') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches && e.target.matches('input, select')) return;
    const tool = TOOLS.find((t) => t.key === e.key);
    if (tool) { ui.tool = tool.id; renderDay(); }
  });

  modalEl.addEventListener('input', (e) => {
    if (e.target.id === 'codeIn') { ui.codeIn = e.target.value; if (ui.savePending === 'import') ui.savePending = null; }
  });
  modalEl.addEventListener('change', (e) => {
    if (e.target.id === 'skipOpen') ui.skip.open = e.target.checked;
    if (e.target.id === 'skipHarvest') ui.skip.harvest = e.target.checked;
  });

  // 앱을 내리거나 닫을 때 자동 저장 (휴대폰은 뒤로 간 앱을 언제든 끌 수 있다)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  window.addEventListener('pagehide', save);

  // 홈 화면 설치(PWA)
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installPrompt = e; });
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !IS_APP) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 지원 없이도 게임은 돈다 */ });
  }

  // 안드로이드 앱: 뒤로 가기 버튼은 창을 닫고, 두 번 누르면 저장하고 종료
  const AppPlugin = IS_APP && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (AppPlugin && AppPlugin.addListener) {
    let lastBack = 0;
    AppPlugin.addListener('backButton', () => {
      if (ui.modal && ['help', 'restart', 'saves', 'install', 'skip', 'skipped'].includes(ui.modal)) { closeModal(); return; }
      save();
      if (Date.now() - lastBack < 2000) { AppPlugin.exitApp(); return; }
      lastBack = Date.now();
      toast('한 번 더 누르면 게임을 닫아요. 자동 저장했어요.');
    });
    AppPlugin.addListener('pause', save);
  }

  // ---------- 시작 ----------
  S = loadSave();
  if (!S) {
    newGame();
  } else {
    render();
    if (S.over === 'fail') showFail();
    else if (S.phase === 'day' && S.energy === B.maxEnergy) { ui.modal = 'morning'; setTime(); showMorning(); }
  }
})();
