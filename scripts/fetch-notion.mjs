import { Client } from '@notionhq/client';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { COUNTRY_CODES } from '../src/data/countryCodes.mjs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('NOTION_TOKEN と NOTION_DATABASE_ID を環境変数で指定してください。');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

async function fetchAllPages() {
  const pages = [];
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function getTitle(page) {
  const prop = page.properties['料理名'];
  return prop?.title?.map((t) => t.plain_text).join('') ?? '';
}

function getCountryName(page) {
  return page.properties['国']?.select?.name ?? null;
}

function getDate(page) {
  return page.properties['食べた日']?.date?.start ?? null;
}

function getMemo(page) {
  const prop = page.properties['メモ'];
  return prop?.rich_text?.map((t) => t.plain_text).join('') ?? '';
}

// 「写真」プロパティの最初の1枚だけ使う（複数枚ついていても一覧には1枚で十分なため）。
function getPhotoUrl(page) {
  const file = page.properties['写真']?.files?.[0];
  if (!file) return null;
  return file.file?.url ?? file.external?.url ?? null;
}

const photosDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/photos');
await mkdir(photosDir, { recursive: true });

// Notionのファイル付きURL（type: "file"）は発行から約1時間で失効するため、
// 取得した直後にダウンロードしてリポジトリ内に小さいサムネイルとして保存する。
async function downloadThumbnail(url, pageId) {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`写真のダウンロードに失敗しました（${pageId}）: HTTP ${res.status}`);
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const fileName = `${pageId.replace(/-/g, '')}.jpg`;
  await sharp(buffer)
    .resize(160, 160, { fit: 'cover' })
    .jpeg({ quality: 65 })
    .toFile(path.join(photosDir, fileName));
  return `/photos/${fileName}`;
}

const pages = await fetchAllPages();

const byCountry = new Map();
const unknownCountries = new Set();

for (const page of pages) {
  const countryName = getCountryName(page);
  if (!countryName) continue;

  const photoUrl = getPhotoUrl(page);
  const photo = photoUrl ? await downloadThumbnail(photoUrl, page.id) : null;

  const dish = {
    name: getTitle(page) || '(無題)',
    date: getDate(page),
    memo: getMemo(page),
    photo,
  };

  if (!byCountry.has(countryName)) {
    const code = COUNTRY_CODES[countryName] ?? null;
    if (code === null) unknownCountries.add(countryName);
    byCountry.set(countryName, { name: countryName, code, dishes: [] });
  }
  byCountry.get(countryName).dishes.push(dish);
}

for (const country of byCountry.values()) {
  country.dishes.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

const output = {
  updatedAt: new Date().toISOString(),
  countries: [...byCountry.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja')),
};

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/eaten.json');
await writeFile(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');

console.log(`書き出し完了: ${output.countries.length}カ国 / ${pages.length}件`);
if (unknownCountries.size > 0) {
  console.warn(
    `未対応の国名があります（地図に反映されません）: ${[...unknownCountries].join(', ')}\n` +
      'src/data/countryCodes.mjs に ISO 3166-1 numeric コードを追記してください。'
  );
}
