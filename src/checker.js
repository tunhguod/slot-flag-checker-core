// 機種定義から判別画面を組み立てる
//
//   import { mountChecker } from '.../src/checker.js';
//   const checker = await mountChecker(document.getElementById('app'), machine);
//   checker.destroy(); // 別の機種に切り替えるときなど
//
// 画面は root 要素の大きさに収まるよう拡大縮小する。root には大きさを与えておくこと
// （html, body, root の高さを 100% にするなど）。

import { collectDisplayVariants, formatNote, formatPrizes, getPressedPosition, judge, mod, wrap } from './judge.js';
import { validateMachine } from './validate.js';

const SNAP_DURATION_MS = 200;
const FIT_MARGIN = 8;    // root の端との余白 (px)
const MAX_SCALE = 1.5;   // 大画面で拡大しすぎないための上限
const GAP = 8;           // 欄どうしの間隔 (px)。checker.css の --sfc-gap と揃える
const TALL_SIDE_WIDTH = 178; // 縦長レイアウトでリール横の欄の幅 (px)
const WIDE_SIDE_WIDTH = 150; // 横長レイアウトでリール横の欄の幅 (px)
const WIDE_MAIN_WIDTH = 378; // 横長レイアウトで判別結果・操作の列の幅 (px)
const LAMP_COLUMNS = 10;     // ランプ盤の1行のマス数
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

// checker.css の --sfc-ink（明るい文字）と --sfc-ink-dark（暗い文字）と揃える
const LAMP_INK_LIGHT = '#ece8df';
const LAMP_INK_DARK = '#15161b';

// 相対輝度 (0〜1)
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 点灯したマスの文字色: 白と黒のうち、背景とのコントラスト比が高い方
function lampInk(hex) {
  const background = luminance(hex) + 0.05;
  const light = (luminance(LAMP_INK_LIGHT) + 0.05) / background;
  const dark = background / (luminance(LAMP_INK_DARK) + 0.05);
  return light >= dark ? LAMP_INK_LIGHT : LAMP_INK_DARK;
}

// ---------- 部品 ----------

// 1タップで選ぶボタン列（ラジオボタン）
// keys: 滑り・設定のボタン列。タップに加え、指を左右に動かすと指の下のボタンが選ばれる
// switch: 2択の切り替えスイッチ
function createChoices(id, label, options, { variant = 'keys', initial = 0 } = {}) {
  const labelId = `${id}-label`;
  const group = h('div', { class: `sfc-choices sfc-choices--${variant}`, role: 'radiogroup', 'aria-labelledby': labelId });
  group.style.setProperty('--sfc-count', options.length);
  const listeners = [];
  const choices = [];
  const inputs = options.map((text, index) => {
    const input = h('input', { type: 'radio', name: id, id: `${id}-${index}`, value: String(index), checked: index === initial });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      group.style.setProperty('--sfc-index', index);
      listeners.forEach((listener) => listener(index));
    });
    const choice = h('label', { class: 'sfc-choice', for: `${id}-${index}` }, [input, h('span', { text: String(text) })]);
    choices.push(choice);
    group.append(choice);
    return input;
  });
  group.style.setProperty('--sfc-index', initial);
  if (variant === 'switch') group.prepend(h('span', { class: 'sfc-choices-slider', 'aria-hidden': 'true' }));

  if (variant === 'keys') {
    const select = (index) => {
      if (inputs[index].checked) return;
      inputs[index].checked = true;
      inputs[index].dispatchEvent(new Event('change'));
    };
    // 指の位置に一番近いボタン（ボタン間のすき間で離しても、どちらかに決まる）
    const nearest = (clientX) => {
      let best = 0;
      let bestDistance = Infinity;
      choices.forEach((choice, index) => {
        const rect = choice.getBoundingClientRect();
        const distance = Math.abs(clientX - (rect.left + rect.width / 2));
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      return best;
    };
    // 押した時点で指の下のボタンを選び、そのまま左右に動かすと選択が追従する（タップはこの押した時点の選択になる）
    let dragging = false;
    group.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); // 文字の選択やフォーカス移動で操作が途切れないようにする
      dragging = true;
      select(nearest(e.clientX));
      group.setPointerCapture(e.pointerId);
    });
    group.addEventListener('pointermove', (e) => {
      if (dragging) select(nearest(e.clientX));
    });
    const end = () => { dragging = false; };
    group.addEventListener('pointerup', end);
    group.addEventListener('pointercancel', end);
  }
  const node = h('div', { class: 'sfc-control' }, [h('span', { class: 'sfc-control-label', id: labelId, text: label }), group]);
  return { node, inputs, onChange: (listener) => listeners.push(listener) };
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
  const { symbols, viewHeight, offsetY: reelOffsetBase, referenceRow } = machine.reel;
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

  // リール
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

  // リール横: 停止位置と押下位置（制御表のコマ番号）
  const stopValue = h('span', { class: 'sfc-position-value' });
  const pressValue = h('span', { class: 'sfc-position-value' });
  const slipValue = h('span', { class: 'sfc-position-slip' });
  const stopRow = h('div', { class: 'sfc-position' }, [h('span', { class: 'sfc-position-label', text: '停止' }), stopValue]);
  const pressRow = h('div', { class: 'sfc-position' }, [h('span', { class: 'sfc-position-label', text: '押下' }), pressValue]);
  const positions = h('section', { class: 'sfc-positions', 'aria-label': 'リール位置' }, [
    stopRow,
    h('div', { class: 'sfc-position-arrow', 'aria-hidden': 'true' }, [slipValue]),
    pressRow,
  ]);

  const side = h('div', { class: 'sfc-side' }, [positions]);
  // 特徴（機種定義に notes があるときだけ）: 停止・押下の下に表示する。
  // 該当なしでも行の高さは残し、表示の有無でレイアウトが動かないようにする
  const noteValue = machine.notes ? h('div', { class: 'sfc-trait-value' }) : null;
  const notePanel = noteValue
    ? h('section', { class: 'sfc-trait', 'aria-label': '特徴', 'aria-live': 'polite' }, [
      h('span', { class: 'sfc-control-label', text: '特徴' }),
      noteValue,
    ])
    : null;
  if (notePanel) side.append(notePanel);
  function setNote(note) {
    if (!notePanel) return;
    noteValue.textContent = formatNote(note);
    notePanel.dataset.tone = note?.tone ?? '';
  }

  // リンク
  for (const link of machine.links ?? []) {
    side.append(h('div', { class: 'sfc-link' }, [
      h('span', { class: 'sfc-control-label', text: link.label }),
      h('a', { href: link.url, target: '_blank', rel: 'noopener', text: link.text }),
    ]));
  }

  // 判別結果: グループごとのランプ盤（同じグループの同名フラグは1マスにまとめる）
  const groupViews = machine.groups.map((group) => {
    const names = [...new Set(machine.flags.filter((flag) => flag.group === group.id).map((flag) => flag.name))];
    const lamps = new Map(names.map((name) => {
      const percent = h('span', { class: 'sfc-lamp-percent' });
      const node = h('li', { class: 'sfc-lamp' }, [h('span', { class: 'sfc-lamp-name', text: name }), percent]);
      return [name, { node, percent }];
    }));
    const odds = group.showOdds ? h('span', { class: 'sfc-odds' }) : null;
    const header = h('div', { class: 'sfc-group-header' }, [h('h2', { class: 'sfc-group-label', text: group.label })]);
    if (odds) header.append(h('span', { class: 'sfc-odds-box' }, [h('span', { class: 'sfc-odds-label', text: '合算' }), odds]));
    // どのグループもマスの大きさを揃える（マスが少ないグループは左詰め）
    const grid = h('ul', { class: 'sfc-lamps' }, [...lamps.values()].map((lamp) => lamp.node));
    grid.style.setProperty('--sfc-columns', LAMP_COLUMNS);
    return { group, lamps, odds, node: h('section', { class: 'sfc-group' }, [header, grid]) };
  });

  const prizes = h('div', { class: 'sfc-prizes-value' });

  // 小役の文字列を表示する。絵文字は書体が違い上下の余白も違うため、そのままだと行の基準線が動き、
  // 絵文字を含むかどうかで行が上下にずれる。絵文字を高さ1文字分の箱に入れて、行の高さに影響させない
  function setPrizes(text) {
    prizes.replaceChildren(...text.split(/(\p{Extended_Pictographic}\uFE0F?)/u)
      .filter(Boolean)
      .map((part) => (/\p{Extended_Pictographic}/u.test(part) ? h('span', { class: 'sfc-emoji', text: part }) : part)));
  }
  const results = h('div', { class: 'sfc-results', 'aria-live': 'polite' }, [
    ...groupViews.map((view) => view.node),
    h('div', { class: 'sfc-prizes' }, [h('span', { class: 'sfc-group-label', text: '小役' }), prizes]),
  ]);

  // 操作: 親指で届くよう画面下にまとめる
  const slipChoices = createChoices(`${id}-slip`, '滑り', Array.from({ length: machine.maxSlip + 1 }, (_, i) => i));
  const settingChoices = createChoices(`${id}-setting`, '設定', machine.settings);
  const basisChoices = createChoices(`${id}-basis`, 'リールの位置', ['停止', '押下'], { variant: 'switch' });
  const switches = [basisChoices.node];
  let orderChoices = null;
  if (machine.pressOrders.length > 1) {
    orderChoices = createChoices(`${id}-order`, '押し順', machine.pressOrders.map((order) => order.label), { variant: 'switch' });
    switches.unshift(orderChoices.node);
  }
  const controls = h('section', { class: 'sfc-controls', 'aria-label': '条件' }, [
    slipChoices.node,
    settingChoices.node,
    h('div', { class: 'sfc-switches' }, switches),
  ]);

  const main = h('div', { class: 'sfc-main' }, [results, controls]);
  const app = h('main', { class: 'sfc-app' }, [reelWindow, side, main]);
  if (machine.contact) {
    app.append(h('footer', { class: 'sfc-note' }, [
      '不具合報告・ご質問は ',
      h('a', { href: machine.contact.url, target: '_blank', rel: 'noopener', text: machine.contact.text }),
      ' までお願いします',
    ]));
  }
  root.replaceChildren(app);

  // ---------- 描画 ----------

  function setLamp(lamp, hit) {
    lamp.node.classList.toggle('is-on', Boolean(hit));
    // 「100%」がマスに収まるよう、% 記号は小さく表示する
    lamp.percent.replaceChildren(...(hit ? [hit.percent, h('small', { text: '%' })] : []));
    if (hit?.color) {
      lamp.node.style.setProperty('--sfc-lamp', hit.color);
      lamp.node.style.setProperty('--sfc-lamp-ink', lampInk(hit.color));
    } else {
      lamp.node.style.removeProperty('--sfc-lamp');
      lamp.node.style.removeProperty('--sfc-lamp-ink');
    }
  }

  function render() {
    reel.style.backgroundImage = `url("${images[state.order].src}")`;
    reel.setAttribute('aria-valuenow', state.reelPosition);

    const pressed = getPressedPosition(machine, state);
    const stopped = wrap(pressed + state.slip, 1, symbols);
    stopValue.textContent = `${stopped}番`;
    pressValue.textContent = `${pressed}番`;
    slipValue.textContent = `${state.slip}コマ滑り`;
    // リールをどちらの位置に合わせているか
    stopRow.classList.toggle('is-aligned', !state.showsPressPosition);
    pressRow.classList.toggle('is-aligned', state.showsPressPosition);

    const result = judge(machine, { order: state.order, setting: state.setting, slip: state.slip, position: pressed });
    result.groups.forEach(({ hits, odds }, i) => {
      const view = groupViews[i];
      const byName = new Map(hits.map((hit) => [hit.name, hit]));
      for (const [name, lamp] of view.lamps) setLamp(lamp, byName.get(name));
      if (view.odds) view.odds.textContent = odds ?? '-';
    });
    setPrizes(formatPrizes(result.prizes));
    setNote(result.note);
  }

  // ---------- 条件操作 ----------

  slipChoices.onChange((index) => { state.slip = index; render(); });
  settingChoices.onChange((index) => { state.setting = index; render(); });
  basisChoices.onChange((index) => { state.showsPressPosition = index === 1; render(); });
  orderChoices?.onChange((index) => { state.order = index; render(); });

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

  const variants = collectDisplayVariants(machine);

  // 小役の文字列が変わっても高さが変わらないよう、表示されうる文字列をすべて描いて測り、
  // 一番高いものに合わせて欄の高さを確保する（ランプ盤はマスが固定なので大きさが変わらない）
  function reserveSpace() {
    prizes.style.minHeight = '';
    let max = 0;
    for (const text of variants.prizes) {
      setPrizes(text);
      max = Math.max(max, prizes.offsetHeight);
    }
    prizes.style.minHeight = `${max}px`;
  }

  function applyLayout(name) {
    app.classList.remove(...LAYOUTS.map((layout) => `sfc-layout-${layout}`));
    app.classList.add(`sfc-layout-${name}`);
    const reelWidth = reelWindow.offsetWidth;
    app.style.width = `${name === 'tall'
      ? reelWidth + GAP + TALL_SIDE_WIDTH
      : reelWidth + GAP + WIDE_SIDE_WIDTH + GAP + WIDE_MAIN_WIDTH}px`;
    reserveSpace();
    return { width: app.offsetWidth, height: app.offsetHeight };
  }

  // 縦長・横長のうち大きく表示できる方を選び、root に収まる倍率で拡大縮小する
  function fit() {
    const availableWidth = root.clientWidth - FIT_MARGIN * 2;
    const availableHeight = root.clientHeight - FIT_MARGIN * 2;
    const scaleFor = ({ width, height }) => Math.min(availableWidth / width, availableHeight / height);

    let best = null;
    for (const name of LAYOUTS) {
      const fitScale = scaleFor(applyLayout(name));
      if (!best || fitScale > best.fit) best = { name, fit: fitScale };
    }
    applyLayout(best.name);
    render();

    scale = Math.min(best.fit, MAX_SCALE);
    app.dataset.layout = best.name;
    app.style.setProperty('--sfc-scale', scale);
  }

  const resizeObserver = new ResizeObserver(() => fit());
  resizeObserver.observe(root);
  moveReelTo(0, false);
  fit();

  return {
    state,
    render,
    moveReelTo,
    get scale() { return scale; },
    get layout() { return app.dataset.layout; },
    get reelOffsetY() { return reelOffsetY; },
    destroy() {
      resizeObserver.disconnect();
      clearTimeout(snapTimer);
      root.replaceChildren();
      root.classList.remove('sfc-root');
    },
  };
}
