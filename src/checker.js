// 機種定義から判別画面を組み立てる
//
//   import { mountChecker } from '.../src/checker.js';
//   await mountChecker(document.getElementById('app'), machine);

import { findWorstCases, getPressedPosition, judge, mod, wrap } from './judge.js';
import { validateMachine } from './validate.js';

const SNAP_DURATION_MS = 200;
const VIEWPORT_MARGIN = 8; // 画面端との余白 (px)
const MAX_SCALE = 1.5;     // 大画面で拡大しすぎないための上限
const WIDE_INFO_WIDTH = 378; // 横長レイアウトでの判別結果欄の幅 (px)
const LAYOUTS = ['tall', 'wide'];

let uid = 0;

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

function loadStylesheet() {
  const href = new URL('./checker.css', import.meta.url).href;
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find((link) => link.href === href);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = h('link', { rel: 'stylesheet', href });
    link.addEventListener('load', resolve);
    link.addEventListener('error', () => reject(new Error(`スタイルを読み込めません: ${href}`)));
    document.head.append(link);
  });
}

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { src: img.src, width: img.naturalWidth, height: img.naturalHeight };
}

// ---------- 部品 ----------

function createStepper(id, label, decreaseLabel, increaseLabel) {
  const labelId = `${id}-label`;
  const value = h('output', { class: 'sfc-stepper-value', 'aria-live': 'polite' });
  const decrease = h('button', { type: 'button', class: 'sfc-stepper-button', 'aria-label': decreaseLabel, text: '−' });
  const increase = h('button', { type: 'button', class: 'sfc-stepper-button', 'aria-label': increaseLabel, text: '＋' });
  const node = h('div', { class: 'sfc-control' }, [
    h('span', { class: 'sfc-control-label', id: labelId, text: label }),
    h('div', { class: 'sfc-stepper', role: 'group', 'aria-labelledby': labelId }, [decrease, value, increase]),
  ]);
  return { node, value, decrease, increase };
}

function createSegmented(id, label, options, onChange) {
  const labelId = `${id}-label`;
  const group = h('div', { class: 'sfc-segmented', role: 'radiogroup', 'aria-labelledby': labelId });
  group.style.setProperty('--sfc-count', options.length);
  const slider = h('span', { class: 'sfc-segmented-slider' });
  group.append(slider);
  const select = (index) => {
    group.style.setProperty('--sfc-index', index);
    group.toggleAttribute('data-first', index === 0);
  };
  options.forEach((text, index) => {
    const input = h('input', { type: 'radio', name: id, value: String(index), checked: index === 0 });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      select(index);
      onChange(index);
    });
    group.append(h('label', { class: 'sfc-segment' }, [input, h('span', { text })]));
  });
  select(0);
  return h('div', { class: 'sfc-control' }, [h('span', { class: 'sfc-control-label', id: labelId, text: label }), group]);
}

function createBadge({ name, percent, color }) {
  const key = h('div', { class: 'sfc-badge-key', text: name });
  if (color) key.style.backgroundColor = color;
  return h('div', { class: 'sfc-badge' }, [key, h('div', { class: 'sfc-badge-value', text: `${percent}%` })]);
}

// ---------- 本体 ----------

export async function mountChecker(root, machine) {
  const { errors, warnings } = validateMachine(machine);
  errors.forEach((message) => console.error(`[machine] ${message}`));
  warnings.forEach((message) => console.warn(`[machine] ${message}`));

  const [, images] = await Promise.all([
    loadStylesheet(),
    Promise.all(machine.pressOrders.map((order) => loadImage(order.reelImage))),
  ]);

  const id = `sfc${++uid}`;
  const { symbols, viewHeight, offsetY: reelOffsetBase } = machine.reel;
  const reelImageHeight = images[0].height;
  const symbolHeight = reelImageHeight / symbols;

  const state = {
    order: 0,
    setting: 0,
    slip: 0,
    showsPressPosition: false,
    reelPosition: symbols, // 表示中のリール位置 (1〜symbols)
  };

  // ---------- DOM ----------

  document.documentElement.classList.add('sfc-page');
  root.classList.add('sfc-root');

  const reel = h('div', {
    class: 'sfc-reel',
    tabindex: '0',
    role: 'slider',
    'aria-label': 'リール位置（↑↓キーでも操作可）',
    'aria-valuemin': '1',
    'aria-valuemax': String(symbols),
  });
  const reelWindow = h('div', { class: 'sfc-reel-window' }, [reel]);
  reelWindow.style.setProperty('--sfc-reel-width', `${images[0].width}px`);
  reelWindow.style.setProperty('--sfc-reel-height', `${viewHeight}px`);

  const slip = createStepper(`${id}-slip`, '滑りコマ数', '滑りコマ数を減らす', '滑りコマ数を増やす');
  const setting = createStepper(`${id}-setting`, '設定', '設定を下げる', '設定を上げる');
  const controls = h('section', { class: 'sfc-controls', 'aria-label': '条件' }, [
    slip.node,
    setting.node,
    createSegmented(`${id}-basis`, 'リールの位置', ['リール停止時', 'ボタン押下時'], (index) => {
      state.showsPressPosition = index === 1;
      render();
    }),
  ]);
  if (machine.pressOrders.length > 1) {
    controls.append(createSegmented(`${id}-order`, '押し順', machine.pressOrders.map((order) => order.label), (index) => {
      state.order = index;
      render();
    }));
  }

  const groupViews = machine.groups.map((group) => {
    const list = h('div', { class: 'sfc-badge-list' });
    const odds = group.showOdds ? h('span') : null;
    const header = h('div', { class: 'sfc-info-header' }, [h('span', { class: 'sfc-info-label', text: group.label })]);
    if (odds) header.append(h('span', { class: 'sfc-info-total' }, [h('span', { class: 'sfc-info-label', text: 'フラグ合算' }), odds]));
    return { group, list, odds, node: h('div', { class: 'sfc-info-box' }, [header, list]) };
  });

  const prizes = h('span');
  const infoRow = h('div', { class: 'sfc-info-row' }, [
    h('div', { class: 'sfc-info-box sfc-info-box--grow' }, [h('span', { class: 'sfc-info-label', text: '小役' }), prizes]),
    ...(machine.links ?? []).map((link) => h('div', { class: 'sfc-info-box' }, [
      h('span', { class: 'sfc-info-label', text: link.label }),
      h('a', { href: link.url, target: '_blank', rel: 'noopener', text: link.text }),
    ])),
  ]);

  const infoArea = h('div', { class: 'sfc-info-area' }, [
    h('section', { class: 'sfc-info-panel', 'aria-label': '判別結果', 'aria-live': 'polite' }, [
      ...groupViews.map((view) => view.node),
      infoRow,
    ]),
  ]);
  if (machine.contact) {
    infoArea.append(h('footer', { class: 'sfc-note' }, [
      '(不具合報告/ご質問等は ',
      h('a', { href: machine.contact.url, target: '_blank', rel: 'noopener', text: machine.contact.text }),
      ' 宛にお願いします)',
    ]));
  }

  const app = h('main', { class: 'sfc-app' }, [reelWindow, controls, infoArea]);
  root.replaceChildren(app);

  // ---------- 描画 ----------

  function renderBadges(view, hits) {
    view.list.replaceChildren(...hits.map(createBadge));
  }

  function render() {
    slip.value.textContent = state.slip;
    setting.value.textContent = machine.settings[state.setting];
    reel.style.backgroundImage = `url("${images[state.order].src}")`;
    reel.setAttribute('aria-valuenow', state.reelPosition);

    const position = getPressedPosition(machine, state);
    const result = judge(machine, { order: state.order, setting: state.setting, slip: state.slip, position });
    result.groups.forEach(({ hits, odds }, i) => {
      const view = groupViews[i];
      renderBadges(view, hits);
      if (view.odds) view.odds.textContent = odds ?? '-';
    });
    prizes.textContent = result.prizes.length > 0 ? result.prizes.join(', ') : 'なし';
  }

  // ---------- 条件操作 ----------

  function bindStepper(stepper, key, max) {
    const step = (delta) => {
      state[key] = wrap(state[key] + delta, 0, max);
      render();
    };
    stepper.decrease.addEventListener('click', () => step(-1));
    stepper.increase.addEventListener('click', () => step(1));
  }
  bindStepper(slip, 'slip', machine.maxSlip);
  bindStepper(setting, 'setting', machine.settings.length - 1);

  // ---------- リール操作 ----------

  // 背景画像の縦位置 (px)。画像は縦に繰り返し表示されるため、画像の高さの倍数ずれても見た目は同じ。
  // 吸着アニメーション中は継ぎ目をまたいで逆回転しないよう範囲外の値も取り、終わってから範囲内に戻す。
  let reelOffsetY = 0;
  let snapTimer = null;
  let scale = 1;
  const drag = { active: false, startY: 0, startOffsetY: 0 };

  function applyReelOffset(animate) {
    reel.style.transition = animate ? `background-position ${SNAP_DURATION_MS}ms ease-out` : '';
    reel.style.backgroundPosition = `0px ${reelOffsetY + reelOffsetBase}px`;
  }

  // 見た目を変えずに位置を範囲内に戻す（アニメーション中なら即座に到達点へ）
  function normalizeReelOffset() {
    clearTimeout(snapTimer);
    reelOffsetY = mod(reelOffsetY, reelImageHeight);
    applyReelOffset(false);
  }

  function setReelOffset(offsetY, animate) {
    clearTimeout(snapTimer);
    reelOffsetY = offsetY;
    applyReelOffset(animate);
    if (animate) snapTimer = setTimeout(normalizeReelOffset, SNAP_DURATION_MS);
  }

  // index 番目のコマ位置（範囲外も可）まで動かし、表示・判定を更新する
  function moveReelTo(index, animate) {
    const normalized = wrap(index, 0, symbols - 1);
    state.reelPosition = normalized === 0 ? symbols : normalized;
    setReelOffset(index * symbolHeight, animate);
    render();
  }

  const currentSymbolIndex = () => Math.round(reelOffsetY / symbolHeight);

  function endDrag() {
    if (!drag.active) return;
    drag.active = false;
    moveReelTo(currentSymbolIndex(), true); // 最寄りのコマに吸着させる
  }

  reel.addEventListener('pointerdown', (e) => {
    normalizeReelOffset();
    drag.active = true;
    drag.startY = e.clientY;
    drag.startOffsetY = reelOffsetY;
    reel.setPointerCapture(e.pointerId);
  });

  reel.addEventListener('pointermove', (e) => {
    if (!drag.active) return;
    // 画面上の移動量を拡大率で割り、リール画像上の移動量に直す
    setReelOffset(drag.startOffsetY + (e.clientY - drag.startY) / scale, false);
  });

  reel.addEventListener('pointerup', endDrag);
  reel.addEventListener('pointercancel', endDrag);

  // ↓ キーで下方向（ドラッグを下に引いたとき）と同じ向きに1コマ動かす
  reel.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    moveReelTo(currentSymbolIndex() + step, true);
  });

  // ---------- 画面サイズへの追従 ----------

  const worstCases = findWorstCases(machine);

  // 該当数が変わっても高さが変わらないよう、最大該当時の高さを確保する
  function reserveBadgeSpace() {
    for (const view of groupViews) {
      view.list.style.minHeight = '';
      renderBadges(view, worstCases.get(view.group.id).hits);
      view.list.style.minHeight = `${view.list.offsetHeight}px`;
    }
  }

  function applyLayout(name) {
    app.classList.remove(...LAYOUTS.map((layout) => `sfc-layout-${layout}`));
    app.classList.add(`sfc-layout-${name}`);
    const gap = parseFloat(getComputedStyle(app).columnGap);
    const top = reelWindow.offsetWidth + gap + controls.offsetWidth;
    app.style.width = `${name === 'tall' ? top : top + gap + WIDE_INFO_WIDTH}px`;
    reserveBadgeSpace();
    return { width: app.offsetWidth, height: app.offsetHeight };
  }

  // 縦長・横長のうち大きく表示できる方を選び、画面に収まる倍率で拡大縮小する
  function fitToViewport() {
    // innerWidth/innerHeight はスマホで中身がはみ出すと広がってしまうため、表示領域そのものの大きさを使う
    const { clientWidth, clientHeight } = document.documentElement;
    const availableWidth = clientWidth - VIEWPORT_MARGIN * 2;
    const availableHeight = clientHeight - VIEWPORT_MARGIN * 2;
    const scaleFor = ({ width, height }) => Math.min(availableWidth / width, availableHeight / height);

    let best = null;
    for (const name of LAYOUTS) {
      const fit = scaleFor(applyLayout(name));
      if (!best || fit > best.fit) best = { name, fit };
    }
    applyLayout(best.name);
    render();

    scale = Math.min(best.fit, MAX_SCALE);
    app.dataset.layout = best.name;
    app.style.setProperty('--sfc-scale', scale);
  }

  window.addEventListener('resize', fitToViewport);
  moveReelTo(0, false);
  fitToViewport();

  // テスト・デバッグ用の操作口
  return {
    state,
    render,
    moveReelTo,
    get scale() { return scale; },
    get layout() { return app.dataset.layout; },
    get reelOffsetY() { return reelOffsetY; },
  };
}
