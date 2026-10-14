// 判定ロジック（画面に依存しない）
//
// 機種定義（machine）と条件から、成立している可能性のあるフラグと小役を求める。
// 機種定義の形式は README.md を参照。

// value を 0 以上 n 未満に収める（負の数・小数にも対応した剰余）
export function mod(value, n) {
  return ((value % n) + n) % n;
}

// 整数 value を min〜max の範囲で循環させる
export function wrap(value, min, max) {
  return mod(value - min, max - min + 1) + min;
}

export function sum(arr) {
  return arr.reduce((acc, cur) => acc + cur, 0);
}

// 表示中のリール位置 (1〜symbols) から、ボタンを押した位置 (1〜symbols) を求める
// showsPressPosition: true なら表示中の位置をそのまま押下位置とみなす（滑りコマ数を戻さない）
export function getPressedPosition(machine, { reelPosition, slip, showsPressPosition }) {
  const back = machine.reel.referenceRow + (showsPressPosition ? 0 : slip);
  return wrap(reelPosition - back, 1, machine.reel.symbols);
}

// 制御表の行（行0 = symbols 番, 行 symbols-1 = 1 番）
function getMapRow(map, machine, position) {
  return map[machine.reel.symbols - position];
}

function getBadgeColor(machine, flag, orderId, position) {
  if (!flag.color) return null;
  const when = flag.colorWhen;
  if (when) {
    if (when.orders && !when.orders.includes(orderId)) return null;
    if (when.positions && !when.positions.some(([from, to]) => position >= from && position <= to)) return null;
  }
  return machine.colors[flag.color];
}

export function formatPercent(num, allNum) {
  return ((num / allNum) * 100).toFixed(0);
}

export function formatOdds(machine, groupNum) {
  return `1/${(machine.denominator / groupNum).toFixed(1)}`;
}

// 判定する
// order: 押し順のインデックス, setting: 設定のインデックス, slip: 滑りコマ数, position: 押下位置 (1〜symbols)
// 戻り値の割合（percent）は、全グループの該当フラグの置数合計に対する比率
export function judge(machine, { order, setting, slip, position }) {
  const pressOrder = machine.pressOrders[order];
  const flagRow = getMapRow(pressOrder.flagMap, machine, position);
  const hits = machine.flags
    .filter((_, i) => flagRow[i] === slip)
    .map((flag) => ({ flag, num: flag.nums[setting] }));
  const allNum = sum(hits.map((hit) => hit.num));

  const groups = machine.groups.map((group) => {
    const groupHits = hits
      .filter((hit) => hit.flag.group === group.id)
      .map((hit) => ({
        name: hit.flag.name,
        num: hit.num,
        percent: formatPercent(hit.num, allNum),
        color: getBadgeColor(machine, hit.flag, pressOrder.id, position),
      }));
    const groupNum = sum(groupHits.map((hit) => hit.num));
    return {
      group,
      hits: groupHits,
      odds: groupHits.length > 0 ? formatOdds(machine, groupNum) : null,
    };
  });

  const prizeRow = getMapRow(pressOrder.prizeMap, machine, position);
  const prizes = [...new Set(pressOrder.prizeNames.filter((_, i) => prizeRow[i] === slip))];

  return { groups, prizes };
}

// 小役欄に表示する文字列
export function formatPrizes(prizes) {
  return prizes.length > 0 ? prizes.join(', ') : 'なし';
}

// 表示されうる内容をすべて集める（表示領域の確保に使う）
// 割合の数字は表示幅が固定のため、設定は問わず、フラグ名の組み合わせごとに1つ集める
export function collectDisplayVariants(machine) {
  const groups = new Map(machine.groups.map((group) => [group.id, new Map()]));
  const prizes = new Set();
  machine.pressOrders.forEach((_, order) => {
    for (let position = 1; position <= machine.reel.symbols; position++) {
      for (let slip = 0; slip <= machine.maxSlip; slip++) {
        const result = judge(machine, { order, setting: 0, slip, position });
        for (const { group, hits } of result.groups) {
          groups.get(group.id).set(hits.map((hit) => hit.name).join('\n'), hits);
        }
        prizes.add(formatPrizes(result.prizes));
      }
    }
  });
  return {
    groups: new Map([...groups].map(([id, variants]) => [id, [...variants.values()]])),
    prizes: [...prizes],
  };
}
