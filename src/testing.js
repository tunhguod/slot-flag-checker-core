// 正解データ（ゴールデンデータ）との照合
//
// 正解データは「状態キー → 表示内容」の JSON。
//   状態キー: "押し順ID|設定のインデックス|滑りコマ数|押下位置"
//   表示内容: "グループID=名前:割合:色,…|合算確率;…;P=小役"
//     色は機種定義の colors の値（色なしは "-"）。合算確率は showOdds のグループだけ（該当なしは "-"）。

import { formatPrizes, judge } from './judge.js';

export function formatSnapshot(machine, result) {
  const groups = result.groups.map(({ group, hits, odds }) => {
    const items = hits.map((hit) => `${hit.name}:${hit.percent}:${hit.color ?? '-'}`).join(',');
    return `${group.id}=${items}${group.showOdds ? `|${odds ?? '-'}` : ''}`;
  });
  return [...groups, `P=${formatPrizes(result.prizes)}`].join(';');
}

export function stateKeys(machine) {
  const keys = [];
  machine.pressOrders.forEach((order) => {
    machine.settings.forEach((_, setting) => {
      for (let slip = 0; slip <= machine.maxSlip; slip++) {
        for (let position = 1; position <= machine.reel.symbols; position++) {
          keys.push(`${order.id}|${setting}|${slip}|${position}`);
        }
      }
    });
  });
  return keys;
}

// 全状態を判定し、正解データと突き合わせる
export function runGolden(machine, golden) {
  const failures = [];
  const keys = stateKeys(machine);
  for (const key of keys) {
    const [orderId, setting, slip, position] = key.split('|');
    const order = machine.pressOrders.findIndex((o) => o.id === orderId);
    const actual = formatSnapshot(machine, judge(machine, {
      order, setting: Number(setting), slip: Number(slip), position: Number(position),
    }));
    const expected = golden[key];
    if (actual !== expected) failures.push({ key, expected, actual });
  }
  const missing = Object.keys(golden).filter((key) => !keys.includes(key));
  return { total: keys.length, goldenTotal: Object.keys(golden).length, failures, missing };
}
