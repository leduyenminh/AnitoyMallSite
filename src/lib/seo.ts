import { categoryName, collectionName, leadSku, productVideos } from "./catalog";
import { site, type Settings } from "./config";
import { type Lang, LANGS, locales, routes, X_DEFAULT } from "./i18n";
import { formatVnd } from "./money";
import { shippingFor } from "./quote";
import { englishSlug, localizeProduct } from "./translations";
import type { Product, Sku } from "./types";

// Structured data (JSON-LD), the Google Merchant Center feeds and the sitemaps. The feed and the
// product pages are built from the same facts (price, stock, shipping, returns) because Google
// disapproves items whose feed and landing page disagree. English pages and the English feed carry
// the same prices (VND), stock and shipping (Vietnam only) as the Vietnamese ones; only text and
// links differ.

export const absoluteUrl = (s: Settings, path: string) => (/^https?:\/\//i.test(path) ? path : `${s.siteUrl}${path.startsWith("/") ? "" : "/"}${path}`);

export const productPath = (p: Pick<Product, "id" | "slug">, lang: Lang = "vi") => `${routes[lang].product}/${lang === "en" ? englishSlug(p) : p.slug}`;
export const collectionPath = (slug: string, lang: Lang = "vi") => `${routes[lang].collection}/${slug}`;
export const categoryPath = (slug: string, lang: Lang = "vi") => `${routes[lang].category}/${slug}`;

/** Resized image through Cloudflare Images when enabled on the zone, else the original. */
export function imageSrc(s: Settings, src: string, width: number): string {
	if (!s.imageResizing || !src.startsWith("/")) return src;
	return `/cdn-cgi/image/width=${width},quality=82,format=auto${src}`;
}

export function deliveryDays(eta: string): { min: number; max: number } {
	const days = eta.match(/\d+/g)?.map(Number) ?? [2, 5];
	return { min: Math.min(...days), max: Math.max(...days) };
}

const hasVariants = (p: Product) => p.skus.length > 1;
/** Id shared by the feed item and the JSON-LD `sku`, so Google pairs them. */
export const merchantItemId = (p: Product, sku: Sku) => (hasVariants(p) ? sku.id : p.id);

function skuUrl(s: Settings, p: Product, sku: Sku | undefined, lang: Lang) {
	const url = absoluteUrl(s, productPath(p, lang));
	return sku && hasVariants(p) ? `${url}?sku=${encodeURIComponent(sku.id)}` : url;
}

function images(s: Settings, p: Product, sku?: Sku): string[] {
	return [...new Set([...(sku?.image ? [sku.image] : []), ...p.images].map((src) => absoluteUrl(s, src)))];
}

function offer(s: Settings, p: Product, sku: Sku, lang: Lang) {
	const days = deliveryDays(s.shipping.eta);
	return {
		"@type": "Offer",
		url: skuUrl(s, p, sku, lang),
		price: sku.price,
		priceCurrency: site.currency,
		availability: sku.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
		itemCondition: "https://schema.org/NewCondition",
		seller: { "@type": "Organization", name: site.name },
		shippingDetails: {
			"@type": "OfferShippingDetails",
			shippingRate: { "@type": "MonetaryAmount", value: shippingFor(sku.price, s.shipping), currency: site.currency },
			shippingDestination: { "@type": "DefinedRegion", addressCountry: site.country },
			deliveryTime: {
				"@type": "ShippingDeliveryTime",
				handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
				transitTime: { "@type": "QuantitativeValue", minValue: days.min, maxValue: days.max, unitCode: "DAY" },
			},
		},
		hasMerchantReturnPolicy: {
			"@type": "MerchantReturnPolicy",
			applicableCountry: site.country,
			...(s.returnDays > 0
				? {
						returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
						merchantReturnDays: s.returnDays,
						returnMethod: "https://schema.org/ReturnByMail",
						returnFees: "https://schema.org/FreeReturn",
					}
				: { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" }),
		},
	};
}

/** Product / ProductGroup for the product page in `lang` (`source` is the product as stored). */
export function productJsonLd(s: Settings, source: Product, lang: Lang = "vi") {
	const p = localizeProduct(source, lang);
	const brand = { "@type": "Brand", name: site.shortName };
	const category = `${categoryName(p.category, lang)} > ${collectionName(p.collection, lang)}`;
	const videos = productVideos(p)
		.slice(0, 3)
		.map((v) => ({
			"@type": "VideoObject",
			name: v.title || p.title,
			description: v.title || p.title,
			thumbnailUrl: absoluteUrl(s, v.cover),
			uploadDate: v.uploadedAt,
			embedUrl: `https://www.tiktok.com/player/v1/${v.id}`,
			url: `https://www.tiktok.com/@${site.tiktok.handle}/video/${v.id}`,
		}));
	const base = {
		"@context": "https://schema.org",
		name: p.title,
		description: p.description.slice(0, 5000),
		image: images(s, p),
		brand,
		category,
		url: absoluteUrl(s, productPath(p, lang)),
		...(videos.length ? { subjectOf: videos } : {}),
	};
	if (!hasVariants(p)) {
		const sku = p.skus[0]!;
		return { ...base, "@type": "Product", sku: merchantItemId(p, sku), offers: offer(s, p, sku, lang) };
	}
	return {
		...base,
		"@type": "ProductGroup",
		productGroupID: p.id,
		variesBy: ["https://schema.org/pattern"],
		hasVariant: p.skus.map((sku) => ({
			"@type": "Product",
			name: `${p.title} - ${sku.name}`,
			sku: merchantItemId(p, sku),
			pattern: sku.name,
			image: images(s, p, sku)[0],
			offers: offer(s, p, sku, lang),
		})),
	};
}

export function breadcrumbJsonLd(s: Settings, items: { name: string; path: string }[]) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: absoluteUrl(s, item.path) })),
	};
}

export function storeJsonLd(s: Settings, lang: Lang = "vi") {
	const home = lang === "vi" ? `${s.siteUrl}/` : absoluteUrl(s, routes[lang].home);
	return [
		{
			"@context": "https://schema.org",
			"@type": "OnlineStore",
			"@id": `${s.siteUrl}/#store`,
			name: site.name,
			url: `${s.siteUrl}/`,
			logo: absoluteUrl(s, "/media/icon-512.png"),
			sameAs: [site.tiktok.profileUrl],
			...(s.contact.phone || s.contact.email
				? {
						contactPoint: {
							"@type": "ContactPoint",
							contactType: "customer service",
							areaServed: site.country,
							availableLanguage: ["vi"],
							...(s.contact.phone ? { telephone: s.contact.phone } : {}),
							...(s.contact.email ? { email: s.contact.email } : {}),
						},
					}
				: {}),
		},
		{
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: site.name,
			url: home,
			inLanguage: lang === "vi" ? "vi-VN" : locales[lang].html,
			potentialAction: {
				"@type": "SearchAction",
				target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl(s, routes[lang].search)}?q={search_term_string}` },
				"query-input": "required name=search_term_string",
			},
		},
	];
}

export function itemListJsonLd(s: Settings, products: Product[], lang: Lang = "vi") {
	return {
		"@context": "https://schema.org",
		"@type": "ItemList",
		itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(s, productPath(p, lang)) })),
	};
}

export function faqJsonLd(faq: { q: string; a: string }[]) {
	return {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
	};
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

// ------------------------------------------------------------------ Google Merchant Center feed

// Characters XML 1.0 cannot carry (control codes, lone surrogates) are dropped.
const INVALID_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
export const escapeXml = (text: string) =>
	text.replace(INVALID_XML, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const truncate = (text: string, max: number) => {
	const chars = [...text];
	return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
};

/**
 * RSS 2.0 with the g: namespace. One item per SKU; variants share item_group_id. The English feed
 * (`lang` "en") links to the English pages and still targets Vietnam: same ids, prices, stock and
 * shipping as the Vietnamese feed.
 */
export function googleFeed(s: Settings, products: Product[], lang: Lang = "vi"): string {
	const items = products
		.filter((p) => p.status === "active")
		.map((p) => localizeProduct(p, lang))
		.flatMap((p) =>
			p.skus
				.filter((sku) => sku.price > 0)
				.map((sku) => {
					const [imageLink, ...more] = images(s, p, sku);
					if (!imageLink) return "";
					const variant = hasVariants(p) ? truncate(sku.name, 100) : undefined;
					const suffix = variant ? ` - ${variant}` : "";
					const fields: [string, string | undefined][] = [
						["id", merchantItemId(p, sku)],
						["item_group_id", variant ? p.id : undefined],
						["title", truncate(p.title, 150 - [...suffix].length) + suffix],
						["description", truncate(p.description.trim() || p.title, 5000)],
						["link", skuUrl(s, p, sku, lang)],
						["image_link", imageLink],
						...more.slice(0, 10).map((src): [string, string] => ["additional_image_link", src]),
						["availability", sku.stock > 0 ? "in_stock" : "out_of_stock"],
						["price", `${sku.price} ${site.currency}`],
						["condition", "new"],
						["brand", site.shortName],
						["identifier_exists", "no"],
						["pattern", variant],
						["google_product_category", "Toys & Games > Toys > Dolls, Playsets & Toy Figures > Action & Toy Figures"],
						["product_type", `${categoryName(p.category, lang)} > ${collectionName(p.collection, lang)}`],
					];
					const lines = fields.filter(([, v]) => v !== undefined).map(([k, v]) => `  <g:${k}>${escapeXml(v!)}</g:${k}>`);
					const shipping = `  <g:shipping><g:country>${site.country}</g:country><g:price>${shippingFor(sku.price, s.shipping)} ${site.currency}</g:price></g:shipping>`;
					return ["<item>", ...lines, shipping, "</item>"].join("\n");
				}),
		)
		.filter(Boolean);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
		"<channel>",
		`<title>${escapeXml(site.name)}</title>`,
		`<link>${escapeXml(lang === "vi" ? `${s.siteUrl}/` : absoluteUrl(s, routes[lang].home))}</link>`,
		`<description>${escapeXml(lang === "vi" ? site.tagline : site.taglineEn)}</description>`,
		...items,
		"</channel>",
		"</rss>",
		"",
	].join("\n");
}

// ------------------------------------------------------------------ sitemap

export interface SitemapEntry {
	path: string;
	lastmod?: string;
	images?: string[];
	/** The page in every language (including this one), listed as hreflang alternates. */
	alternates?: Record<Lang, string>;
}

export function sitemapXml(s: Settings, entries: SitemapEntry[]): string {
	const link = (hreflang: string, path: string) => `  <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(absoluteUrl(s, path))}"/>`;
	const urls = entries.map((e) =>
		[
			"<url>",
			`  <loc>${escapeXml(absoluteUrl(s, e.path))}</loc>`,
			...(e.lastmod ? [`  <lastmod>${e.lastmod.slice(0, 10)}</lastmod>`] : []),
			...(e.alternates ? [...LANGS.map((l) => link(locales[l].html, e.alternates![l])), link("x-default", e.alternates[X_DEFAULT])] : []),
			...(e.images ?? []).slice(0, 10).map((src) => `  <image:image><image:loc>${escapeXml(absoluteUrl(s, src))}</image:loc></image:image>`),
			"</url>",
		].join("\n"),
	);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
		...urls,
		"</urlset>",
		"",
	].join("\n");
}

/** Meta description: the start of the plain-text description plus the price, ≤ ~160 chars. */
export function metaDescription(source: Product, lang: Lang = "vi"): string {
	const p = localizeProduct(source, lang);
	const sku = leadSku(p);
	const text = p.description.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim();
	const price = !sku || sku.price <= 0 ? "" : lang === "vi" ? ` Giá ${sku.price.toLocaleString("vi-VN")}₫.` : ` Price ${formatVnd(sku.price, lang)}.`;
	return truncate(text || p.title, 158 - price.length) + price;
}
