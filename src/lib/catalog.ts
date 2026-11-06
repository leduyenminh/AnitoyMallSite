import videoFile from "../../data/videos.json";
import { categories, collections } from "./config";
import type { Product, Sku, Video } from "./types";

// Pure catalog helpers: availability, search, filters, sorting and the shop's TikTok videos.

export const activeProducts = (products: Product[]) => products.filter((p) => p.status === "active");

export const totalStock = (p: Product) => p.skus.reduce((n, s) => n + s.stock, 0);
export const isSoldOut = (p: Product) => totalStock(p) <= 0;

/** Units sold on TikTok Shop plus units sold on this website. */
export const unitsSold = (p: Product) => (p.tiktokSold ?? 0) + (p.siteSold ?? 0);

/** Cheapest SKU in stock (or cheapest overall when sold out): what a card shows. */
export function leadSku(p: Product): Sku | undefined {
	const pool = p.skus.filter((s) => s.stock > 0);
	return [...(pool.length ? pool : p.skus)].sort((a, b) => a.price - b.price)[0];
}

export function priceRange(p: Product): { min: number; max: number } {
	const prices = p.skus.map((s) => s.price);
	return { min: Math.min(...prices), max: Math.max(...prices) };
}

export const collectionName = (slug: string) => collections[slug]?.name ?? slug;
export const categoryName = (slug: string) => categories[slug]?.name ?? slug;

/** Lower-case, no diacritics, đ → d: "Móc khoá" and "moc khoa" match. */
export function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036F]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.toLowerCase();
}

function haystack(p: Product): string {
	return fold([p.title, p.tags.join(" "), collectionName(p.collection), categoryName(p.category), p.skus.map((s) => s.name).join(" ")].join(" "));
}

export function search(products: Product[], query: string): Product[] {
	const terms = fold(query).split(/\s+/).filter(Boolean);
	if (!terms.length) return products;
	return products
		.map((p) => {
			const text = haystack(p);
			const title = fold(p.title);
			const hits = terms.filter((t) => text.includes(t)).length;
			return { p, score: hits === terms.length ? hits * 2 + terms.filter((t) => title.includes(t)).length : 0 };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((x) => x.p);
}

export type SortKey = "featured" | "bestselling" | "price-asc" | "price-desc" | "newest";

export const sortLabels: Record<SortKey, string> = {
	featured: "Nổi bật",
	bestselling: "Bán chạy",
	newest: "Mới nhất",
	"price-asc": "Giá thấp → cao",
	"price-desc": "Giá cao → thấp",
};

export function sortProducts(products: Product[], sort: SortKey, videos: Map<string, Video>): Product[] {
	const list = [...products];
	const price = (p: Product) => leadSku(p)?.price ?? 0;
	const soldOutLast = (a: Product, b: Product) => Number(isSoldOut(a)) - Number(isSoldOut(b));
	const popularity = (p: Product) => p.videoIds.reduce((n, id) => n + (videos.get(id)?.views ?? 0), 0);
	const by: Record<SortKey, (a: Product, b: Product) => number> = {
		featured: (a, b) => soldOutLast(a, b) || b.featured - a.featured || popularity(b) - popularity(a),
		bestselling: (a, b) => soldOutLast(a, b) || unitsSold(b) - unitsSold(a) || popularity(b) - popularity(a),
		newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
		"price-asc": (a, b) => soldOutLast(a, b) || price(a) - price(b),
		"price-desc": (a, b) => soldOutLast(a, b) || price(b) - price(a),
	};
	return list.sort(by[sort]);
}

export interface Filters {
	q?: string;
	collection?: string;
	category?: string;
	inStock?: boolean;
	minPrice?: number;
	maxPrice?: number;
	sort: SortKey;
}

export function applyFilters(products: Product[], f: Filters, videos: Map<string, Video>): Product[] {
	let list = activeProducts(products);
	if (f.collection) list = list.filter((p) => p.collection === f.collection);
	if (f.category) list = list.filter((p) => p.category === f.category);
	if (f.inStock) list = list.filter((p) => !isSoldOut(p));
	if (f.minPrice !== undefined) list = list.filter((p) => (leadSku(p)?.price ?? 0) >= f.minPrice!);
	if (f.maxPrice !== undefined) list = list.filter((p) => (leadSku(p)?.price ?? 0) <= f.maxPrice!);
	if (f.q) return search(list, f.q); // relevance order
	return sortProducts(list, f.sort, videos);
}

export function relatedProducts(product: Product, products: Product[], videos: Map<string, Video>, limit = 8): Product[] {
	const others = activeProducts(products).filter((p) => p.id !== product.id);
	const same = others.filter((p) => p.collection === product.collection || p.category === product.category);
	const rest = others.filter((p) => !same.includes(p));
	return [...sortProducts(same, "featured", videos), ...sortProducts(rest, "featured", videos)].slice(0, limit);
}

// ------------------------------------------------------------------ TikTok videos

/** TikTok video ids carry their creation time in the upper 32 bits (Unix seconds). */
export function videoUploadedAt(id: string): string {
	try {
		return new Date(Number(BigInt(id) >> 32n) * 1000).toISOString();
	} catch {
		return new Date(0).toISOString();
	}
}

const videoData = videoFile as { snapshot: string; videos: { id: string; title: string; views: number; pinned?: boolean }[] };

export const videosSnapshot = videoData.snapshot;

export const videos: Video[] = videoData.videos.map((v) => ({
	...v,
	cover: `/media/v/${v.id}.webp`,
	uploadedAt: videoUploadedAt(v.id),
}));

export const videoById = new Map(videos.map((v) => [v.id, v]));

export function productVideos(p: Product): Video[] {
	return p.videoIds
		.map((id) => videoById.get(id))
		.filter((v): v is Video => Boolean(v))
		.sort((a, b) => b.views - a.views);
}

export const productViews = (p: Product) => productVideos(p).reduce((n, v) => n + v.views, 0);

export const tiktokVideoUrl = (id: string, handle = "leduyenminh") => `https://www.tiktok.com/@${handle}/video/${id}`;
