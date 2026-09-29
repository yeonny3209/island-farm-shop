#!/usr/bin/env node
/* 밸런스 시뮬레이션: 여러 성향의 자동 플레이어가 실제 게임 규칙(js/engine.js)으로 40일을 플레이한다.
 * 사용법: node tools/balance.js [판 수=300] */
'use strict';
const D = require('../js/data.js');
const E = require('../js/engine.js');

const B = D.BALANCE;
const DIFF = process.env.DIFF || 'hard'; // DIFF=easy node tools/balance.js
E.useDifficulty(DIFF);
const RUNS = Number(process.argv[2]) || 300;
const bySeason = (season, type) => D.CROPS.find((c) => c.season === season && c.type === type);

// ---------- 밭일 ----------
function sprinklerSpot(i, W) {
  const r = Math.floor(i / W);
  const c = i % W;
  return r % 3 === 1 && c % 3 === 1;
}

function farmDay(s, st) {
  const areas = E.hasGreenhouse(s) ? ['farm', 'gh'] : ['farm'];
  for (const area of areas) {
    for (const i of E.activeIndices(s, area)) {
      if (E.isReady(E.areaTiles(s, area)[i])) E.act(s, 'harvest', area, i);
    }
  }
  for (const area of areas) {
    const tiles = E.areaTiles(s, area);
    for (const i of E.activeIndices(s, area)) {
      const t = tiles[i];
      if (E.isGrowing(t) && !t.w) E.act(s, 'water', area, i);
    }
  }
  for (const area of areas) {
    const tiles = E.areaTiles(s, area);
    for (const i of E.activeIndices(s, area)) {
      const t = tiles[i];
      if (t.c || t.s) continue;
      if (s.sprinklers > 0 && sprinklerSpot(i, E.areaWidth(area))) {
        E.act(s, 'sprinkler', area, i);
        continue;
      }
      const id = choosePlant(s, area);
      if (!id) continue;
      const need = B.plantCost + (t.w ? 0 : E.waterCost(s));
      if (s.energy < need) return;
      E.act(s, 'plant', area, i, id);
      if (!t.w) E.act(s, 'water', area, i);
    }
  }
}

function choosePlant(s, area) {
  const ids = Object.keys(s.seeds).filter((id) => s.seeds[id] > 0);
  let best = null;
  let bestVal = -1;
  for (const id of ids) {
    const chk = E.plantCheck(s, area, id);
    if (!chk.ok || chk.warn) continue;
    const val = E.CROP[id].base;
    if (val > bestVal) { best = id; bestVal = val; }
  }
  return best;
}

// ---------- 가게 ----------
function stockShelf(s, st) {
  const season = E.seasonOf(s.day);
  const ids = Object.keys(s.stock).filter((id) => s.stock[id] > 0);
  const rank = (id) => (id === s.popular ? 2 : 0) + (E.ITEM[id].season === season ? 1 : E.ITEM[id].kind !== 'crop' ? 0.5 : 0);
  ids.sort((a, b) => rank(b) - rank(a) || E.displayQty(s, b) * E.ITEM[b].base - E.displayQty(s, a) * E.ITEM[a].base);
  const n = E.shelfSlots(s);
  for (let k = 0; k < n; k++) s.shelf[k] = null;
  ids.slice(0, n).forEach((id, k) => {
    E.setShelf(s, k, id);
    E.setShelfPrice(s, k, pricePct(s, st, id, ids.slice(0, n)));
  });
}

function pricePct(s, st, id, shown) {
  if (typeof st.price === 'number') return st.price;
  // smart: 오늘 예상 수요에 맞춰 가격을 고른다. 남은 재고는 나중에 팔 수 있으니 기회비용을 뺀다.
  const fc = E.customerForecast(s).avg;
  const W = E.ITEMS.reduce((a, it) => a + E.wantWeight(s, it, shown.includes(it.id)), 0);
  const share = E.wantWeight(s, E.ITEM[id], true) / W;
  const qty = E.displayQty(s, id);
  const base = E.ITEM[id].base;
  let bestPct = 100;
  let bestVal = -Infinity;
  for (let pct = 60; pct <= 180; pct += 5) {
    const p = E.chanceFor(s, id, pct);
    const r = id === s.popular ? pct / 100 / B.popularTolerance : pct / 100;
    const q = 1.6 + (r < 1 ? Math.min(1, (1 - r) * 2) : 0);
    const demand = fc * share * 1.25 * p * q;
    const sold = Math.min(qty, demand);
    const val = sold * (E.priceOf(id, pct) - base * st.holdValue);
    if (val > bestVal) { bestVal = val; bestPct = pct; }
  }
  return bestPct;
}

// ---------- 밤 ----------
function seedChoice(s, st, day, area) {
  const season = E.seasonOf(day);
  if (area === 'gh') {
    // 온실은 시들지 않으므로 재수확 작물이 가장 오래 이득
    const pool = D.CROPS.filter((c) => c.type === 'regrow');
    return pool.sort((a, b) => b.base / b.regrow - a.base / a.regrow)[0].id;
  }
  if (season === 3) return null;
  const fast = bySeason(season, 'fast');
  const slow = bySeason(season, 'slow');
  const regrow = bySeason(season, 'regrow');
  const ok = (c) => E.harvestsIfPlanted(c.id, day) > 0;
  const k = E.dayInSeason(day);
  switch (st.plant) {
    case 'fast': return ok(fast) ? fast.id : null;
    case 'slow': return ok(slow) ? slow.id : (ok(fast) ? fast.id : null);
    case 'regrow': return E.harvestsIfPlanted(regrow.id, day) >= 2 ? regrow.id : (ok(fast) ? fast.id : null);
    case 'mix': {
      if (k <= 2) {
        st._rot = (st._rot || 0) + 1;
        const c = [slow, regrow, fast][st._rot % 3];
        if (ok(c)) return c.id;
      }
      return ok(fast) ? fast.id : null;
    }
    case 'value': {
      // 가치 순으로 줄 세운 뒤 5:3:2 로 나눠 심는다 (한 가지만 심으면 손님이 찾는 게 없다)
      const ranked = [];
      for (const c of [fast, slow, regrow]) {
        const h = E.harvestsIfPlanted(c.id, day);
        if (!h) continue;
        const cycles = c.type === 'fast' ? Math.floor((B.seasonLength - k + 1) / c.grow) : 1;
        const val = (c.type === 'fast' ? cycles * (c.base * 0.85 - c.seed) : h * c.base * 0.85 - c.seed);
        if (val > 0) ranked.push([c.id, val]);
      }
      if (!ranked.length) return null;
      ranked.sort((a, b) => b[1] - a[1]);
      st._rot = ((st._rot || 0) + 1) % 10;
      const slot = st._rot < 5 ? 0 : st._rot < 8 ? 1 : 2;
      return ranked[Math.min(slot, ranked.length - 1)][0];
    }
    default: return null;
  }
}

function tilesFreeTomorrow(s, area) {
  const tiles = E.areaTiles(s, area);
  let n = 0;
  for (const i of E.activeIndices(s, area)) {
    const t = tiles[i];
    if (t.s) continue;
    if (!t.c) { n++; continue; }
    const c = E.CROP[t.c];
    if (!c.regrow && (t.g >= c.grow || (t.w && t.g + 1 >= c.grow))) n++;
  }
  return n;
}

function manualCapacity(s) {
  // 스프링클러가 덮지 않는 칸 수 한도 (체력 기준)
  const areas = E.hasGreenhouse(s) ? ['farm', 'gh'] : ['farm'];
  let covered = 0;
  let total = 0;
  for (const area of areas) {
    const tiles = E.areaTiles(s, area);
    const cov = new Set();
    for (const i of E.activeIndices(s, area)) {
      if (tiles[i].s) E.neighbors(s, area, i).forEach((x) => cov.add(x));
    }
    for (const i of E.activeIndices(s, area)) {
      if (tiles[i].s) continue;
      total++;
      if (cov.has(i)) covered++;
    }
  }
  const manualMax = Math.floor(92 / (E.waterCost(s) + 0.8));
  return { total, covered, limit: covered + manualMax };
}

function occupied(s) {
  const areas = E.hasGreenhouse(s) ? ['farm', 'gh'] : ['farm'];
  let n = 0;
  for (const area of areas) {
    const tiles = E.areaTiles(s, area);
    for (const i of E.activeIndices(s, area)) if (tiles[i].c) n++;
  }
  return n;
}

function nightDay(s, st) {
  const day = s.day + 1;
  const cap = manualCapacity(s);
  let budget = Math.max(0, cap.limit - occupied(s) + 3);
  const areas = E.hasGreenhouse(s) ? ['gh', 'farm'] : ['farm'];
  for (const area of areas) {
    const free = Math.min(tilesFreeTomorrow(s, area), budget);
    if (!free) continue;
    budget -= free;
    // 섞어 심는 전략이면 칸마다 따로 고른다
    const want = {};
    for (let k = 0; k < free; k++) {
      const id = seedChoice(s, st, day, area);
      if (id) want[id] = (want[id] || 0) + 1;
    }
    for (const id of Object.keys(want)) {
      const need = want[id] - (s.seeds[id] || 0);
      const afford = Math.floor(s.money / E.CROP[id].seed);
      const qty = Math.min(need, afford);
      if (qty > 0) E.buySeeds(s, id, qty);
    }
  }

  const reserve = st.reserve;
  const lastCall = day > B.deadline - st.stopInvest;
  while (!lastCall && st.plan.length > (st._p || 0)) {
    const item = st.plan[st._p || 0];
    const cost = item === 'spr' ? B.sprinklerCost : (E.upgradeInfo(s, item).next || { cost: 0 }).cost;
    if (!cost) { st._p = (st._p || 0) + 1; continue; }
    if (s.money - cost < reserve) break;
    if (item === 'spr') E.buySprinkler(s, 1); else E.buyUpgrade(s, item);
    st._p = (st._p || 0) + 1;
  }
  if (st.process) {
    for (let i = 0; i < E.machineCount(s); i++) {
      if (s.machines[i]) continue;
      const pool = Object.keys(s.stock).filter((id) => E.CROP[id] && s.stock[id] >= st.process);
      if (!pool.length) break;
      pool.sort((a, b) => s.stock[b] - s.stock[a]);
      E.loadMachine(s, i, pool[0], Math.min(B.procBatch, s.stock[pool[0]]));
    }
  }
  const planDone = (st._p || 0) >= st.plan.length;
  if (s.debt > 0 && (planDone || lastCall || st.repayAlways)) {
    const r = s.day >= B.deadline ? 0 : reserve;
    if (s.money - r > 0) E.repay(s, s.money - r);
  }
}

// ---------- 실행 ----------
function play(seed, proto, diag) {
  const st = Object.assign({}, proto, { plan: proto.plan.slice(), _p: 0, _rot: 0 });
  const s = E.newGame(seed, DIFF);
  while (!s.over && !s.paidOffDay && s.day <= B.deadline) {
    farmDay(s, st);
    stockShelf(s, st);
    const res = E.openShop(s);
    if (diag) {
      const d = (diag[s.day] = diag[s.day] || { n: 0, shown: 0, sold: 0, cust: 0, pricey: 0, rev: 0, pct: 0, pctN: 0, stock: 0, energy: 0, net: 0 });
      d.n++;
      d.shown += res.slots.reduce((a, x) => a + x.qty, 0);
      d.sold += res.sold;
      d.cust += res.customers.length;
      d.pricey += res.pricey;
      d.rev += res.revenue;
      res.slots.forEach((x) => { d.pct += x.pct; d.pctN++; });
      d.stock += Object.values(s.stock).reduce((a, b) => a + b, 0);
      d.energy += s.energy;
      d.net += s.money - s.debt;
    }
    nightDay(s, st);
    E.sleep(s);
  }
  return { paidOffDay: s.paidOffDay, debt: s.debt, revenue: s.stats.revenue, up: s.up };
}

const FULL = ['field', 'shelf', 'sign', 'can', 'spr', 'spr', 'field', 'sign', 'spr', 'spr', 'shelf', 'field', 'can', 'spr', 'spr'];
const BASIC = ['field', 'shelf', 'sign', 'can', 'spr', 'spr'];
const GH = ['field', 'shelf', 'sign', 'can', 'spr', 'spr', 'field', 'greenhouse', 'sign', 'spr', 'spr', 'shelf'];

const NORMAL = { plant: 'mix', price: 'smart', plan: BASIC, reserve: 200, stopInvest: 8, holdValue: 0.6 };
const STRATS = [
  { name: '초보: 상추만·기준가·업그레이드 없음', plant: 'fast', price: 100, plan: [], repayAlways: true, reserve: 150, stopInvest: 0, holdValue: 0.6 },
  { ...NORMAL, name: '보통: 섞어 심기·기준가·기본 업그레이드', price: 100 },
  { ...NORMAL, name: '보통+: 섞어 심기·가격 조절·기본 업그레이드' },
  { name: '능숙: 가치 계산·가격 조절·많은 업그레이드', plant: 'value', price: 'smart', plan: FULL, reserve: 300, stopInvest: 18, holdValue: 0.6 },
  { name: '능숙+온실', plant: 'value', price: 'smart', plan: GH, reserve: 300, stopInvest: 12, holdValue: 0.6 },
  { ...NORMAL, name: '보통+ 가공 공방(항아리 2)', plan: ['field', 'shelf', 'workshop', 'sign', 'can', 'spr', 'spr'], process: 4 },
  { ...NORMAL, name: '보통+ 가공 공방(항아리 4)', plan: ['field', 'shelf', 'workshop', 'sign', 'workshop', 'can', 'spr', 'spr'], process: 4 },
  { name: '능숙+가공', plant: 'value', price: 'smart', plan: ['field', 'shelf', 'workshop', 'sign', 'can', 'spr', 'spr', 'field', 'workshop', 'sign', 'spr', 'spr', 'shelf'], reserve: 300, stopInvest: 18, holdValue: 0.6, process: 4 },
  { ...NORMAL, name: '빠른 작물만', plant: 'fast' },
  { ...NORMAL, name: '느린 작물 위주', plant: 'slow' },
  { ...NORMAL, name: '재수확 작물 위주', plant: 'regrow' },
  { ...NORMAL, name: '가격 항상 80%', price: 80 },
  { ...NORMAL, name: '가격 항상 90%', price: 90 },
  { ...NORMAL, name: '가격 항상 110%', price: 110 },
  { ...NORMAL, name: '가격 항상 120%', price: 120 },
  { ...NORMAL, name: '가격 항상 130%', price: 130 },
  { ...NORMAL, name: '가격 항상 150%', price: 150 },
];

function pct(arr, p) {
  if (!arr.length) return '-';
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

const traceIdx = process.argv.indexOf('--trace');
if (traceIdx > 0) {
  // node tools/balance.js 1 --trace 3  → 전략 3번 한 판을 하루씩 출력
  const proto = STRATS[Number(process.argv[traceIdx + 1]) || 0];
  const st = Object.assign({}, proto, { plan: proto.plan.slice(), _p: 0, _rot: 0 });
  const s = E.newGame(4242, DIFF);
  const em = (o) => Object.keys(o).filter((k) => o[k] > 0).map((k) => (E.ITEM[k] || E.CROP[k]).emoji + o[k]).join(' ');
  while (!s.over && !s.paidOffDay && s.day <= B.deadline) {
    farmDay(s, st);
    const planted = {};
    for (const area of ['farm', 'gh']) {
      for (const i of E.activeIndices(s, area)) { const t = E.areaTiles(s, area)[i]; if (t.c) planted[t.c] = (planted[t.c] || 0) + 1; }
    }
    stockShelf(s, st);
    const res = E.openShop(s);
    const up = Object.keys(s.up).filter((k) => s.up[k]).map((k) => k + s.up[k]).join(',');
    console.log(`D${s.day} ${s.weather.padEnd(6)} 체력${String(s.energy).padStart(3)} 밭[${em(planted)}] 판매${res.sold}/${res.slots.reduce((a, x) => a + x.qty, 0)} 손님${res.customers.length}(없음${res.empty},비쌈${res.pricey}) +${res.revenue}G 인기${E.CROP[s.popular].emoji}`);
    nightDay(s, st);
    console.log(`    돈${s.money} 빚${s.debt} 재고[${em(s.stock)}] 씨앗[${em(s.seeds)}] 업[${up}] 스프${s.sprinklers}`);
    E.sleep(s);
  }
  process.exit(0);
}

const diagIdx = process.argv.indexOf('--diag');
if (diagIdx > 0) {
  // node tools/balance.js 100 --diag 2  → 전략 2번의 하루 평균 지표
  const proto = STRATS[Number(process.argv[diagIdx + 1]) || 0];
  const diag = {};
  for (let k = 0; k < RUNS; k++) play(1000 + k * 7919, Object.assign({}, proto, { repayAlways: false, plan: proto.plan }), diag);
  console.log(proto.name);
  console.log('일  표본  진열  판매  손님  비싸서  매출  평균가%  남은재고  남은체력  순자산');
  for (const day of Object.keys(diag).map(Number).sort((a, b) => a - b)) {
    const d = diag[day];
    const f = (v) => String(Math.round(v / d.n)).padStart(6);
    console.log(String(day).padStart(2) + String(d.n).padStart(6) + f(d.shown) + f(d.sold) + f(d.cust) + f(d.pricey) + f(d.rev)
      + String(d.pctN ? Math.round(d.pct / d.pctN) : '-').padStart(8) + f(d.stock) + f(d.energy) + f(d.net));
  }
  process.exit(0);
}

console.log(`난이도: ${D.DIFFICULTIES[DIFF].name}  판 수: ${RUNS}  (빚 ${B.startDebt}G, 기한 ${B.deadline}일)\n`);
console.log('전략'.padEnd(34) + '성공률  25%  중앙  75%   평균매출  실패 시 남은 빚');
for (const proto of STRATS) {
  const days = [];
  const leftover = [];
  let rev = 0;
  for (let k = 0; k < RUNS; k++) {
    const r = play(1000 + k * 7919, proto);
    rev += r.revenue;
    if (r.paidOffDay) days.push(r.paidOffDay); else leftover.push(r.debt);
  }
  const rate = ((days.length / RUNS) * 100).toFixed(0).padStart(4) + '%';
  const avgLeft = leftover.length ? Math.round(leftover.reduce((a, b) => a + b, 0) / leftover.length) : '-';
  console.log(
    proto.name.padEnd(34 - (proto.name.length - proto.name.replace(/[^\x00-\x7f]/g, '').length) / 1)
    + rate + String(pct(days, 0.25)).padStart(5) + String(pct(days, 0.5)).padStart(6) + String(pct(days, 0.75)).padStart(5)
    + String(Math.round(rev / RUNS)).padStart(10) + String(avgLeft).padStart(10),
  );
}
