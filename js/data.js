/* 작은 섬 농장 가게 — 수치표
 * 밸런스를 바꿀 때는 이 파일만 고치고 `node tools/balance.js` 로 결과를 확인한다. */
const GameData = (() => {
  'use strict';

  const SEASONS = [
    { id: 'spring', name: '봄', emoji: '🌸' },
    { id: 'summer', name: '여름', emoji: '🌻' },
    { id: 'fall', name: '가을', emoji: '🍁' },
    { id: 'winter', name: '겨울', emoji: '❄️' },
  ];

  const TYPES = {
    fast: { name: '빠른 작물', short: '빠름' },
    slow: { name: '느린 작물', short: '느림' },
    regrow: { name: '재수확 작물', short: '재수확' },
  };

  // seed: 씨앗값, grow: 첫 수확까지 일수, regrow: 재수확 간격, base: 기준가, proc: 가공하면 무엇이 되는지
  const CROPS = [
    { id: 'lettuce', name: '상추', emoji: '🥬', season: 0, type: 'fast', seed: 10, grow: 3, base: 34, proc: 'pickle' },
    { id: 'broccoli', name: '브로콜리', emoji: '🥦', season: 0, type: 'slow', seed: 50, grow: 7, base: 150, proc: 'pickle' },
    { id: 'strawberry', name: '딸기', emoji: '🍓', season: 0, type: 'regrow', seed: 55, grow: 5, regrow: 2, base: 55, proc: 'jam' },

    { id: 'cucumber', name: '오이', emoji: '🥒', season: 1, type: 'fast', seed: 15, grow: 3, base: 46, proc: 'pickle' },
    { id: 'watermelon', name: '수박', emoji: '🍉', season: 1, type: 'slow', seed: 100, grow: 8, base: 270, proc: 'jam' },
    { id: 'tomato', name: '토마토', emoji: '🍅', season: 1, type: 'regrow', seed: 80, grow: 5, regrow: 2, base: 75, proc: 'jam' },

    { id: 'carrot', name: '당근', emoji: '🥕', season: 2, type: 'fast', seed: 20, grow: 4, base: 74, proc: 'pickle' },
    { id: 'pumpkin', name: '호박', emoji: '🎃', season: 2, type: 'slow', seed: 120, grow: 8, base: 340, proc: 'pickle' },
    { id: 'grape', name: '포도', emoji: '🍇', season: 2, type: 'regrow', seed: 100, grow: 5, regrow: 2, base: 95, proc: 'jam' },

    { id: 'mushroom', name: '버섯', emoji: '🍄', season: 3, type: 'fast', seed: 25, grow: 3, base: 75, proc: 'pickle' },
    { id: 'pineapple', name: '파인애플', emoji: '🍍', season: 3, type: 'slow', seed: 150, grow: 7, base: 400, proc: 'jam' },
    { id: 'blueberry', name: '블루베리', emoji: '🫐', season: 3, type: 'regrow', seed: 110, grow: 5, regrow: 2, base: 95, proc: 'jam' },
  ];

  // 가공품: 기준가 = 작물 기준가 × mult + add (5G 단위 반올림), days 뒤 아침에 완성
  const PROCESSES = {
    jam: { name: '잼', emoji: '🍯', from: '과일', mult: 1.25, add: 25, days: 2 },
    pickle: { name: '피클', emoji: '🥫', from: '채소', mult: 1.2, add: 30, days: 2 },
  };

  const WEATHER = {
    sunny: { name: '맑음', emoji: '☀️', customers: 1, waters: false, closed: false, desc: '장사하기 좋은 날씨예요.' },
    rain: { name: '비', emoji: '🌧️', customers: 0.6, waters: true, closed: false, desc: '밭에 저절로 물이 뿌려지지만 손님이 줄어요.' },
    storm: { name: '폭풍', emoji: '⛈️', customers: 0, waters: true, closed: true, desc: '가게 문을 열 수 없어요. 밭에는 물이 뿌려져요.' },
    snow: { name: '눈', emoji: '🌨️', customers: 0.75, waters: false, closed: false, desc: '손님이 조금 줄어요.' },
    blizzard: { name: '눈보라', emoji: '🌬️', customers: 0, waters: false, closed: true, desc: '가게 문을 열 수 없어요.' },
  };

  // 계절별 날씨 확률
  const WEATHER_TABLE = [
    [['sunny', 0.67], ['rain', 0.28], ['storm', 0.05]],
    [['sunny', 0.65], ['rain', 0.25], ['storm', 0.10]],
    [['sunny', 0.68], ['rain', 0.26], ['storm', 0.06]],
    [['sunny', 0.60], ['snow', 0.34], ['blizzard', 0.06]],
  ];

  // value: 해당 레벨에서의 효과값
  const UPGRADES = [
    {
      id: 'field', name: '밭 확장', emoji: '🪴',
      desc: '경작할 수 있는 땅이 넓어져요.',
      levels: [
        { cost: 300, value: 5, label: '5×5' },
        { cost: 700, value: 6, label: '6×6' },
        { cost: 1200, value: 7, label: '7×7' },
        { cost: 1800, value: 8, label: '8×8' },
      ],
    },
    {
      id: 'can', name: '물뿌리개 개량', emoji: '🚿',
      desc: '물 줄 때 드는 체력이 줄어요.',
      levels: [
        { cost: 400, value: 2, label: '물 주기 ⚡2' },
        { cost: 1000, value: 1, label: '물 주기 ⚡1' },
      ],
    },
    {
      id: 'shelf', name: '진열대 추가', emoji: '🧺',
      desc: '가게에 진열할 수 있는 칸이 늘어요.',
      levels: [
        { cost: 300, value: 4, label: '4칸' },
        { cost: 700, value: 5, label: '5칸' },
        { cost: 1200, value: 6, label: '6칸' },
      ],
    },
    {
      id: 'sign', name: '가게 간판', emoji: '🪧',
      desc: '간판이 눈에 띄어 손님이 늘어요.',
      levels: [
        { cost: 300, value: 2, label: '손님 +2' },
        { cost: 800, value: 4, label: '손님 +4' },
        { cost: 1500, value: 7, label: '손님 +7' },
      ],
    },
    {
      id: 'workshop', name: '가공 공방', emoji: '🏺',
      desc: '장독대에 항아리가 생겨요. 작물을 넣어 두면 잼이나 피클이 돼요.',
      levels: [
        { cost: 400, value: 2, label: '항아리 2개' },
        { cost: 900, value: 4, label: '항아리 4개' },
        { cost: 1500, value: 6, label: '항아리 6개' },
      ],
    },
    {
      id: 'greenhouse', name: '온실', emoji: '🏡',
      desc: '4×4 온실. 계절과 상관없이 어떤 씨앗이든 키울 수 있고, 계절이 바뀌어도 시들지 않아요. 비는 들지 않아요.',
      levels: [
        { cost: 1800, value: 1, label: '온실 4×4' },
      ],
    },
  ];

  const BALANCE = {
    startMoney: 200,
    startDebt: 5000,
    deadline: 48,
    seasonLength: 12,
    startSeeds: { lettuce: 12, strawberry: 4 },
    startStock: { lettuce: 10 },

    maxEnergy: 100,
    plantCost: 2,
    waterCost: 3,
    harvestCost: 1,

    fieldStart: 4,
    greenhouseSize: 4,
    sprinklerCost: 200,
    procBatch: 5, // 항아리 하나에 넣을 수 있는 작물 수

    shelfStart: 3,
    shelfCap: 10, // 진열대 한 칸에 올릴 수 있는 최대 수량
    baseCustomers: 6,
    customerJitter: 0.15,
    // 손님이 찾는 작물의 가중치 (계절별: 봄, 여름, 가을, 겨울)
    wantShown: [4, 4, 4, 3], // 진열된 제철 작물
    wantUnshown: [1.5, 1.5, 1.5, 1], // 진열 안 된 제철 작물 (찾다가 없으면 실망)
    wantOther: [1, 1, 1, 2], // 진열된 제철 아닌 작물 (겨울엔 저장 작물을 많이 찾는다)
    wantProcessed: [2, 2, 2, 3], // 진열된 가공품 (계절을 타지 않고, 겨울엔 더 찾는다)
    wantPopular: 4, // 인기 작물 추가 가중치
    popularTolerance: 1.4, // 인기 작물은 40% 비싸도 기준가처럼 느낀다
    browseChance: 0.5, // 찾는 게 없거나 비싸면 다른 칸을 둘러볼 확률
    impulseFactor: 0.75, // 둘러보다 사는 건 덜 적극적이다
    addOnChance: 0.25, // 사고 나서 하나 더 집어 갈 확률
    // 가게 평판 (0~100): 손님 수에 곱해진다. 50 = 보통
    repStart: 50,
    repFair: 0.5, // 적당한 값(인기 작물 반영 기준가의 105% 이하)에 산 손님
    repOk: 0.2, // 조금 비싸게(125% 이하) 산 손님
    repPricey: -1.2, // 비싸서 그냥 간 손님
    repMissing: -0.2, // 찾는 작물이 없어서 그냥 간 손님
    satK: 0.3, // 구매 확률에 곱해지는 값 = 1 / (1 + satK × 최근 판매 개수)
    satDecay: 0.8, // 질림은 하루마다 80%로 줄어든다
    repDecay: 0.05, // 매일 50 쪽으로 조금씩 돌아간다
    repEffect: 0.006, // 평판 1점당 손님 배율 (0점 ×0.7, 100점 ×1.3)
    priceMin: 50,
    priceMax: 200,
    priceStep: 5,
  };

  const FACES = ['🧑', '👩', '👨', '👵', '👴', '🧒', '👧', '👦', '🧔', '👱', '🙋', '🧑‍🦱', '👩‍🦰', '🧓'];

  return { SEASONS, TYPES, CROPS, PROCESSES, WEATHER, WEATHER_TABLE, UPGRADES, BALANCE, FACES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GameData;
