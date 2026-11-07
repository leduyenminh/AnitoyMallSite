import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import { applyFilters, collectionName, relatedProducts, sortLabels, videoById, type Filters, type SortKey } from "./lib/catalog";
import { categories, collections, groupText, settings, site, wwwRedirect, type Settings } from "./lib/config";
import { safeEqual, sha256Hex } from "./lib/crypto";
import {
	catalogVersion,
	ConflictError,
	ensureDb,
	getOrder,
	importCatalog,
	type ImportMode,
	listOrders,
	loadCatalog,
	loadProducts,
	orderCounts,
	updateProduct,
	updateSku,
} from "./lib/db";
import { type Lang, langOf, LANGS, listingParams, otherLang, type PageKey, routes, translateQuery } from "./lib/i18n";
import { allow, clientIp, ipHash, verifyTurnstile } from "./lib/limits";
import { log } from "./lib/log";
import {
	applyCarrierEvent,
	applyOrderAction,
	bookGhnShipment,
	canBookGhn,
	CheckoutError,
	createOrder,
	expireOrders,
	getOrderForViewer,
	lookupOrder,
	type OrderAction,
} from "./lib/orders";
import { handleBankTransaction, sepayAuthorized } from "./lib/payments";
import { buildQuote, type Quote } from "./lib/quote";
import { ghnWards, priceShipping, ShippingAddressError } from "./lib/shipping";
import {
	breadcrumbJsonLd,
	categoryPath,
	collectionPath,
	faqJsonLd,
	googleFeed,
	itemListJsonLd,
	metaDescription,
	productJsonLd,
	productPath,
	type SitemapEntry,
	sitemapXml,
	storeJsonLd,
} from "./lib/seo";
import { englishSlug, englishText, localizeLines, localizeProduct } from "./lib/translations";
import { ghnCallbackSchema, HCM_PROVINCE, isOrderCode, normalisePhone, normaliseOrderCode, lookupSchema, quoteSchema } from "./lib/validation";
import { Document, THEME_BOOT, type PageMeta, type ViewCtx } from "./views/layout";
import { AdminDocument, AdminOrder, AdminOrders, AdminProducts } from "./views/pages/admin";
import { CartPage, CheckoutPage } from "./views/pages/checkout";
import { HomePage } from "./views/pages/home";
import { AboutPage, ErrorPage, faq, HelpPage, NotFoundPage, PolicyPage, VideosPage } from "./views/pages/info";
import { ListingPage, type ListingProps, PAGE_SIZE } from "./views/pages/listing";
import { LookupPage, OrderPage } from "./views/pages/order";
import { ProductPage } from "./views/pages/product";
import { text } from "./views/text";

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

type App = { Bindings: Env; Variables: { s: Settings; lang: Lang } };
type C = Context<App>;

const app = new Hono<App>();

// Cache-Control presets.
const PUBLIC_PAGE = "public, max-age=60, s-maxage=120, stale-while-revalidate=600";
const NO_STORE = "no-store";

// ------------------------------------------------------------------ middleware

let scriptHash: Promise<string> | null = null;
const themeScriptHash = () =>
	(scriptHash ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(THEME_BOOT)).then((buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))));

app.use("*", async (c, next) => {
	const url = new URL(c.req.url);
	// Redirects may carry an order's access token in the query, so browsers must not keep them.
	const www = wwwRedirect(url, c.env.SITE_URL ?? "", c.req.method);
	if (www) {
		c.header("Cache-Control", NO_STORE);
		return c.redirect(www, 301);
	}
	if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
		// Absolute target: a relative "//evil.example" would send the shopper to another site.
		c.header("Cache-Control", NO_STORE);
		return c.redirect(`${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`, 301);
	}
	c.set("s", settings(c.env, url.origin));
	c.set("lang", langOf(url.pathname));
	await ensureDb(c.env.DB, c.get("s").pricing);
	await next();
	const h = c.res.headers;
	h.set("X-Content-Type-Options", "nosniff");
	h.set("Referrer-Policy", "strict-origin-when-cross-origin");
	h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
	if (url.protocol === "https:") h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	if ((h.get("content-type") ?? "").includes("text/html")) {
		h.set(
			"Content-Security-Policy",
			[
				"default-src 'self'",
				`script-src 'self' 'sha256-${await themeScriptHash()}' https://challenges.cloudflare.com`,
				"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
				"font-src 'self' https://fonts.gstatic.com",
				"img-src 'self' data: https:",
				"frame-src https://www.tiktok.com https://challenges.cloudflare.com",
				"connect-src 'self'",
				"form-action 'self'",
				"base-uri 'self'",
				"object-src 'none'",
				"frame-ancestors 'self'",
			].join("; "),
		);
	}
});

/** Serves anonymous GET pages from Cloudflare's edge cache, keyed by the catalog version. */
const edgeCache = async (c: C, next: () => Promise<void>) => {
	if (c.req.method !== "GET") return next();
	const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
	if (!cache) return next();
	const url = new URL(c.req.url);
	url.searchParams.set("__v", `${BUILD}.${await catalogVersion(c.env.DB)}`);
	const key = new Request(url.toString(), { method: "GET" });
	const hit = await cache.match(key);
	if (hit) {
		const res = new Response(hit.body, hit);
		res.headers.set("X-Edge-Cache", "HIT");
		return res;
	}
	await next();
	if (c.res.status === 200 && (c.res.headers.get("Cache-Control") ?? "").includes("public")) {
		c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
	}
};

// ------------------------------------------------------------------ rendering

const viewCtx = (c: C, query?: string): ViewCtx => {
	const lang = c.get("lang");
	return { s: c.get("s"), lang, path: new URL(c.req.url).pathname, build: BUILD, query, alt: routes[otherLang(lang)].home };
};

async function page(c: C, meta: PageMeta, body: Child, opts: { status?: number; cache?: string; query?: string; alt?: string } = {}) {
	const other = otherLang(c.get("lang"));
	const ctx = { ...viewCtx(c, opts.query), alt: opts.alt ?? meta.alternates?.[other] ?? routes[other].home };
	const html = await (<Document ctx={ctx} meta={meta}>{body}</Document>).toString();
	return c.html(`<!doctype html>${html}`, (opts.status ?? 200) as 200, { "Cache-Control": opts.cache ?? (meta.noindex ? NO_STORE : PUBLIC_PAGE) });
}

const titled = (t: string) => `${t} | ${site.name}`;

/** A page's path in every language. */
const inAll = (key: PageKey): Record<Lang, string> => ({ vi: routes.vi[key], en: routes.en[key] });

/** The current query in the other language's listing parameter names. */
const otherQuery = (c: C) => translateQuery(new URL(c.req.url).searchParams, c.get("lang"), otherLang(c.get("lang")));

// ------------------------------------------------------------------ storefront pages
// Every page exists in Vietnamese (/) and English (/en): same handlers, same data, same prices.

function readFilters(c: C, lang: Lang, base: Partial<Filters> = {}): { filters: Filters; page: number } {
	const q = c.req.query();
	const p = listingParams[lang];
	const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
	const sort = (q.sort && q.sort in sortLabels.vi ? q.sort : "featured") as SortKey;
	return {
		filters: {
			q: q.q?.trim().slice(0, 100) || undefined,
			collection: q[p.collection] && q[p.collection]! in collections ? q[p.collection] : undefined,
			category: q[p.category] && q[p.category]! in categories ? q[p.category] : undefined,
			inStock: q[p.inStock] === "1",
			minPrice: num(q[p.minPrice]),
			maxPrice: num(q[p.maxPrice]),
			sort,
			...base,
		},
		page: Math.max(1, num(q[p.page]) ?? 1),
	};
}

async function listing(
	c: C,
	lang: Lang,
	opts: {
		title: string;
		intro?: string;
		/** The listing's path in every language. */
		paths: Record<Lang, string>;
		scope: ListingProps["scope"];
		base?: Partial<Filters>;
		crumbs: { name: string; href?: string }[];
		noindex?: boolean;
	},
) {
	const s = c.get("s");
	const t = text[lang];
	const basePath = opts.paths[lang];
	const { filters, page: pageNo } = readFilters(c, lang, opts.base);
	const all = applyFilters(await loadCatalog(c.env.DB), filters, videoById);
	const slice = all.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
	if (pageNo > 1 && !slice.length) return c.notFound();
	// Filtered/sorted variants of a listing are not separate pages for search engines.
	const url = new URL(c.req.url);
	const isBase = url.search === "" || (pageNo > 1 && [...url.searchParams.keys()].every((k) => k === listingParams[lang].page));
	const at = (l: Lang) => `${opts.paths[l]}${pageNo > 1 && isBase ? `?${listingParams[l].page}=${pageNo}` : ""}`;
	return page(
		c,
		{
			title: titled(pageNo > 1 ? `${opts.title}${t.meta.page(pageNo)}` : opts.title),
			description: opts.intro,
			canonical: opts.noindex ? undefined : at(lang),
			alternates: { vi: at("vi"), en: at("en") },
			noindex: opts.noindex,
			jsonLd: [breadcrumbJsonLd(s, opts.crumbs.map((x) => ({ name: x.name, path: x.href ?? basePath }))), itemListJsonLd(s, slice, lang)],
			preload: slice[0]?.images[0],
		},
		<ListingPage
			ctx={viewCtx(c, filters.q)}
			title={opts.title}
			intro={opts.intro}
			products={slice.map((p) => localizeProduct(p, lang))}
			total={all.length}
			page={pageNo}
			filters={filters}
			basePath={basePath}
			scope={opts.scope}
			crumbs={opts.crumbs}
		/>,
		{ query: filters.q, cache: opts.noindex ? "public, max-age=60" : undefined, alt: `${opts.paths[otherLang(lang)]}${otherQuery(c)}` },
	);
}

for (const lang of LANGS) {
	const r = routes[lang];
	const t = text[lang];
	const other = otherLang(lang);

	app.get(r.home, edgeCache, async (c) => {
		const products = (await loadCatalog(c.env.DB)).map((p) => localizeProduct(p, lang));
		return page(
			c,
			{ title: t.meta.homeTitle(site.name), description: t.meta.homeDescription, canonical: r.home, alternates: inAll("home"), jsonLd: storeJsonLd(c.get("s"), lang) },
			<HomePage ctx={viewCtx(c)} products={products} />,
		);
	});

	app.get(r.products, edgeCache, (c) =>
		listing(c, lang, {
			title: t.allProducts,
			intro: t.meta.productsIntro,
			paths: inAll("products"),
			scope: "all",
			crumbs: [{ name: t.home, href: r.home }, { name: t.products }],
		}),
	);

	app.get(`${r.collection}/:slug`, edgeCache, (c) => {
		const slug = c.req.param("slug") ?? "";
		const col = collections[slug];
		if (!col) return c.notFound();
		const name = groupText(col, lang).name;
		return listing(c, lang, {
			title: t.meta.collectionTitle(name),
			intro: groupText(col, lang).blurb,
			paths: { vi: collectionPath(slug, "vi"), en: collectionPath(slug, "en") },
			scope: "collection",
			base: { collection: slug },
			crumbs: [{ name: t.home, href: r.home }, { name: t.products, href: r.products }, { name }],
		});
	});

	app.get(`${r.category}/:slug`, edgeCache, (c) => {
		const slug = c.req.param("slug") ?? "";
		const cat = categories[slug];
		if (!cat) return c.notFound();
		const name = groupText(cat, lang).name;
		return listing(c, lang, {
			title: name,
			intro: groupText(cat, lang).blurb,
			paths: { vi: categoryPath(slug, "vi"), en: categoryPath(slug, "en") },
			scope: "category",
			base: { category: slug },
			crumbs: [{ name: t.home, href: r.home }, { name: t.products, href: r.products }, { name }],
		});
	});

	app.get(r.search, edgeCache, async (c) => {
		const q = c.req.query("q")?.trim();
		if (!q) return c.redirect(r.products, 302);
		return listing(c, lang, {
			title: t.meta.searchTitle(q.slice(0, 60)),
			paths: inAll("search"),
			scope: "search",
			crumbs: [{ name: t.home, href: r.home }, { name: t.search }],
			noindex: true,
		});
	});

	app.get(`${r.product}/:slug`, edgeCache, async (c) => {
		const s = c.get("s");
		const slug = c.req.param("slug") ?? "";
		const products = await loadCatalog(c.env.DB);
		const live = products.filter((p) => p.status === "active" && p.skus.length);
		const product = live.find((p) => (lang === "en" ? englishSlug(p) : p.slug) === slug);
		if (!product) {
			// An English link built with the Vietnamese slug: send it to the English slug.
			const moved = lang === "en" ? live.find((p) => p.slug === slug) : undefined;
			return moved ? c.redirect(`${productPath(moved, lang)}${new URL(c.req.url).search}`, 301) : c.notFound();
		}
		const selected = c.req.query("sku");
		const shown = localizeProduct(product, lang);
		const paths = { vi: productPath(product, "vi"), en: productPath(product, "en") };
		return page(
			c,
			{
				title: titled(shown.title),
				description: metaDescription(product, lang),
				canonical: paths[lang],
				alternates: paths,
				image: product.images[0],
				ogType: "product",
				preload: product.images[0],
				jsonLd: [
					productJsonLd(s, product, lang),
					breadcrumbJsonLd(s, [
						{ name: t.home, path: r.home },
						{ name: collectionName(product.collection, lang), path: collectionPath(product.collection, lang) },
						{ name: shown.title, path: paths[lang] },
					]),
				],
			},
			<ProductPage
				ctx={viewCtx(c)}
				product={shown}
				related={relatedProducts(product, products, videoById, 8).map((p) => localizeProduct(p, lang))}
				selectedSkuId={selected}
				untranslated={lang !== "vi" && !englishText(product)}
			/>,
			{ alt: `${paths[other]}${selected ? `?sku=${encodeURIComponent(selected)}` : ""}` },
		);
	});

	app.get(r.videos, edgeCache, async (c) =>
		page(
			c,
			{ title: titled(t.tiktokVideos), description: t.meta.videosDescription, canonical: r.videos, alternates: inAll("videos") },
			<VideosPage ctx={viewCtx(c)} products={(await loadCatalog(c.env.DB)).map((p) => localizeProduct(p, lang))} />,
		),
	);

	app.get(r.help, edgeCache, (c) =>
		page(
			c,
			{ title: titled(t.faqTitle), description: t.meta.helpDescription, canonical: r.help, alternates: inAll("help"), jsonLd: [faqJsonLd(faq(c.get("s"), lang))] },
			<HelpPage ctx={viewCtx(c)} />,
		),
	);

	app.get(r.policy, edgeCache, (c) =>
		page(c, { title: titled(t.policiesTitle), description: t.meta.policiesDescription, canonical: r.policy, alternates: inAll("policy") }, <PolicyPage ctx={viewCtx(c)} />),
	);

	app.get(r.about, edgeCache, async (c) =>
		page(
			c,
			{ title: titled(t.about), description: t.meta.aboutDescription(site.name, site.tiktok.handle), canonical: r.about, alternates: inAll("about") },
			<AboutPage ctx={viewCtx(c)} products={await loadCatalog(c.env.DB)} />,
		),
	);

	app.get(r.lookup, edgeCache, (c) =>
		page(c, { title: titled(t.meta.lookupTitle), description: t.meta.lookupDescription, canonical: r.lookup, alternates: inAll("lookup") }, <LookupPage ctx={viewCtx(c)} />),
	);

}

// Private pages: no-store, noindex and never edge-cached. Registered with literal paths (not through
// `routes`) so the edgeCache guard in .claude/hooks can see them.

const cartPage = (lang: Lang) => (c: C) => page(c, { title: titled(text[lang].cart), noindex: true, alternates: inAll("cart") }, <CartPage ctx={viewCtx(c)} />);

const checkoutPage = (lang: Lang) => async (c: C) => {
	// Inside HCM GHN prices by ward, so checkout offers GHN's ward names (cached a day per isolate).
	const ghn = c.get("s").shipping.ghn;
	const hcmWards = ghn
		? await ghnWards(ghn, HCM_PROVINCE).then(
				(area) => area.wards.map((w) => w.name).sort((a, b) => a.localeCompare(b, "vi")),
				() => null,
			)
		: null;
	return page(c, { title: titled(text[lang].checkout), noindex: true, alternates: inAll("checkout") }, <CheckoutPage ctx={viewCtx(c)} hcmWards={hcmWards} />);
};

const orderPage = (lang: Lang) => async (c: C) => {
	const t = text[lang];
	const token = c.req.query("t");
	const order = await getOrderForViewer(c.env.DB, c.req.param("id") ?? "", token);
	if (!order) return page(c, { title: titled(t.meta.orderNotFound), noindex: true }, <NotFoundPage ctx={viewCtx(c)} />, { status: 404 });
	const notice = c.req.query("moi") === "1" ? "new" : undefined;
	const lines = lang === "vi" ? order.lines : localizeLines(order.lines, await loadCatalog(c.env.DB), lang);
	// The same order in the other language: the link carries the access token this page was opened with.
	const alt = `${routes[otherLang(lang)].order}/${encodeURIComponent(order.id)}?t=${encodeURIComponent(token ?? "")}`;
	return page(c, { title: titled(t.meta.orderTitle(order.id)), noindex: true }, <OrderPage ctx={viewCtx(c)} order={order} lines={lines} notice={notice} />, { alt });
};

app.get("/gio-hang", cartPage("vi"));
app.get("/en/cart", cartPage("en"));
app.get("/thanh-toan", checkoutPage("vi"));
app.get("/en/checkout", checkoutPage("en"));
app.get("/don-hang/:id", orderPage("vi"));
app.get("/en/orders/:id", orderPage("en"));

// ------------------------------------------------------------------ SEO files

app.get("/robots.txt", (c) => {
	const s = c.get("s");
	const privatePaths = LANGS.flatMap((l) => [routes[l].cart, routes[l].checkout, `${routes[l].order}/`, routes[l].search]);
	return c.text(
		[
			"User-agent: *",
			"Allow: /",
			"Disallow: /admin",
			"Disallow: /api/",
			...privatePaths.map((p) => `Disallow: ${p}`),
			"",
			`Sitemap: ${s.siteUrl}/sitemap.xml`,
			`Sitemap: ${s.siteUrl}/sitemap-en.xml`,
			"",
		].join("\n"),
		200,
		{ "Cache-Control": "public, max-age=3600" },
	);
});

/** Every indexed page in `lang`, each with its alternates in every language. */
async function sitemapFor(c: C, lang: Lang) {
	const live = (await loadCatalog(c.env.DB)).filter((p) => p.status === "active");
	const latest = live.map((p) => p.updatedAt).sort().at(-1);
	const entry = (alternates: Record<Lang, string>, extra: Omit<SitemapEntry, "path" | "alternates"> = {}): SitemapEntry => ({ path: alternates[lang], alternates, ...extra });
	const pages: PageKey[] = ["videos", "help", "policy", "about", "lookup"];
	return sitemapXml(c.get("s"), [
		entry(inAll("home"), { lastmod: latest }),
		entry(inAll("products"), { lastmod: latest }),
		...Object.keys(collections).map((slug) => entry({ vi: collectionPath(slug, "vi"), en: collectionPath(slug, "en") }, { lastmod: latest })),
		...Object.keys(categories).map((slug) => entry({ vi: categoryPath(slug, "vi"), en: categoryPath(slug, "en") }, { lastmod: latest })),
		...live.map((p) => entry({ vi: productPath(p, "vi"), en: productPath(p, "en") }, { lastmod: p.updatedAt, images: p.images })),
		...pages.map((key) => entry(inAll(key))),
	]);
}

const xml = (c: C, body: string) => c.body(body, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": PUBLIC_PAGE });

app.get("/sitemap.xml", edgeCache, async (c) => xml(c, await sitemapFor(c, "vi")));
app.get("/sitemap-en.xml", edgeCache, async (c) => xml(c, await sitemapFor(c, "en")));

/**
 * Google Merchant Center product feeds (Merchant Center → Products → Add from a file link): one in
 * Vietnamese and one in English, both for Vietnam (the only country the shop ships to).
 */
app.get("/feeds/google.xml", edgeCache, async (c) => xml(c, googleFeed(c.get("s"), await loadCatalog(c.env.DB), "vi")));
app.get("/feeds/google-en.xml", edgeCache, async (c) => xml(c, googleFeed(c.get("s"), await loadCatalog(c.env.DB), "en")));

app.get("/manifest.webmanifest", (c) =>
	c.json(
		{
			name: site.name,
			short_name: site.shortName,
			lang: "vi",
			start_url: "/",
			display: "standalone",
			background_color: "#f3f6f4",
			theme_color: "#0b7a5c",
			icons: [{ src: "/media/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }],
		},
		200,
		{ "Cache-Control": "public, max-age=86400" },
	),
);

// ------------------------------------------------------------------ public APIs

const tooMany = (c: C) => c.json({ error: "rate_limited" }, 429, { "Retry-After": "60", "Cache-Control": NO_STORE });
const noStore = { "Cache-Control": NO_STORE };

app.post("/api/cart/quote", async (c) => {
	if (!(await allow(c.env.API_LIMITER, `quote:${clientIp(c.req.raw)}`))) return tooMany(c);
	const parsed = quoteSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid" }, 400, noStore);
	const { items, address, lang = "vi" } = parsed.data;
	const shipping = c.get("s").shipping;
	const products = await loadProducts(c.env.DB, items.map((i) => i.productId));
	const quote = buildQuote(items, products, shipping);
	// Product names in the page's language; amounts and issues are the server's quote as it is.
	const shown = <Q extends Quote>(q: Q): Q => (lang === "vi" ? q : { ...q, lines: localizeLines(q.lines, products, lang) });
	try {
		return c.json(shown(await priceShipping(quote, shipping, address)), 200, noStore);
	} catch (error) {
		// A ward GHN doesn't deliver to: no fee until the shopper picks one from the list.
		if (error instanceof ShippingAddressError) return c.json({ ...shown(quote), shippingFee: 0, total: quote.subtotal, shippingPending: true, addressIssue: "ward" }, 200, noStore);
		throw error;
	}
});

app.post("/api/orders", async (c) => {
	const s = c.get("s");
	const ip = clientIp(c.req.raw);
	if (!(await allow(c.env.ORDER_LIMITER, `order:${ip}`))) return tooMany(c);
	const body = await c.req.json().catch(() => null);
	try {
		const order = await createOrder(c.env.DB, s, body, {
			ipHash: await ipHash(ip),
			verifyHuman: s.turnstile ? (token) => verifyTurnstile(s.turnstile!.secret, token, ip) : undefined,
		});
		const url = `/don-hang/${order.id}?t=${encodeURIComponent(order.accessToken)}&moi=1`;
		return c.json({ id: order.id, url }, 201, noStore);
	} catch (error) {
		if (error instanceof CheckoutError) {
			const status = { invalid: 400, quote_changed: 409, too_many_orders: 429, verification_failed: 403 }[error.code] as 400;
			return c.json({ error: error.code, ...error.details }, status, noStore);
		}
		throw error;
	}
});

app.post("/api/orders/lookup", async (c) => {
	if (!(await allow(c.env.LOOKUP_LIMITER, `lookup:${clientIp(c.req.raw)}`))) return tooMany(c);
	const parsed = lookupSchema.safeParse(await c.req.json().catch(() => null));
	const result = parsed.success ? await lookupOrder(c.env.DB, parsed.data.code, parsed.data.phone) : null;
	// Same answer for a wrong code and a wrong phone.
	if (!result) return c.json({ error: "not_found" }, 404, noStore);
	// English product names on /en; the answer carries the same (masked) fields either way.
	const lang = parsed.data?.lang ?? "vi";
	return c.json(lang === "vi" ? result : { ...result, lines: localizeLines(result.lines, await loadCatalog(c.env.DB), lang) }, 200, noStore);
});

app.get("/api/orders/:id/status", async (c) => {
	if (!(await allow(c.env.API_LIMITER, `status:${clientIp(c.req.raw)}`))) return tooMany(c);
	const order = await getOrderForViewer(c.env.DB, c.req.param("id"), c.req.query("t"));
	if (!order) return c.json({ error: "not_found" }, 404, noStore);
	return c.json({ status: order.status, paymentStatus: order.paymentStatus, version: order.version }, 200, noStore);
});

// ------------------------------------------------------------------ bank transfers

/** SePay: incoming transfers on the BIDV account auto-confirm VietQR orders. */
app.post("/api/webhooks/sepay", async (c) => {
	const s = c.get("s");
	if (!sepayAuthorized(s, c.req.header("Authorization"))) return c.json({ success: false }, 401);
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") return c.json({ success: false }, 400);
	await handleBankTransaction(c.env.DB, s, body);
	return c.json({ success: true });
});

/**
 * GHN order callbacks for parcels booked from /admin. Registered at developer.ghn.vn with the
 * custom header X-Webhook-Token = GHN_WEBHOOK_SECRET; refused without it or for another shop.
 * A 4xx is final for GHN, so only a lost update race answers 503 (GHN retries).
 */
app.post("/api/webhooks/ghn", async (c) => {
	const ghn = c.get("s").shipping.ghn;
	if (!ghn?.webhookSecret || !safeEqual(c.req.header("X-Webhook-Token") ?? "", ghn.webhookSecret)) return c.json({ success: false }, 401);
	const parsed = ghnCallbackSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || parsed.data.ShopID !== ghn.shopId) return c.json({ success: false }, 400);
	const e = parsed.data;
	const orderId = normaliseOrderCode(e.ClientOrderCode ?? "");
	if (!isOrderCode(orderId)) return c.json({ success: true });
	try {
		const result = await applyCarrierEvent(c.env.DB, {
			orderId,
			code: e.OrderCode,
			type: e.Type,
			status: e.Status,
			codAmount: e.CODAmount,
			codTransferred: Boolean(e.CODTransferDate),
		});
		if (result === "not_found") log.warn("ghn.callback_unmatched", { orderId, type: e.Type });
	} catch (error) {
		if (error instanceof ConflictError) return c.json({ success: false }, 503);
		throw error;
	}
	return c.json({ success: true });
});

// ------------------------------------------------------------------ admin

app.use("/admin/*", adminAuth);
app.use("/admin", adminAuth);
app.use("/api/admin/*", adminAuth);

async function adminAuth(c: C, next: () => Promise<void>) {
	const s = c.get("s");
	c.header("Cache-Control", NO_STORE);
	c.header("X-Robots-Tag", "noindex");
	if (!s.adminPassword) return c.text("Admin is disabled until the ADMIN_PASSWORD secret is set.", 503);
	if (!(await allow(c.env.LOOKUP_LIMITER, `admin:${clientIp(c.req.raw)}`))) return tooMany(c);
	const header = c.req.header("Authorization") ?? "";
	let ok = false;
	if (header.startsWith("Basic ")) {
		try {
			const [user, ...rest] = atob(header.slice(6)).split(":");
			const pass = rest.join(":");
			// Compare hashes so the comparison time doesn't depend on the password length.
			ok = user === "admin" && safeEqual(await sha256Hex(pass), await sha256Hex(s.adminPassword));
		} catch {
			ok = false;
		}
	}
	if (!ok) {
		log.warn("admin.auth_failed");
		return c.text("Authentication required", 401, { "WWW-Authenticate": 'Basic realm="Anitoy admin", charset="UTF-8"' });
	}
	// Mutations must be same-origin JSON (blocks CSRF from other sites).
	if (c.req.method !== "GET") {
		const origin = c.req.header("Origin");
		if (!origin || origin !== new URL(c.req.url).origin || !(c.req.header("Content-Type") ?? "").includes("application/json")) {
			return c.json({ error: "forbidden" }, 403);
		}
	}
	await next();
}

async function adminPage(c: C, title: string, body: Child) {
	const html = await (<AdminDocument title={title} build={BUILD}>{body}</AdminDocument>).toString();
	return c.html(`<!doctype html>${html}`, 200, { "Cache-Control": NO_STORE });
}

app.get("/admin", async (c) => {
	const status = c.req.query("status") || undefined;
	const q = c.req.query("q")?.trim() || undefined;
	const phone = q ? (normalisePhone(q) ?? undefined) : undefined;
	const id = q && !phone ? normaliseOrderCode(q) : undefined;
	const [orders, counts] = await Promise.all([listOrders(c.env.DB, { status, phone, id, limit: 100 }), orderCounts(c.env.DB)]);
	return adminPage(c, "Đơn hàng", <AdminOrders orders={orders} counts={counts} status={status} q={q} />);
});

app.get("/admin/don-hang/:id", async (c) => {
	const order = await getOrder(c.env.DB, c.req.param("id"));
	if (!order) return c.notFound();
	return adminPage(c, `Đơn ${order.id}`, <AdminOrder order={order} canBookGhn={canBookGhn(order, c.get("s"))} />);
});

app.get("/admin/san-pham", async (c) => {
	const products = [...(await loadCatalog(c.env.DB))].sort((a, b) => b.featured - a.featured);
	return adminPage(c, "Sản phẩm", <AdminProducts products={products} />);
});

app.post("/api/admin/orders/:id", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { action?: OrderAction; version?: number };
	const actions: OrderAction[] = ["confirm", "mark_paid", "ship", "deliver", "cancel"];
	if (!body.action || !actions.includes(body.action)) return c.json({ error: "invalid" }, 400);
	try {
		const order = await applyOrderAction(c.env.DB, c.req.param("id"), body.action, body.version);
		return c.json({ status: order.status, paymentStatus: order.paymentStatus, version: order.version });
	} catch (error) {
		if (error instanceof ConflictError) return c.json({ error: "conflict" }, 409);
		if (error instanceof Error && error.message === "not_found") return c.json({ error: "not_found" }, 404);
		throw error;
	}
});

/** Books an HCM order's parcel with GHN (sends the customer's name, phone and address to GHN). */
app.post("/api/admin/orders/:id/ghn", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { version?: unknown };
	const version = typeof body.version === "number" && Number.isInteger(body.version) ? body.version : undefined;
	try {
		const order = await bookGhnShipment(c.env.DB, c.get("s"), c.req.param("id"), version);
		return c.json({ ok: true, version: order.version });
	} catch (error) {
		if (error instanceof ConflictError) return c.json({ error: "conflict" }, 409);
		if (error instanceof ShippingAddressError) return c.json({ error: "ward" }, 400);
		if (error instanceof Error && error.message === "not_found") return c.json({ error: "not_found" }, 404);
		log.warn("ghn.booking_failed", { orderId: c.req.param("id"), reason: error instanceof Error ? error.message : "unknown" });
		return c.json({ error: "carrier" }, 502);
	}
});

app.post("/api/admin/skus/:id", async (c) => {
	const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000_000 ? v : null);
	const price = int(b.price);
	const stock = int(b.stock);
	const seenStock = int(b.seenStock);
	const compareAtPrice = b.compareAtPrice === null ? null : int(b.compareAtPrice);
	if (price === null || stock === null || seenStock === null || (b.compareAtPrice !== null && compareAtPrice === null)) return c.json({ error: "invalid" }, 400);
	await updateSku(c.env.DB, c.req.param("id"), { price, compareAtPrice, stock, seenStock });
	const [fresh] = await loadProducts(c.env.DB, [String(b.productId ?? "")]);
	return c.json({ ok: true, stock: fresh?.skus.find((k) => k.id === c.req.param("id"))?.stock ?? stock });
});

app.post("/api/admin/products/:id", async (c) => {
	const b = (await c.req.json().catch(() => ({}))) as { status?: string };
	if (b.status !== "active" && b.status !== "draft" && b.status !== "archived") return c.json({ error: "invalid" }, 400);
	await updateProduct(c.env.DB, c.req.param("id"), { status: b.status });
	return c.json({ ok: true });
});

app.post("/api/admin/import", async (c) => {
	const b = (await c.req.json().catch(() => ({}))) as { mode?: string };
	const mode: ImportMode = b.mode === "commerce" || b.mode === "prices" ? b.mode : "content";
	await importCatalog(c.env.DB, { mode, pricing: c.get("s").pricing });
	log.info("catalog.imported", { mode });
	return c.json({ ok: true });
});

// ------------------------------------------------------------------ errors

app.notFound((c) => {
	if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
	return page(c, { title: titled(text[c.get("lang")].notFound), noindex: true }, <NotFoundPage ctx={viewCtx(c)} />, { status: 404 });
});

app.onError((error, c) => {
	log.error("request.failed", { path: new URL(c.req.url).pathname, error: String(error) });
	if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "server_error" }, 500, noStore);
	if (!c.get("s")) c.set("s", settings(c.env, new URL(c.req.url).origin));
	if (!c.get("lang")) c.set("lang", langOf(new URL(c.req.url).pathname));
	return page(c, { title: titled(text[c.get("lang")].error), noindex: true }, <ErrorPage ctx={viewCtx(c)} />, { status: 500 });
});

export default {
	fetch: app.fetch,
	/** Every 5 minutes: release stock held by orders nobody paid for or confirmed in time. */
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(
			(async () => {
				await ensureDb(env.DB, settings(env).pricing);
				await expireOrders(env.DB);
			})(),
		);
	},
} satisfies ExportedHandler<Env>;
