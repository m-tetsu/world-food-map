// メンテナンス用スクリプト。地図データ(world-atlas)の対象国が変わった場合のみ再実行する。
// 実行: node scripts/generate-country-codes.mjs
// src/data/countryCodes.mjs を上書きし、Notionの「国」selectに登録すべき
// 選択肢一覧（DDL文字列）を標準出力に表示する。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';
import ja from 'i18n-iso-countries/langs/ja.json' with { type: 'json' };

countries.registerLocale(ja);

// i18n-iso-countries の ja ロケールは正式名称（例: 大韓民国）なので、
// 料理ログという用途にそぐわない一部だけ口語名に置き換える。
const COMMON_NAME_OVERRIDES = {
  KR: '韓国',
  CN: '中国',
  RU: 'ロシア',
  IR: 'イラン',
  VE: 'ベネズエラ',
  BO: 'ボリビア',
  LA: 'ラオス',
  SY: 'シリア',
  BN: 'ブルネイ',
  US: 'アメリカ',
};

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf-8'));
const land = feature(topo, topo.objects.countries).features;

const entries = [];
const unmatched = [];
for (const f of land) {
  const alpha2 = countries.numericToAlpha2(String(f.id));
  const name = alpha2 ? COMMON_NAME_OVERRIDES[alpha2] ?? countries.getName(alpha2, 'ja') : null;
  if (name) {
    entries.push([name, Number(f.id)]);
  } else {
    unmatched.push(`${f.properties.name} (id: ${f.id})`);
  }
}

entries.sort((a, b) => a[0].localeCompare(b[0], 'ja'));

const lines = entries.map(([name, code]) => `  '${name}': ${code},`).join('\n');
const out = `// Notion の「国」select オプション名 → ISO 3166-1 numeric コード
// world-atlas(countries-110m.json)に含まれる国から自動生成。
// 生成: node scripts/generate-country-codes.mjs
export const COUNTRY_CODES = {
${lines}
};
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/countryCodes.mjs');
writeFileSync(outPath, out, 'utf-8');

console.log(`countryCodes.mjs を書き出しました: ${entries.length}カ国`);
if (unmatched.length > 0) {
  console.log(`地図データにはあるがISO名称が引けなかった国（未収録）: ${unmatched.join(', ')}`);
}

const colors = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const ddlOptions = entries
  .map(([name], i) => `'${name}':${colors[i % colors.length]}`)
  .join(', ');
console.log('\n--- Notion DDL (ALTER COLUMN用) ---');
console.log(`ALTER COLUMN "国" SET SELECT(${ddlOptions})`);
