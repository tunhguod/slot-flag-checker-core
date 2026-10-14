# slot-flag-checker-core

パチスロのリール制御（第1停止）からフラグを判別する Web ツールの共通部分です。
判定ロジックと画面（リール・条件パネル・判別結果・画面サイズへの追従）を提供し、機種ごとのリポジトリは「機種定義」を渡すだけで判別ページを作れます。

利用している機種リポジトリ:

- [HRFlagChk](https://github.com/tunhguod/HRFlagChk)（ハイパラ）
- [DUURFlagChk](https://github.com/tunhguod/DUURFlagChk)（ディスクアップ ULTRAREMIX）

## 構成

```
src/
├── checker.js    mountChecker(): 機種定義から判別画面を組み立てる
├── checker.css   画面のスタイル（checker.js が自動で読み込む）
├── judge.js      判定ロジック（画面に依存しない）
├── validate.js   機種定義の検証
└── testing.js    正解データとの照合
test/
└── index.html    リリース前テスト（全機種の照合）
```

ビルドは不要です。ES モジュールのまま配信します。

## 機種リポジトリでの使い方

機種リポジトリには次のファイルを置きます（[HRFlagChk](https://github.com/tunhguod/HRFlagChk) が実例です）。

```
index.html        判別ページ
core.js           コアの読み込み元（バージョンはここで指定）
machine.js        機種定義
img/              リール画像
test.html         照合テスト
test/golden.json  正解データ
```

コアは [jsDelivr](https://www.jsdelivr.com/) 経由で、タグを指定して読み込みます。

```js
// core.js
const CORE_VERSION = '1.0.0';
const coreBase = new URL(`https://cdn.jsdelivr.net/gh/tunhguod/slot-flag-checker-core@${CORE_VERSION}/src/`);
export function importCore(file) {
  return import(new URL(file, coreBase).href);
}
```

```html
<!-- index.html -->
<div id="app"></div>
<script type="module">
  import { importCore } from './core.js';
  import machine from './machine.js';
  const { mountChecker } = await importCore('checker.js');
  await mountChecker(document.getElementById('app'), machine);
</script>
```

バージョンを固定しているので、コアを更新しても、機種リポジトリ側で `CORE_VERSION` を上げるまでは影響しません。

## 機種定義

`machine.js` は次の形のオブジェクトを `export default` します。

```js
export default {
  id: 'hyper-rush',            // 機種ID（テスト結果の表示などに使う）
  reel: {
    symbols: 21,               // リールのコマ数
    viewHeight: 320,           // リール窓の高さ (px)。幅はリール画像の幅になる
    offsetY: 25,               // 図柄を窓の中央に寄せるための表示オフセット (px)
    referenceRow: 1,           // 押下位置 = 表示中の位置 - referenceRow - 滑りコマ数
  },
  settings: [1, 2, 3, 4, 5, 6], // 設定の表示名。flags[].nums はこの並びに対応する
  maxSlip: 4,                  // 最大滑りコマ数
  denominator: 65536,          // 置数の分母（フラグ合算 1/x の計算に使う）
  colors: { red: '#a62828' },  // バッジの色（キー → 色）。色は小文字の #rrggbb で書く
  groups: [                    // 判別結果のグループ（表示順）
    { id: 'BB', label: 'フラグ (BB)', showOdds: true }, // showOdds: フラグ合算を表示するか
  ],
  flags: [                     // フラグ（列の並び順。制御表の列に対応する）
    {
      name: 'H2',              // 表示名
      group: 'BB',             // groups[].id
      nums: [4, 4, 4, 4, 4, 4], // 設定ごとの置数
      color: 'red',            // 省略可。colors のキー
      colorWhen: {             // 省略可。この条件のときだけ color を付ける
        orders: ['left'],      //   押し順（pressOrders[].id）
        positions: [[1, 8], [14, 21]], // 押下位置の範囲
      },
    },
  ],
  pressOrders: [               // 押し順（2つ以上あると切り替えスイッチを表示）
    {
      id: 'left',
      label: '左1st',
      reelImage: new URL('./img/reel.png', import.meta.url).href, // リール画像（縦に1周分）
      flagMap: [ /* 行: リール位置, 列: flags の並び */ ],
      prizeNames: ['ハズレ', '🔔'],
      prizeMap: [ /* 行: リール位置, 列: prizeNames の並び */ ],
    },
  ],
  links: [                     // 省略可。判別結果の下に出すリンク
    { label: '制御表', text: 'スプレッドシートを開く', url: 'https://…' },
  ],
  contact: { text: '@account', url: 'https://x.com/account' }, // 省略可。問い合わせ先
};
```

### 制御表（flagMap / prizeMap）

- 行はリール位置です。**行0 = symbols 番、最終行 = 1 番** の順に並べます。
- 値は、そのフラグ（小役）で停止する滑りコマ数（0〜4）です。**5 は「どの滑りコマ数でも停止しない」** を表します。
- 1コマの高さは、リール画像の高さ ÷ symbols で計算します。画像は図柄ちょうど1周分にしてください。

### 判別結果の割合

各フラグの割合は、**全グループの該当フラグの置数合計**に対する比率です。

### 定義の検証

ページを開いたときに、行数・列数・置数の数・色の指定などを検証し、問題があればブラウザのコンソールに表示します。
同じグループの同名フラグ（例: 2通りの制御を持つフラグ）が同じ位置・同じ滑りコマ数で同時に該当する場合は警告を出します。

## 手元での確認

コアと機種リポジトリを同じフォルダに並べ、その親フォルダを簡易サーバーで配信します。

```
作業フォルダ/
├── slot-flag-checker-core/
├── HRFlagChk/
└── DUURFlagChk/
```

```bash
py -m http.server 8000
```

- 機種ページを手元のコアで開く: http://localhost:8000/HRFlagChk/?core=local
  （`?core=local` は localhost のときだけ有効です。付けなければ jsDelivr のコアを使います）
- リリース前テスト: http://localhost:8000/slot-flag-checker-core/test/

ES モジュールを使うため、`index.html` をファイルとして直接開いても動きません。

## 正解データ（test/golden.json）

各機種リポジトリの `test/golden.json` は、コア導入前の版の画面を全状態操作して記録した判定結果です。
`test.html`（機種リポジトリ）と `test/index.html`（このリポジトリ）は、コアの判定結果をこれと照合します。

- キー: `押し順ID|設定のインデックス|滑りコマ数|押下位置`
- 値: `グループID=名前:割合:色,…|フラグ合算;…;P=小役`（色なしは `-`。フラグ合算は showOdds のグループのみ）

制御表を意図して変更した場合は、正解データも作り直す必要があります。

## リリース手順

1. 手元で `test/index.html` を開き、全機種が PASS になることを確認する
2. コミットして push し、タグを付ける（例: `git tag v1.0.1 && git push origin v1.0.1`）
3. jsDelivr のキャッシュを温める。新しいタグのファイルは初回の取得だけ1ファイル数秒かかり、そのままだと最初に開いた人のページ表示が10秒以上遅れるため、先に一度取得しておく
   ```bash
   for f in checker.js checker.css judge.js validate.js testing.js; do curl -s -o /dev/null -w "$f %{http_code}\n" "https://cdn.jsdelivr.net/gh/tunhguod/slot-flag-checker-core@1.0.1/src/$f"; done
   ```
4. 各機種リポジトリの `core.js` の `CORE_VERSION` を上げ、`index.html` の `core.js?v=` の数字も上げる。`test.html` と判別ページで動作を確認してから push する

jsDelivr はタグ単位でファイルを長期間キャッシュします。**一度公開したタグは付け直さず**、修正は新しいバージョンとして出してください。
