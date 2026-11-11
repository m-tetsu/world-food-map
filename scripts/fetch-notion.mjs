import { Client } from '@notionhq/client';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import convertHeic from 'heic-convert';
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

// sharpの標準ビルドはHEIC(iPhoneの既定フォーマット)を直接デコードできないため、
// 失敗したら heic-convert (純JS/WASM、ネイティブビルド不要) でJPEGに変換してから渡す。
// 注意: metadata()はHEICでもヘッダーだけ読めて成功してしまうため判定に使えない。
// 実際にピクセルをデコードする小さなresizeを試し、それが失敗するかどうかで判定する。
async function ensureSharpDecodable(buffer) {
  try {
    await sharp(buffer).resize(16, 16).toBuffer();
    return buffer;
  } catch (err) {
    if (!/heif|unsupported image format/i.test(String(err.message))) throw err;
    return Buffer.from(await convertHeic({ buffer, format: 'JPEG', quality: 0.9 }));
  }
}

// Notionのファイル付きURL（type: "file"）は発行から約1時間で失効するため、
// 取得した直後にダウンロードしてリポジトリ内に保存する。一覧用の正方形サムネイルと、
// クリック時の拡大表示用（アスペクト比そのまま・長辺800px）の2サイズを作る。
// 1件の写真処理に失敗しても他の記録の更新を止めないよう、呼び出し側で例外を握りつぶす。
async function downloadThumbnail(url, pageId) {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`写真のダウンロードに失敗しました（${pageId}）: HTTP ${res.status}`);
    return null;
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const decodable = await ensureSharpDecodable(raw);

  const id = pageId.replace(/-/g, '');
  const thumbName = `${id}.jpg`;
  const largeName = `${id}-large.jpg`;

  const thumb = await sharp(decodable).resize(160, 160, { fit: 'cover' }).jpeg({ quality: 65 }).toBuffer();
  await writeFile(path.join(photosDir, thumbName), thumb);

  const large = await sharp(decodable)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();
  await writeFile(path.join(photosDir, largeName), large);

  return { thumb: `/photos/${thumbName}`, large: `/photos/${largeName}` };
}

const pages = await fetchAllPages();

const byCountry = new Map();
const unknownCountries = new Set();

for (const page of pages) {
  const countryName = getCountryName(page);
  if (!countryName) continue;

  const photoUrl = getPhotoUrl(page);
  let photos = null;
  if (photoUrl) {
    try {
      photos = await downloadThumbnail(photoUrl, page.id);
    } catch (err) {
      console.warn(`写真の処理に失敗しました（${page.id}）: ${err.message}`);
    }
  }

  const dish = {
    name: getTitle(page) || '(無題)',
    date: getDate(page),
    memo: getMemo(page),
    photo: photos?.thumb ?? null,
    photoLarge: photos?.large ?? null,
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
