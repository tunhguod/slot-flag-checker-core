// 正解データ（ゴールデンデータ）との照合
//
// 正解データは「状態キー → 表示内容」の JSON。
//   状態キー: "押し順ID|設定のインデックス|滑りコマ数|押下位置"
//   表示内容: "グループID=名前:割合:色,…|合算確率;…;P=小役[;N=特徴:強さ]"
//     色はランプの色コード（色なしは "-"）。合算確率は showOdds のグループだけ（該当なしは "-"）。
//     N= は機種定義に notes があるときだけ付く（該当なしは "-"）。

import { formatPrizes, judge } from './judge.js';

export function formatSnapshot(machine, result) {
  const groups = result.groups.map(({ group, hits, odds }) => {
    const items = hits.map((hit) => `${hit.name}:${hit.percent}:${hit.color ?? '-'}`).join(',');
    return `${group.id}=${items}${group.showOdds ? `|${odds ?? '-'}` : ''}`;
  });
  const parts = [...groups, `P=${formatPrizes(result.prizes)}`];
  if (machine.notes) parts.push(`N=${result.note ? `${result.note.text}:${result.note.tone}` : '-'}`);
  return parts.join(';');
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

// フラグの除外（ランプの OFF）を確かめる
// showOdds のグループで、点灯したフラグを1つ除外したとき・全部除外したときに、
//   - 合算確率が「残りのフラグの置数の合計」から計算した値になること（制御表と置数から直接求める）
//   - 割合（percent）が除外しないときと変わらないこと
//   - 除外したフラグに excluded: true が付くこと
// を全状態で確かめる。
export function runExclusionChecks(machine) {
  const failures = [];
  let checks = 0;
  const expectOdds = (num) => (num > 0 ? `1/${(machine.denominator / num).toFixed(1)}` : null);
  machine.pressOrders.forEach((pressOrder, order) => {
    machine.settings.forEach((_, setting) => {
      for (let slip = 0; slip <= machine.maxSlip; slip++) {
        for (let position = 1; position <= machine.reel.symbols; position++) {
          const condition = { order, setting, slip, position };
          const row = pressOrder.flagMap[machine.reel.symbols - position]; // 行0 = symbols 番
          const base = judge(machine, condition);
          base.groups.forEach(({ group, hits }, g) => {
            if (!group.showOdds || hits.length === 0) return;
            const names = [...new Set(hits.map((hit) => hit.name))];
            const cases = [[names[0]], names];
            for (const excludedNames of cases) {
              checks++;
              const excluded = new Set(excludedNames.map((name) => `${group.id}/${name}`));
              const result = judge(machine, { ...condition, excluded });
              const rest = machine.flags
                .filter((flag, i) => flag.group === group.id && row[i] === slip && !excludedNames.includes(flag.name))
                .reduce((total, flag) => total + flag.nums[setting], 0);
              const actual = result.groups[g];
              const problems = [];
              if (actual.odds !== expectOdds(rest)) problems.push(`合算 ${actual.odds} (期待値 ${expectOdds(rest)})`);
              actual.hits.forEach((hit, i) => {
                if (hit.percent !== hits[i].percent) problems.push(`${hit.name} の割合 ${hit.percent} (期待値 ${hits[i].percent})`);
                if (hit.excluded !== excludedNames.includes(hit.name)) problems.push(`${hit.name} の excluded が ${hit.excluded}`);
              });
              if (problems.length > 0) {
                failures.push({ key: `${pressOrder.id}|${setting}|${slip}|${position}`, excluded: excludedNames.join(','), problems });
              }
            }
          });
        }
      }
    });
  });
  return { checks, failures };
}
