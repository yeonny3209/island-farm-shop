/* 작은 섬 농장 가게 — 게임 규칙
 * 화면과 분리된 순수 로직이다. 브라우저에서는 전역 Engine, Node 에서는 module.exports 로 쓴다.
 * 모든 난수는 상태(s.rng)에 저장된 시드에서 나오므로 같은 상태·같은 선택이면 결과도 같다. */
const Engine = ((D) => {
  'use strict';

  const B = D.BALANCE;
  const CROP = {};
  D.CROPS.forEach((c) => { CROP[c.id] = c; });
  const UP = {};
  D.UPGRADES.forEach((u) => { UP[u.id] = u; });

  const FARM_W = 8; // 밭은 항상 8×8 배열로 저장하고, 확장 단계만큼만 쓴다
  const GH_W = B.greenhouseSize;
  const YEAR = B.seasonLength * 4;
  const SAVE_VERSION = 1;

  // ---------- 난수 (mulberry32) ----------
  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
  function weighted(s, entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let x = rand(s) * total;
    for (const e of entries) {
      x -= e[1];
      if (x < 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }

  // ---------- 한국어 조사 ----------
  function josa(word, pair) {
    const code = word.charCodeAt(word.length - 1);
    const hasFinal = code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 !== 0;
    return word + (hasFinal ? pair[0] : pair[1]);
  }

  // ---------- 달력 ----------
  const seasonOf = (day) => Math.floor(((day - 1) % YEAR) / B.seasonLength);
  const dayInSeason = (day) => ((day - 1) % B.seasonLength) + 1;
  const yearOf = (day) => Math.floor((day - 1) / YEAR) + 1;

  // ---------- 업그레이드 효과 ----------
  function upValue(s, id, base) {
    const lv = s.up[id] || 0;
    return lv ? UP[id].levels[lv - 1].value : base;
  }
  const fieldSize = (s) => upValue(s, 'field', B.fieldStart);
  const waterCost = (s) => upValue(s, 'can', B.waterCost);
  const shelfSlots = (s) => upValue(s, 'shelf', B.shelfStart);
  const signBonus = (s) => upValue(s, 'sign', 0);
  const hasGreenhouse = (s) => (s.up.greenhouse || 0) > 0;

  // ---------- 밭 ----------
  const emptyTile = () => ({ c: null, g: 0, w: false, s: false });
  const areaTiles = (s, area) => (area === 'gh' ? s.gh : s.farm);
  const areaWidth = (area) => (area === 'gh' ? GH_W : FARM_W);
  const isReady = (t) => !!t.c && t.g >= CROP[t.c].grow;
  const isGrowing = (t) => !!t.c && t.g < CROP[t.c].grow;

  function isActive(s, area, idx) {
    if (area === 'gh') return hasGreenhouse(s) && idx >= 0 && idx < GH_W * GH_W;
    const n = fieldSize(s);
    return idx >= 0 && idx < FARM_W * FARM_W && Math.floor(idx / FARM_W) < n && idx % FARM_W < n;
  }

  function activeIndices(s, area) {
    const out = [];
    const W = areaWidth(area);
    for (let i = 0; i < W * W; i++) if (isActive(s, area, i)) out.push(i);
    return out;
  }

  function neighbors(s, area, idx) {
    const W = areaWidth(area);
    const r = Math.floor(idx / W);
    const c = idx % W;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= W || cc >= W) continue;
        const ni = rr * W + cc;
        if (isActive(s, area, ni)) out.push(ni);
      }
    }
    return out;
  }

  // 야외 밭에 day 에 심었을 때 이번 계절 안에 몇 번 수확할 수 있는지
  function harvestsIfPlanted(cropId, day) {
    const crop = CROP[cropId];
    const season = seasonOf(day);
    if (season === 3 || crop.season !== season) return 0;
    const firstReady = dayInSeason(day) + crop.grow;
    if (firstReady > B.seasonLength) return 0;
    if (!crop.regrow) return 1;
    return 1 + Math.floor((B.seasonLength - firstReady) / crop.regrow);
  }

  function plantCheck(s, area, cropId) {
    const crop = CROP[cropId];
    if (area === 'gh') return { ok: true };
    const season = seasonOf(s.day);
    if (season === 3) return fail('겨울에는 야외 밭이 얼어 있어요. 온실에서만 키울 수 있어요.');
    if (crop.season !== season) {
      return fail(`${josa(crop.name, '은는')} ${D.SEASONS[crop.season].name} 작물이에요. 야외 밭에는 제철 작물만 심을 수 있어요.`);
    }
    if (harvestsIfPlanted(cropId, s.day) === 0) {
      return { ok: true, warn: `${josa(crop.name, '은는')} 계절이 끝나기 전에 다 자라지 못해요.` };
    }
    return { ok: true };
  }

  function fail(msg, quiet) { return { ok: false, msg, quiet: !!quiet }; }
  const noEnergy = () => fail('체력이 부족해요. 오늘은 여기까지!');

  // tool: plant | water | harvest | sprinkler | remove
  function act(s, tool, area, idx, seedId) {
    if (s.phase !== 'day' || s.over) return fail('지금은 밭일을 할 수 없어요.');
    if (area === 'gh' && !hasGreenhouse(s)) return fail('아직 온실이 없어요.');
    if (!isActive(s, area, idx)) return fail('아직 개간하지 않은 땅이에요. 밤에 밭을 넓힐 수 있어요.', true);
    const t = areaTiles(s, area)[idx];

    if (tool === 'plant') {
      if (t.s) return fail('스프링클러가 있는 칸이에요.', true);
      if (t.c) return fail('이미 작물이 자라고 있어요.', true);
      if (!seedId) return fail('심을 씨앗을 먼저 골라 주세요.');
      const crop = CROP[seedId];
      if (!(s.seeds[seedId] > 0)) return fail(`${crop.name} 씨앗이 없어요. 밤에 씨앗 가게에서 살 수 있어요.`);
      const chk = plantCheck(s, area, seedId);
      if (!chk.ok) return chk;
      if (s.energy < B.plantCost) return noEnergy();
      s.energy -= B.plantCost;
      s.seeds[seedId]--;
      t.c = seedId;
      t.g = 0;
      return { ok: true, spent: B.plantCost, warn: chk.warn };
    }

    if (tool === 'water') {
      if (!t.c) return fail('물은 작물이 심긴 칸에 줘요.', true);
      if (isReady(t)) return fail('다 자랐어요. 수확해 주세요!', true);
      if (t.w) return fail('이미 물을 줬어요.', true);
      const cost = waterCost(s);
      if (s.energy < cost) return noEnergy();
      s.energy -= cost;
      t.w = true;
      return { ok: true, spent: cost };
    }

    if (tool === 'harvest') {
      if (!t.c) return fail('수확할 작물이 없어요.', true);
      const crop = CROP[t.c];
      if (!isReady(t)) return fail(`${josa(crop.name, '은는')} 아직 자라는 중이에요. (${t.g}/${crop.grow}일)`, true);
      if (s.energy < B.harvestCost) return noEnergy();
      s.energy -= B.harvestCost;
      s.stock[t.c] = (s.stock[t.c] || 0) + 1;
      s.stats.harvested++;
      const id = t.c;
      if (crop.regrow) t.g = crop.grow - crop.regrow;
      else { t.c = null; t.g = 0; }
      return { ok: true, spent: B.harvestCost, harvested: id };
    }

    if (tool === 'sprinkler') {
      if (t.s) {
        t.s = false;
        s.sprinklers++;
        return { ok: true, msg: '스프링클러를 회수했어요.' };
      }
      if (t.c) return fail('작물이 있는 칸에는 설치할 수 없어요.', true);
      if (!(s.sprinklers > 0)) return fail('가진 스프링클러가 없어요. 밤에 업그레이드에서 살 수 있어요.');
      s.sprinklers--;
      t.s = true;
      return { ok: true, msg: '설치했어요. 내일 아침부터 주변 8칸에 물을 뿌려요.' };
    }

    if (tool === 'remove') {
      if (t.s) {
        t.s = false;
        s.sprinklers++;
        return { ok: true, msg: '스프링클러를 회수했어요.' };
      }
      if (!t.c) return fail('뽑을 작물이 없어요.', true);
      t.c = null;
      t.g = 0;
      return { ok: true, msg: '작물을 뽑았어요.' };
    }
    return fail('알 수 없는 도구예요.');
  }

  function farmSummary(s) {
    let thirsty = 0;
    let ready = 0;
    let growing = 0;
    for (const area of ['farm', 'gh']) {
      if (area === 'gh' && !hasGreenhouse(s)) continue;
      const tiles = areaTiles(s, area);
      for (const i of activeIndices(s, area)) {
        const t = tiles[i];
        if (isReady(t)) ready++;
        else if (isGrowing(t)) {
          growing++;
          if (!t.w) thirsty++;
        }
      }
    }
    return { thirsty, ready, growing };
  }

  // ---------- 가게 ----------
  // r = 판매가 / 기준가. 기준가 80%, 1.5배 30%
  function buyChance(r) {
    if (r <= 1) return Math.min(0.97, 0.8 + (1 - r) * 0.4);
    return Math.max(0.03, 0.8 * Math.exp(-1.96 * (r - 1)));
  }
  const clampPct = (pct) => {
    const stepped = Math.round(pct / B.priceStep) * B.priceStep;
    return Math.min(B.priceMax, Math.max(B.priceMin, stepped));
  };
  const priceOf = (id, pct) => Math.max(1, Math.round((CROP[id].base * pct) / 100));
  function effectiveRatio(s, id, pct) {
    const r = pct / 100;
    return id === s.popular ? r / B.popularTolerance : r;
  }
  const chanceFor = (s, id, pct) => buyChance(effectiveRatio(s, id, pct));

  const repMult = (s) => 1 + (s.rep - 50) * B.repEffect;
  const baseTraffic = (s) => (B.baseCustomers + signBonus(s)) * D.WEATHER[s.weather].customers * repMult(s);

  function customerForecast(s) {
    const w = D.WEATHER[s.weather];
    if (w.closed) return { min: 0, max: 0, closed: true };
    const avg = baseTraffic(s);
    return {
      min: Math.round(avg * (1 - B.customerJitter)),
      max: Math.round(avg * (1 + B.customerJitter)),
      avg,
      closed: false,
    };
  }

  // 손님이 이 작물을 찾을 가중치
  function wantWeight(s, crop, shown) {
    const season = seasonOf(s.day);
    let w;
    if (crop.season === season) w = shown ? B.wantShown[season] : B.wantUnshown[season];
    else w = shown ? B.wantOther[season] : 0;
    if (crop.id === s.popular) w += B.wantPopular;
    return w;
  }

  function syncShelf(s) {
    const n = shelfSlots(s);
    while (s.shelf.length < n) s.shelf.push(null);
  }

  function setShelf(s, slot, cropId) {
    if (s.phase !== 'day') return fail('진열은 영업 전에만 바꿀 수 있어요.');
    if (slot < 0 || slot >= shelfSlots(s)) return fail('없는 진열칸이에요.');
    if (!(s.stock[cropId] > 0)) return fail('창고에 없는 작물이에요.');
    const prev = s.shelf.findIndex((x) => x && x.id === cropId);
    if (prev === slot) return { ok: true };
    if (prev >= 0) {
      // 이미 다른 칸에 있으면 두 칸을 맞바꾼다
      s.shelf[prev] = s.shelf[slot];
    }
    s.shelf[slot] = { id: cropId, pct: s.lastPct[cropId] || 100 };
    return { ok: true };
  }

  function setShelfPrice(s, slot, pct) {
    const sl = s.shelf[slot];
    if (!sl || s.phase !== 'day') return fail('가격을 바꿀 수 없어요.');
    sl.pct = clampPct(pct);
    s.lastPct[sl.id] = sl.pct;
    return { ok: true };
  }

  function clearShelf(s, slot) {
    if (s.phase !== 'day') return fail('진열은 영업 전에만 바꿀 수 있어요.');
    s.shelf[slot] = null;
    return { ok: true };
  }

  const displayQty = (s, id) => Math.min(s.stock[id] || 0, B.shelfCap);

  function openShop(s) {
    if (s.phase !== 'day' || s.over) return null;
    const w = D.WEATHER[s.weather];
    const res = {
      day: s.day, weather: s.weather, closed: !!w.closed, popular: s.popular,
      slots: [], customers: [], lines: [], missing: {}, revenue: 0, sold: 0, buyers: 0, pricey: 0, empty: 0,
    };

    if (!w.closed) {
      const n = Math.max(0, Math.round(baseTraffic(s) * (1 + (rand(s) * 2 - 1) * B.customerJitter)));
      let rep = 0;
      const slots = [];
      s.shelf.forEach((sl, i) => {
        if (!sl || !(s.stock[sl.id] > 0)) return;
        slots.push({ i, id: sl.id, pct: sl.pct, price: priceOf(sl.id, sl.pct), qty: displayQty(s, sl.id), left: displayQty(s, sl.id) });
      });
      res.slots = slots.map((x) => ({ i: x.i, id: x.id, price: x.price, pct: x.pct, qty: x.qty }));
      const lines = {};
      slots.forEach((x) => { lines[x.id] = { id: x.id, qty: 0, price: x.price, total: 0, rejected: 0 }; });
      res.missing = {}; // 찾는 작물이 없어서 그냥 간 손님 (작물별)

      // 손님은 저마다 사고 싶은 작물이 있다: 제철 작물과 인기 작물을 많이 찾고, 진열된 다른 작물도 가끔 찾는다
      const wants = D.CROPS.map((c) => [c.id, wantWeight(s, c, slots.some((x) => x.id === c.id))]).filter((e) => e[1] > 0);

      const tryBuy = (cust, sl, impulse) => {
        const r = effectiveRatio(s, sl.id, sl.pct);
        const p = buyChance(r) * (impulse ? B.impulseFactor : 1);
        if (rand(s) < p) {
          let q = 1 + (rand(s) < 0.45 ? 1 : 0) + (rand(s) < 0.15 ? 1 : 0);
          if (r < 1 && rand(s) < (1 - r) * 2) q++; // 싸면 더 많이 산다
          q = Math.min(q, sl.left);
          sl.left -= q;
          lines[sl.id].qty += q;
          lines[sl.id].total += q * sl.price;
          const mood = r <= 1.05 ? 'happy' : r <= 1.25 ? 'ok' : 'meh';
          rep += mood === 'happy' ? B.repFair : mood === 'ok' ? B.repOk : 0;
          cust.visits.push({ slot: sl.i, id: sl.id, qty: q, pay: q * sl.price, mood });
          return true;
        }
        lines[sl.id].rejected++;
        cust.visits.push({ slot: sl.i, id: sl.id, qty: 0, pay: 0 });
        return false;
      };
      const other = (cust) => {
        const seen = cust.visits.map((v) => v.slot);
        const pool = slots.filter((x) => x.left > 0 && !seen.includes(x.i));
        return pool.length ? pick(s, pool) : null;
      };

      for (let k = 0; k < n; k++) {
        const want = weighted(s, wants);
        const cust = { face: pick(s, D.FACES), want, visits: [], outcome: 'missing' };
        let sl = slots.find((x) => x.id === want && x.left > 0);
        let bought = false;
        if (sl) {
          bought = tryBuy(cust, sl, false);
          if (!bought && rand(s) < B.browseChance && (sl = other(cust))) bought = tryBuy(cust, sl, true);
        } else if (rand(s) < B.browseChance && (sl = other(cust))) {
          bought = tryBuy(cust, sl, true);
        }
        if (bought && rand(s) < B.addOnChance && (sl = other(cust))) tryBuy(cust, sl, true);

        if (bought) { cust.outcome = 'buy'; res.buyers++; }
        else if (cust.visits.length) { cust.outcome = 'pricey'; res.pricey++; rep += B.repPricey; }
        else { res.empty++; res.missing[want] = (res.missing[want] || 0) + 1; rep += B.repMissing; }
        res.customers.push(cust);
      }
      res.repBefore = s.rep;
      s.rep = Math.max(0, Math.min(100, s.rep + rep));
      res.repDelta = Math.round((s.rep - res.repBefore) * 10) / 10;

      res.lines = slots.map((x) => lines[x.id]);
      for (const ln of res.lines) {
        s.stock[ln.id] -= ln.qty;
        res.revenue += ln.total;
        res.sold += ln.qty;
      }
      s.money += res.revenue;
      s.stats.revenue += res.revenue;
      s.stats.sold += res.sold;
      s.stats.customers += res.customers.length;
      s.stats.bestDay = Math.max(s.stats.bestDay, res.revenue);
    }

    s.today = res;
    s.phase = 'night';
    return res;
  }

  // ---------- 밤: 상점, 업그레이드, 빚 ----------
  function seedShopList(s, all) {
    const day = s.phase === 'night' ? s.day + 1 : s.day;
    const season = seasonOf(day);
    return D.CROPS.filter((c) => all || c.season === season);
  }

  function buySeeds(s, id, qty) {
    if (s.phase !== 'night') return fail('씨앗은 밤에 살 수 있어요.');
    qty = Math.floor(qty);
    if (!(qty > 0)) return fail('수량을 골라 주세요.');
    const cost = CROP[id].seed * qty;
    if (s.money < cost) return fail('돈이 부족해요.');
    s.money -= cost;
    s.seeds[id] = (s.seeds[id] || 0) + qty;
    return { ok: true, cost };
  }

  function upgradeInfo(s, id) {
    const def = UP[id];
    const lv = s.up[id] || 0;
    const next = def.levels[lv] || null;
    return { def, lv, max: def.levels.length, next };
  }

  function buyUpgrade(s, id) {
    if (s.phase !== 'night') return fail('업그레이드는 밤에 살 수 있어요.');
    const info = upgradeInfo(s, id);
    if (!info.next) return fail('이미 최고 단계예요.');
    if (s.money < info.next.cost) return fail('돈이 부족해요.');
    s.money -= info.next.cost;
    s.up[id] = info.lv + 1;
    if (id === 'shelf') syncShelf(s);
    return { ok: true, cost: info.next.cost };
  }

  function buySprinkler(s, qty) {
    if (s.phase !== 'night') return fail('스프링클러는 밤에 살 수 있어요.');
    qty = qty || 1;
    const cost = B.sprinklerCost * qty;
    if (s.money < cost) return fail('돈이 부족해요.');
    s.money -= cost;
    s.sprinklers += qty;
    return { ok: true, cost };
  }

  function repay(s, amount) {
    if (s.debt <= 0) return fail('갚을 빚이 없어요.');
    const amt = Math.floor(Math.min(amount, s.money, s.debt));
    if (!(amt > 0)) return fail('갚을 돈이 없어요.');
    s.money -= amt;
    s.debt -= amt;
    s.stats.repaid += amt;
    let paidOff = false;
    if (s.debt === 0 && !s.paidOffDay) {
      s.paidOffDay = s.day;
      paidOff = true;
    }
    return { ok: true, amount: amt, paidOff };
  }

  // ---------- 하루 넘기기 ----------
  function rollWeather(s, day) {
    if (day === 1 || day === 2) return 'sunny';
    return weighted(s, D.WEATHER_TABLE[seasonOf(day)]);
  }

  function rollPopular(s) {
    const season = seasonOf(s.day);
    const entries = D.CROPS.filter((c) => c.season === season).map((c) => [c.id, 2]);
    for (const c of D.CROPS) {
      if (c.season !== season && s.stock[c.id] > 0) entries.push([c.id, 1]);
    }
    return weighted(s, entries);
  }

  function applySprinklers(s) {
    let count = 0;
    for (const area of ['farm', 'gh']) {
      if (area === 'gh' && !hasGreenhouse(s)) continue;
      const tiles = areaTiles(s, area);
      for (const i of activeIndices(s, area)) {
        if (!tiles[i].s) continue;
        count++;
        for (const ni of neighbors(s, area, i)) tiles[ni].w = true;
      }
    }
    return count;
  }

  function sleep(s) {
    if (s.phase !== 'night' || s.over) return null;
    if (s.debt > 0 && s.day >= B.deadline && !s.paidOffDay) {
      s.over = 'fail';
      return { over: 'fail' };
    }
    s.history.push({ day: s.day, revenue: s.today ? s.today.revenue : 0, debt: s.debt, money: s.money });

    for (const t of s.farm.concat(s.gh)) {
      if (t.c && t.w && t.g < CROP[t.c].grow) t.g++;
    }
    const prevSeason = seasonOf(s.day);
    s.day++;
    const season = seasonOf(s.day);
    const ev = { seasonChanged: season !== prevSeason, withered: 0, rained: false, sprinklers: 0 };
    if (ev.seasonChanged) {
      for (const t of s.farm) {
        if (t.c && CROP[t.c].season !== season) {
          t.c = null;
          t.g = 0;
          ev.withered++;
        }
      }
    }
    for (const t of s.farm.concat(s.gh)) t.w = false;

    s.rep += (B.repStart - s.rep) * B.repDecay;
    s.weather = s.forecast;
    s.forecast = rollWeather(s, s.day + 1);
    if (D.WEATHER[s.weather].waters) {
      for (const i of activeIndices(s, 'farm')) s.farm[i].w = true;
      ev.rained = true;
    }
    ev.sprinklers = applySprinklers(s);
    s.energy = B.maxEnergy;
    s.popular = rollPopular(s);
    s.phase = 'day';
    s.today = null;
    s.morning = buildMorning(s, ev);
    return s.morning;
  }

  function buildMorning(s, ev) {
    const season = seasonOf(s.day);
    const W = D.WEATHER[s.weather];
    const events = [];
    if (ev.first) {
      events.push({ icon: '🏝️', text: '섬에서 맞는 첫 아침이에요. 창고에 상추 몇 개와 씨앗이 남아 있어요.' });
    }
    if (ev.seasonChanged) {
      const sz = D.SEASONS[season];
      events.push({ icon: sz.emoji, text: `${josa(sz.name, '이가')} 시작됐어요.` + (ev.withered ? ` 지난 계절 작물 ${ev.withered}개가 시들었어요.` : '') });
      if (season === 3) {
        events.push({ icon: '🧊', text: hasGreenhouse(s) ? '야외 밭은 얼었지만 온실은 따뜻해요.' : '야외 밭이 얼었어요. 창고에 모아 둔 작물로 장사해야 해요.' });
      }
    }
    if (ev.rained) events.push({ icon: '💧', text: '비 덕분에 야외 밭 전체가 젖었어요.' });
    if (ev.sprinklers) events.push({ icon: '⛲', text: `스프링클러 ${ev.sprinklers}개가 물을 뿌렸어요.` });
    const sum = farmSummary(s);
    if (sum.ready) events.push({ icon: '🧺', text: `다 자란 작물이 ${sum.ready}칸 있어요.` });
    if (W.closed) events.push({ icon: '🔒', text: `${W.name} 때문에 오늘은 가게 문을 열 수 없어요.` });
    const left = B.deadline - s.day;
    if (s.debt > 0 && left >= 0 && left <= 5) {
      events.push({ icon: '⏳', text: left === 0 ? '오늘이 빚을 갚을 마지막 날이에요!' : `빚 마감까지 ${left}일 남았어요.` });
    }
    return { day: s.day, weather: s.weather, forecast: s.forecast, popular: s.popular, events };
  }

  function newGame(seed) {
    seed = (seed >>> 0) || 1;
    const s = {
      v: SAVE_VERSION,
      seed,
      rng: seed,
      day: 1,
      phase: 'day',
      money: B.startMoney,
      debt: B.startDebt,
      energy: B.maxEnergy,
      rep: B.repStart,
      weather: 'sunny',
      forecast: 'sunny',
      popular: null,
      farm: Array.from({ length: FARM_W * FARM_W }, emptyTile),
      gh: Array.from({ length: GH_W * GH_W }, emptyTile),
      seeds: Object.assign({}, B.startSeeds),
      stock: Object.assign({}, B.startStock),
      sprinklers: 0,
      shelf: [],
      lastPct: {},
      up: { field: 0, can: 0, shelf: 0, sign: 0, greenhouse: 0 },
      today: null,
      morning: null,
      paidOffDay: null,
      over: null,
      stats: { revenue: 0, sold: 0, customers: 0, bestDay: 0, harvested: 0, repaid: 0 },
      history: [],
    };
    syncShelf(s);
    s.popular = rollPopular(s);
    s.morning = buildMorning(s, { first: true });
    return s;
  }

  function isValidSave(s) {
    return !!s && s.v === SAVE_VERSION && Array.isArray(s.farm) && s.farm.length === FARM_W * FARM_W
      && Array.isArray(s.gh) && typeof s.day === 'number' && typeof s.money === 'number';
  }

  return {
    CROP, UP, FARM_W, GH_W, B, repMult,
    rand, josa,
    seasonOf, dayInSeason, yearOf,
    fieldSize, waterCost, shelfSlots, signBonus, hasGreenhouse,
    areaTiles, areaWidth, isActive, activeIndices, isReady, isGrowing, neighbors,
    harvestsIfPlanted, plantCheck, act, farmSummary,
    buyChance, clampPct, priceOf, chanceFor, customerForecast, displayQty, wantWeight,
    setShelf, setShelfPrice, clearShelf, openShop,
    seedShopList, buySeeds, upgradeInfo, buyUpgrade, buySprinkler, repay,
    sleep, newGame, isValidSave,
  };
})(typeof GameData !== 'undefined' ? GameData : require('./data.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
