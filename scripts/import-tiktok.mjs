// Clones the shop's TikTok Shop listings into the website catalog.
//
//   npm run import            fetch every listing in data/listings.json
//   npm run import -- 1731…   fetch only the given TikTok product ids
//
// For each listing it reads the public product page (the same JSON TikTok renders the page from):
// title, description, specifications, photos, SKUs with price, list price and stock, rating and
// units sold. Photos are downloaded into public/media/p so the site serves its own copies.
// Video covers come from TikTok's public oEmbed API. Output: src/data/catalog.json.
//
// A listing that cannot be read (network error, TikTok security check) keeps its previous entry,
// so a partial run never removes products.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LISTINGS = join(root, "data", "listings.json");
const VIDEOS = join(root, "data", "videos.json");
const OUT = join(root, "src", "data", "catalog.json");
const PHOTOS = join(root, "public", "media", "p");
const COVERS = join(root, "public", "media", "v");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const TIKTOK_HANDLE = "leduyenminh";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const int = (value) => {
  const n = Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

async function download(url, file) {
  if (existsSync(file)) return true;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) return false;
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

function routerData(html) {
  const m = html.match(/<script type="application\/json" id="__MODERN_ROUTER_DATA__">([\s\S]*?)<\/script>/);
  if (!m) return null;
  const data = JSON.parse(m[1]);
  const page = Object.values(data.loaderData ?? {}).find((v) => v?.page_config);
  const comp = Object.values(page?.page_config?.components_map ?? {}).find((c) => c?.component_data?.product_info)?.component_data;
  return comp ?? null;
}

async function fetchListing(id) {
  const res = await fetch(`https://shop.tiktok.com/vn/pdp/${id}`, {
    headers: { "user-agent": UA, "accept-language": "vi-VN,vi;q=0.9" },
    redirect: "follow",
  });
  const html = await res.text();
  const comp = routerData(html);
  if (!comp?.product_info?.skus?.length) {
    throw new Error(/security check|captcha/i.test(html) ? "TikTok security check" : `no product data (HTTP ${res.status})`);
  }
  return { comp, url: res.url.split("?")[0] };
}

/** Plain-text description: text blocks as paragraphs, bulleted ("ul") blocks as "• " lines. */
function describe(blocks) {
  return (blocks ?? [])
    .map((b) => {
      if (b.type === "text") return b.text?.trim() ?? "";
      if (b.type === "ul") return (b.content ?? []).map((line) => String(line).trim()).filter(Boolean).map((line) => `• ${line}`).join("\n");
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function importListing(entry) {
  const id = entry.tiktokProductId;
  const { comp, url } = await fetchListing(id);
  const info = comp.product_info;

  const images = [];
  for (const [i, img] of info.images.entries()) {
    const file = `${id}-${i + 1}.webp`;
    if (await download(img.url_list[0], join(PHOTOS, file))) images.push(`/media/p/${file}`);
  }

  // Each sale property value (e.g. the character) may carry its own photo.
  const propImages = new Map();
  for (const prop of info.sale_props ?? []) {
    for (const value of prop.sale_prop_values ?? []) {
      if (!value.image?.url_list?.length) continue;
      const file = `${id}-o${value.prop_value_id}.webp`;
      if (await download(value.image.url_list[0], join(PHOTOS, file))) propImages.set(value.prop_value_id, `/media/p/${file}`);
    }
  }

  const skus = info.skus.map((sku, i) => {
    const props = sku.sku_sale_props ?? [];
    const price = int(sku.price?.sale_price_decimal);
    const listPrice = int(sku.price?.origin_price_decimal);
    const image = props.map((p) => propImages.get(p.prop_value_id)).find(Boolean);
    return {
      id: `tt-${sku.sku_id}`,
      tiktokSkuId: sku.sku_id,
      name: props.map((p) => p.prop_value).join(" / ") || "Tiêu chuẩn",
      price,
      ...(listPrice > price ? { compareAtPrice: listPrice } : {}),
      stock: Math.max(0, int(sku.stock)),
      position: i,
      ...(image ? { image } : {}),
    };
  });

  const description = describe(info.desc_blocks);

  const attributes = (info.specifications ?? [])
    .filter((s) => s.value && !/^none$/i.test(s.value.trim()))
    .map((s) => ({ name: s.name, value: s.value }));

  return {
    id: `tt-${id}`,
    slug: entry.slug,
    status: "active",
    title: info.title,
    description,
    images,
    collection: entry.collection,
    category: entry.category,
    tags: entry.tags ?? [],
    attributes,
    featured: entry.featured ?? 0,
    tiktokProductId: id,
    tiktokUrl: url,
    tiktokCategory: (comp.categories ?? []).map((c) => c.category_name),
    tiktokRating: info.review?.product_rating
      ? { value: Number(info.review.product_rating), count: int(info.review.review_count) }
      : undefined,
    tiktokSold: int(info.sold_count),
    videoIds: entry.videoIds ?? [],
    skus,
  };
}

/** Items only seen in videos: hidden drafts until the seller sets a real price in /admin. */
function videoOnlyProduct(entry) {
  const variants = entry.variants?.length ? entry.variants : ["Tiêu chuẩn"];
  return {
    id: entry.id,
    slug: entry.slug,
    status: "draft",
    title: entry.title,
    description: entry.description,
    images: entry.imageVideoIds.map((v) => `/media/v/${v}-square.webp`),
    collection: entry.collection,
    category: entry.category,
    tags: entry.tags ?? [],
    attributes: entry.attributes ?? [],
    featured: entry.featured ?? 0,
    videoIds: entry.videoIds ?? [],
    skus: variants.map((name, i) => ({ id: `${entry.id}-${i + 1}`, name, price: 0, stock: 0, position: i })),
  };
}

async function importVideos(videoIds) {
  const file = readJson(VIDEOS, { videos: [] });
  const known = new Set(file.videos.map((v) => v.id));
  for (const id of videoIds) {
    const cover = join(COVERS, `${id}.webp`);
    if (known.has(id) && existsSync(cover)) continue;
    try {
      const res = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@${TIKTOK_HANDLE}/video/${id}`)}`,
      );
      const meta = await res.json();
      if (meta.thumbnail_url) await download(meta.thumbnail_url, cover);
      if (!known.has(id)) {
        file.videos.push({ id, views: 0, title: meta.title ?? "" });
        known.add(id);
      }
      console.log(`  video ${id}: ${meta.title ? "ok" : "no metadata"}`);
    } catch (error) {
      console.warn(`  video ${id}: ${error.message}`);
    }
    await sleep(400);
  }
  writeFileSync(VIDEOS, JSON.stringify(file, null, 2) + "\n");
}

async function main() {
  mkdirSync(PHOTOS, { recursive: true });
  mkdirSync(COVERS, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });

  const { listings, shopUrl } = readJson(LISTINGS, { listings: [] });
  const only = new Set(process.argv.slice(2));
  const previous = new Map(readJson(OUT, { products: [] }).products.map((p) => [p.id, p]));
  const products = [];
  let failed = 0;

  for (const entry of listings) {
    if (entry.videoOnly) {
      products.push(previous.get(entry.id) ?? videoOnlyProduct(entry));
      continue;
    }
    const key = `tt-${entry.tiktokProductId}`;
    if (only.size && !only.has(entry.tiktokProductId)) {
      if (previous.has(key)) products.push(previous.get(key));
      continue;
    }
    try {
      const product = await importListing(entry);
      products.push(product);
      console.log(`✓ ${entry.tiktokProductId} ${product.skus.length} SKU, ${product.images.length} photos – ${product.title.slice(0, 60)}`);
    } catch (error) {
      failed++;
      console.warn(`✗ ${entry.tiktokProductId}: ${error.message}${previous.has(key) ? " (kept previous data)" : ""}`);
      if (previous.has(key)) products.push(previous.get(key));
    }
    await sleep(1200);
  }

  await importVideos([...new Set(listings.flatMap((l) => [...(l.videoIds ?? []), ...(l.imageVideoIds ?? [])]))]);

  writeFileSync(
    OUT,
    JSON.stringify({ importedAt: new Date().toISOString(), source: shopUrl, products }, null, 2) + "\n",
  );
  console.log(`\nWrote ${products.length} products to src/data/catalog.json${failed ? ` (${failed} listings failed)` : ""}.`);
  if (failed) process.exitCode = 1;
}

await main();
