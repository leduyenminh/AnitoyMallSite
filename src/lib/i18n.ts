// Languages of the storefront: Vietnamese at the root, English under /en. Each page exists in
// both, at the paths below; hreflang links tie them together and x-default points to English.
// /admin, the APIs and the webhooks have one language-neutral path.

export type Lang = "vi" | "en";
export const LANGS = ["vi", "en"] as const satisfies readonly Lang[];

export const locales: Record<Lang, { html: string; og: string; intl: string }> = {
	vi: { html: "vi", og: "vi_VN", intl: "vi-VN" },
	en: { html: "en", og: "en_US", intl: "en-GB" },
};

/** Searchers whose language has no version of its own get English. */
export const X_DEFAULT: Lang = "en";

export const otherLang = (lang: Lang): Lang => (lang === "vi" ? "en" : "vi");

/** Everything under /en is English. */
export const langOf = (pathname: string): Lang => (pathname === "/en" || pathname.startsWith("/en/") ? "en" : "vi");

/** Page paths; product, collection, category and order are prefixes followed by "/<slug or id>". */
export const routes = {
	vi: {
		home: "/",
		products: "/san-pham",
		product: "/san-pham",
		collection: "/bo-suu-tap",
		category: "/danh-muc",
		search: "/tim-kiem",
		videos: "/video",
		help: "/ho-tro",
		policy: "/chinh-sach",
		about: "/gioi-thieu",
		lookup: "/tra-cuu-don-hang",
		cart: "/gio-hang",
		checkout: "/thanh-toan",
		order: "/don-hang",
	},
	en: {
		home: "/en",
		products: "/en/products",
		product: "/en/products",
		collection: "/en/collections",
		category: "/en/categories",
		search: "/en/search",
		videos: "/en/videos",
		help: "/en/help",
		policy: "/en/policies",
		about: "/en/about",
		lookup: "/en/track-order",
		cart: "/en/cart",
		checkout: "/en/checkout",
		order: "/en/orders",
	},
} as const satisfies Record<Lang, Record<string, string>>;

export type PageKey = keyof (typeof routes)["vi"];

/** Section anchors on the policy page. */
export const policyAnchors: Record<Lang, Record<"shipping" | "returns" | "payment" | "privacy", string>> = {
	vi: { shipping: "giao-hang", returns: "doi-tra", payment: "thanh-toan", privacy: "bao-mat" },
	en: { shipping: "shipping", returns: "returns", payment: "payment", privacy: "privacy" },
};

export type ListingParam = "collection" | "category" | "inStock" | "minPrice" | "maxPrice" | "page";

/** Query parameter names of the listing filters; `q` and `sort` are the same in both languages. */
export const listingParams: Record<Lang, Record<ListingParam, string>> = {
	vi: { collection: "bst", category: "loai", inStock: "con-hang", minPrice: "gia-tu", maxPrice: "gia-den", page: "trang" },
	en: { collection: "collection", category: "category", inStock: "in-stock", minPrice: "min-price", maxPrice: "max-price", page: "page" },
};

/** A listing query in the other language's parameter names (unknown parameters are dropped). */
export function translateQuery(query: URLSearchParams, from: Lang, to: Lang): string {
	const out = new URLSearchParams();
	const names = Object.entries(listingParams[from]) as [ListingParam, string][];
	for (const [key, value] of query) {
		if (key === "q" || key === "sort") out.append(key, value);
		const param = names.find(([, name]) => name === key)?.[0];
		if (param) out.append(listingParams[to][param], value);
	}
	const qs = out.toString();
	return qs ? `?${qs}` : "";
}
