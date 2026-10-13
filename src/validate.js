// 機種定義の検証
// 行・列の数え間違いなどの編集ミスを、ページを開いた時点で気付けるようにする。

// 制御表で「どの滑りコマ数でも停止しない」ことを表す値
export const NEVER_STOPS = 5;

export function validateMachine(machine) {
  const errors = [];
  const warnings = [];
  const { symbols } = machine.reel;
  const groupIds = new Set(machine.groups.map((group) => group.id));

  machine.flags.forEach((flag) => {
    if (!groupIds.has(flag.group)) errors.push(`flags ${flag.name}: グループ "${flag.group}" が groups にない`);
    if (flag.nums.length !== machine.settings.length) {
      errors.push(`flags ${flag.name}: 置数が ${flag.nums.length} 個 (期待値 ${machine.settings.length})`);
    }
    if (flag.color && !machine.colors?.[flag.color]) errors.push(`flags ${flag.name}: 色 "${flag.color}" が colors にない`);
  });

  const checkMap = (label, rows, columnCount) => {
    if (rows.length !== symbols) errors.push(`${label}: 行数が ${rows.length} (期待値 ${symbols})`);
    rows.forEach((row, i) => {
      if (row.length !== columnCount) errors.push(`${label}[${i}]: 列数が ${row.length} (期待値 ${columnCount})`);
      row.forEach((value, j) => {
        if (!Number.isInteger(value) || value < 0 || value > NEVER_STOPS) {
          errors.push(`${label}[${i}][${j}]: 値 ${value} は 0〜${NEVER_STOPS} の整数ではない`);
        }
      });
    });
  };

  // 同じ名前の列が同じ位置・同じ滑りコマ数で同時に該当すると、同名のバッジが重複して表示される
  const checkDuplicateNames = (label, rows, names) => {
    rows.forEach((row, i) => {
      const seen = new Map();
      row.forEach((value, j) => {
        if (value === NEVER_STOPS) return;
        const key = `${names[j]}@${value}`;
        if (seen.has(key)) warnings.push(`${label}[${i}]: 同名の "${names[j]}" が滑り ${value} コマで重複して該当する`);
        seen.set(key, j);
      });
    });
  };

  machine.pressOrders.forEach((order) => {
    const flagLabel = `pressOrders.${order.id}.flagMap`;
    const prizeLabel = `pressOrders.${order.id}.prizeMap`;
    checkMap(flagLabel, order.flagMap, machine.flags.length);
    checkMap(prizeLabel, order.prizeMap, order.prizeNames.length);
    // 別グループの同名（例: リーチ目役の C1 と重複フラグの C1）は別物として扱う
    checkDuplicateNames(flagLabel, order.flagMap, machine.flags.map((flag) => `${flag.group}/${flag.name}`));
    checkDuplicateNames(prizeLabel, order.prizeMap, order.prizeNames);
  });

  machine.flags.forEach((flag) => {
    flag.colorWhen?.orders?.forEach((id) => {
      if (!machine.pressOrders.some((order) => order.id === id)) errors.push(`flags ${flag.name}: 押し順 "${id}" が pressOrders にない`);
    });
  });

  return { errors, warnings };
}
