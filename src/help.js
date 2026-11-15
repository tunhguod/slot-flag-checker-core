// 使い方（ガイド）
//
// 別ページには移らず、判別画面の上に幕をかけ、説明する部分だけを明るく抜いて吹き出しで説明する。
// 「次へ」「戻る」で1つずつ進む。説明する項目は機種定義を見て出し分ける
// （フラグ合算を表示しない機種には合算の説明を出さない、など）。

const SPOT_PADDING = 6;   // 明るく抜く範囲を、対象の要素より広げる量 (px)
const BUBBLE_GAP = 12;    // 抜いた範囲と吹き出しの間隔 (px)
const VIEWPORT_MARGIN = 12; // 吹き出しと画面の端の間隔 (px)

// 説明の一覧を作る。target は targets のキー（明るく抜く部分）
export function helpSteps(machine) {
  const steps = [
    {
      target: 'reel',
      title: 'リールを動かす',
      text: 'リールを上下にドラッグすると、1コマずつ位置が変わります。キーボードでは ↑↓ キーでも動かせます。',
    },
    {
      target: 'basis',
      title: 'リールの位置',
      text: 'リールの描画位置を切り替えます。「停止」選択時はリールが停止した位置、「押下」選択時はストップボタンを押した時点での位置を描画します。',
    },
    {
      target: 'slipAndSetting',
      title: '滑りと設定',
      text: 'ボタンをタップするか、指で左右になぞって選びます。',
    },
  ];
  steps.push({
    target: 'lamps',
    title: 'ランプ',
    text: '点灯しているフラグが、今の止まり方で成立している可能性のあるフラグです。'
      + '数字は、点灯しているフラグ全体のうち、そのフラグである割合（置数の比）です。',
  });
  if (machine.groups.some((group) => group.showOdds)) {
    steps.push({
      target: 'odds',
      title: 'フラグ合算',
      text: '点灯しているフラグの出現率を合計し、1/○ で表します。',
    });
  }
  if (machine.toggleFlags) {
    steps.push({
      target: 'lamps',
      title: 'ランプの ON / OFF',
      text: '点灯しているランプをタップすると OFF になり、フラグ合算から外れます。もう一度タップすると ON に戻ります。'
        + 'リール・滑り・設定・押し順・リールの位置のどれかを変えると、全部 ON に戻ります。',
    });
  }
  return steps;
}

// 複数の要素をまとめて囲む長方形（画面上の座標）
function unionRect(elements) {
  const rects = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

// ガイドのボタンとダイアログを作る
//   h: checker.js の要素作成関数
//   targets: { キー: 要素の配列 }。helpSteps の target に対応する、明るく抜く部分
export function createHelp(machine, h, targets) {
  const steps = helpSteps(machine);
  const titleId = `sfc-help-title-${Math.random().toString(36).slice(2)}`;

  const spot = h('div', { class: 'sfc-help-spot', 'aria-hidden': 'true' });
  const counter = h('span', { class: 'sfc-help-counter' });
  const title = h('h2', { id: titleId, class: 'sfc-help-title' });
  const text = h('p', { class: 'sfc-help-text' });
  const close = h('button', { type: 'button', class: 'sfc-help-close', 'aria-label': '閉じる', text: '×' });
  const back = h('button', { type: 'button', class: 'sfc-help-nav', text: '戻る' });
  const next = h('button', { type: 'button', class: 'sfc-help-nav sfc-help-nav--primary' });
  const bubble = h('div', { class: 'sfc-help-bubble' }, [
    h('div', { class: 'sfc-help-header' }, [title, close]),
    text,
    h('div', { class: 'sfc-help-footer' }, [counter, h('div', { class: 'sfc-help-navs' }, [back, next])]),
  ]);
  const dialog = h('dialog', { class: 'sfc-help', 'aria-labelledby': titleId }, [spot, bubble]);
  const button = h('button', { type: 'button', class: 'sfc-help-button', 'aria-haspopup': 'dialog', text: '？ 使い方' });

  let index = 0;

  // 今のステップの対象を明るく抜き、吹き出しを対象の上か下（空いている方）に置く
  function place() {
    const area = unionRect(targets[steps[index].target]);
    const spotRect = {
      left: area.left - SPOT_PADDING,
      top: area.top - SPOT_PADDING,
      width: area.width + SPOT_PADDING * 2,
      height: area.height + SPOT_PADDING * 2,
    };
    Object.assign(spot.style, {
      left: `${spotRect.left}px`,
      top: `${spotRect.top}px`,
      width: `${spotRect.width}px`,
      height: `${spotRect.height}px`,
    });

    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const bubbleWidth = bubble.offsetWidth;
    const bubbleHeight = bubble.offsetHeight;
    const spotRight = spotRect.left + spotRect.width;
    const spotBottom = spotRect.top + spotRect.height;
    // 対象の中央に揃えた位置（画面からはみ出さないよう端で止める）
    const alignedLeft = clamp(spotRect.left + spotRect.width / 2 - bubbleWidth / 2,
      VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - bubbleWidth);
    const alignedTop = clamp(spotRect.top + spotRect.height / 2 - bubbleHeight / 2,
      VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - bubbleHeight);
    // 対象の下・上・右・左の順に、吹き出しが丸ごと収まる側を探す
    // （横長の画面ではリールやランプ盤が画面の高さのほとんどを占め、上下に空きがないため左右も探す）
    const sides = [
      { fits: viewportHeight - spotBottom - BUBBLE_GAP - VIEWPORT_MARGIN >= bubbleHeight, left: alignedLeft, top: spotBottom + BUBBLE_GAP },
      { fits: spotRect.top - BUBBLE_GAP - VIEWPORT_MARGIN >= bubbleHeight, left: alignedLeft, top: spotRect.top - BUBBLE_GAP - bubbleHeight },
      { fits: viewportWidth - spotRight - BUBBLE_GAP - VIEWPORT_MARGIN >= bubbleWidth, left: spotRight + BUBBLE_GAP, top: alignedTop },
      { fits: spotRect.left - BUBBLE_GAP - VIEWPORT_MARGIN >= bubbleWidth, left: spotRect.left - BUBBLE_GAP - bubbleWidth, top: alignedTop },
    ];
    // どの側にも収まらない（対象が画面のほとんどを占める）ときだけ、画面の下端に置いて対象に重ねる
    const chosen = sides.find((side) => side.fits)
      ?? { left: alignedLeft, top: viewportHeight - VIEWPORT_MARGIN - bubbleHeight };
    bubble.style.left = `${chosen.left}px`;
    bubble.style.top = `${chosen.top}px`;
  }

  function show(newIndex) {
    index = newIndex;
    const step = steps[index];
    title.textContent = step.title;
    text.textContent = step.text;
    counter.textContent = `${index + 1} / ${steps.length}`;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? '閉じる' : '次へ';
    place();
    next.focus();
  }

  button.addEventListener('click', () => {
    dialog.showModal();
    show(0);
  });
  back.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => (index === steps.length - 1 ? dialog.close() : show(index + 1)));
  close.addEventListener('click', () => dialog.close());
  // Esc で閉じるのはブラウザの標準動作。幕の部分のタップでは閉じない（読んでいる途中で誤って閉じないように）

  return {
    button,
    dialog,
    // 画面の大きさ・拡大率が変わったときに checker.js の fit から呼ぶ（開いていれば位置を合わせ直す）
    relayout() { if (dialog.open) place(); },
  };
}
