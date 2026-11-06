import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import { applyFilters, collectionName, relatedProducts, sortLabels, videoById, type Filters, type SortKey } from "./lib/catalog";
import { categories, collections, settings, site, wwwRedirect, type Settings } from "./lib/config";
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
import { buildQuote } from "./lib/quote";
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
	sitemapXml,
	storeJsonLd,
} from "./lib/seo";
import { ghnCallbackSchema, HCM_PROVINCE, isOrderCode, normalisePhone, normaliseOrderCode, lookupSchema, quoteSchema } from "./lib/validation";
import { Document, THEME_BOOT, type PageMeta, type ViewCtx } from "./views/layout";
import { AdminDocument, AdminOrder, AdminOrders, AdminProducts } from "./views/pages/admin";
import { CartPage, CheckoutPage } from "./views/pages/checkout";
import { HomePage } from "./views/pages/home";
import { AboutPage, ErrorPage, faq, HelpPage, NotFoundPage, PolicyPage, VideosPage } from "./views/pages/info";
import { ListingPage, PAGE_SIZE } from "./views/pages/listing";
import { LookupPage, OrderPage } from "./views/pages/order";
import { ProductPage } from "./views/pages/product";

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

type App = { Bindings: Env; Variables: { s: Settings } };
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

const viewCtx = (c: C, query?: string): ViewCtx => ({ s: c.get("s"), path: new URL(c.req.url).pathname, build: BUILD, query });

async function page(c: C, meta: PageMeta, body: Child, opts: { status?: number; cache?: string; query?: string } = {}) {
	const html = await (<Document ctx={viewCtx(c, opts.query)} meta={meta}>{body}</Document>).toString();
	return c.html(`<!doctype html>${html}`, (opts.status ?? 200) as 200, { "Cache-Control": opts.cache ?? (meta.noindex ? NO_STORE : PUBLIC_PAGE) });
}

const titled = (t: string) => `${t} | ${site.name}`;

// ------------------------------------------------------------------ storefront pages

app.get("/", edgeCache, async (c) => {
	const s = c.get("s");
	const products = await loadCatalog(c.env.DB);
	return page(
		c,
		{
			title: `${site.name} – Mô hình anime chibi Frieren, Neko, móc khoá | Freeship, COD`,
			description: "Shop mô hình anime chibi của TikTok @leduyenminh: Frieren, Fern, Stark, Neko kawaii, figure 20cm, móc khoá acrylic. COD toàn quốc hoặc chuyển khoản VietQR.",
			canonical: "/",
			jsonLd: storeJsonLd(s),
		},
		<HomePage ctx={viewCtx(c)} products={products} />,
	);
});

function readFilters(c: C, base: Partial<Filters> = {}): { filters: Filters; page: number } {
	const q = c.req.query();
	const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
	const sort = (q.sort && q.sort in sortLabels ? q.sort : "featured") as SortKey;
	return {
		filters: {
			q: q.q?.trim().slice(0, 100) || undefined,
			collection: q.bst && q.bst in collections ? q.bst : undefined,
			category: q.loai && q.loai in categories ? q.loai : undefined,
			inStock: q["con-hang"] === "1",
			minPrice: num(q["gia-tu"]),
			maxPrice: num(q["gia-den"]),
			sort,
			...base,
		},
		page: Math.max(1, num(q.trang) ?? 1),
	};
}

async function listing(c: C, opts: { title: string; intro?: string; basePath: string; base?: Partial<Filters>; crumbs: { name: string; href?: string }[]; noindex?: boolean }) {
	const s = c.get("s");
	const { filters, page: pageNo } = readFilters(c, opts.base);
	const all = applyFilters(await loadCatalog(c.env.DB), filters, videoById);
	const slice = all.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
	if (pageNo > 1 && !slice.length) return c.notFound();
	// Filtered/sorted variants of a listing are not separate pages for search engines.
	const isBase = new URL(c.req.url).search === "" || (pageNo > 1 && [...new URL(c.req.url).searchParams.keys()].every((k) => k === "trang"));
	return page(
		c,
		{
			title: titled(pageNo > 1 ? `${opts.title} – Trang ${pageNo}` : opts.title),
			description: opts.intro,
			canonical: opts.noindex ? undefined : pageNo > 1 && isBase ? `${opts.basePath}?trang=${pageNo}` : opts.basePath,
			noindex: opts.noindex,
			jsonLd: [breadcrumbJsonLd(s, opts.crumbs.map((x) => ({ name: x.name, path: x.href ?? opts.basePath }))), itemListJsonLd(s, slice)],
			preload: slice[0]?.images[0],
		},
		<ListingPage ctx={viewCtx(c, filters.q)} title={opts.title} intro={opts.intro} products={slice} total={all.length} page={pageNo} filters={filters} basePath={opts.basePath} crumbs={opts.crumbs} />,
		{ query: filters.q, cache: opts.noindex ? "public, max-age=60" : undefined },
	);
}

app.get("/san-pham", edgeCache, (c) =>
	listing(c, {
		title: "Tất cả sản phẩm",
		intro: "Mô hình chibi, figure 20cm, móc khoá và standee anime – hàng có sẵn, giao toàn quốc.",
		basePath: "/san-pham",
		crumbs: [{ name: "Trang chủ", href: "/" }, { name: "Sản phẩm" }],
	}),
);

app.get("/bo-suu-tap/:slug", edgeCache, (c) => {
	const slug = c.req.param("slug") ?? "";
	const col = collections[slug];
	if (!col) return c.notFound();
	return listing(c, {
		title: `Mô hình ${col.name}`,
		intro: col.blurb,
		basePath: collectionPath(slug),
		base: { collection: slug },
		crumbs: [{ name: "Trang chủ", href: "/" }, { name: "Sản phẩm", href: "/san-pham" }, { name: col.name }],
	});
});

app.get("/danh-muc/:slug", edgeCache, (c) => {
	const slug = c.req.param("slug") ?? "";
	const cat = categories[slug];
	if (!cat) return c.notFound();
	return listing(c, {
		title: cat.name,
		intro: cat.blurb,
		basePath: categoryPath(slug),
		base: { category: slug },
		crumbs: [{ name: "Trang chủ", href: "/" }, { name: "Sản phẩm", href: "/san-pham" }, { name: cat.name }],
	});
});

app.get("/tim-kiem", edgeCache, async (c) => {
	const q = c.req.query("q")?.trim();
	if (!q) return c.redirect("/san-pham", 302);
	return listing(c, {
		title: `Kết quả cho “${q.slice(0, 60)}”`,
		basePath: "/tim-kiem",
		crumbs: [{ name: "Trang chủ", href: "/" }, { name: "Tìm kiếm" }],
		noindex: true,
	});
});

app.get("/san-pham/:slug", edgeCache, async (c) => {
	const s = c.get("s");
	const products = await loadCatalog(c.env.DB);
	const product = products.find((p) => p.slug === (c.req.param("slug") ?? "") && p.status === "active");
	if (!product || !product.skus.length) return c.notFound();
	const selected = c.req.query("sku");
	return page(
		c,
		{
			title: titled(product.title),
			description: metaDescription(product),
			canonical: productPath(product),
			image: product.images[0],
			ogType: "product",
			preload: product.images[0],
			jsonLd: [
				productJsonLd(s, product),
				breadcrumbJsonLd(s, [
					{ name: "Trang chủ", path: "/" },
					{ name: collectionName(product.collection), path: collectionPath(product.collection) },
					{ name: product.title, path: productPath(product) },
				]),
			],
		},
		<ProductPage ctx={viewCtx(c)} product={product} related={relatedProducts(product, products, videoById, 8)} selectedSkuId={selected} />,
	);
});

app.get("/video", edgeCache, async (c) =>
	page(
		c,
		{ title: titled("Video TikTok"), description: "Video mở hộp, decor mô hình anime từ TikTok @leduyenminh.", canonical: "/video" },
		<VideosPage ctx={viewCtx(c)} products={await loadCatalog(c.env.DB)} />,
	),
);

app.get("/ho-tro", edgeCache, (c) =>
	page(
		c,
		{ title: titled("Câu hỏi thường gặp"), description: "Giao hàng, thanh toán COD, chuyển khoản VietQR, đổi trả tại Mall of Anitoy.", canonical: "/ho-tro", jsonLd: [faqJsonLd(faq(c.get("s")))] },
		<HelpPage ctx={viewCtx(c)} />,
	),
);

app.get("/chinh-sach", edgeCache, (c) =>
	page(c, { title: titled("Chính sách mua hàng"), description: "Chính sách giao hàng, đổi trả, thanh toán và bảo mật.", canonical: "/chinh-sach" }, <PolicyPage ctx={viewCtx(c)} />),
);

app.get("/gioi-thieu", edgeCache, async (c) =>
	page(
		c,
		{ title: titled("Giới thiệu"), description: `Về ${site.name} – shop mô hình anime của TikTok @${site.tiktok.handle}.`, canonical: "/gioi-thieu" },
		<AboutPage ctx={viewCtx(c)} products={await loadCatalog(c.env.DB)} />,
	),
);

app.get("/tra-cuu-don-hang", edgeCache, (c) =>
	page(c, { title: titled("Tra cứu đơn hàng"), description: "Tra cứu trạng thái đơn hàng bằng mã đơn và số điện thoại.", canonical: "/tra-cuu-don-hang" }, <LookupPage ctx={viewCtx(c)} />),
);

app.get("/gio-hang", (c) => page(c, { title: titled("Giỏ hàng"), noindex: true }, <CartPage ctx={viewCtx(c)} />));
app.get("/thanh-toan", async (c) => {
	// Inside HCM GHN prices by ward, so checkout offers GHN's ward names (cached a day per isolate).
	const ghn = c.get("s").shipping.ghn;
	const hcmWards = ghn
		? await ghnWards(ghn, HCM_PROVINCE).then(
				(area) => area.wards.map((w) => w.name).sort((a, b) => a.localeCompare(b, "vi")),
				() => null,
			)
		: null;
	return page(c, { title: titled("Thanh toán"), noindex: true }, <CheckoutPage ctx={viewCtx(c)} hcmWards={hcmWards} />);
});

app.get("/don-hang/:id", async (c) => {
	const order = await getOrderForViewer(c.env.DB, c.req.param("id"), c.req.query("t"));
	if (!order) return page(c, { title: titled("Không tìm thấy đơn hàng"), noindex: true }, <NotFoundPage ctx={viewCtx(c)} />, { status: 404 });
	const notice = c.req.query("moi") === "1" ? "new" : undefined;
	return page(c, { title: titled(`Đơn hàng ${order.id}`), noindex: true }, <OrderPage ctx={viewCtx(c)} order={order} notice={notice} />);
});

// ------------------------------------------------------------------ SEO files

app.get("/robots.txt", (c) => {
	const s = c.get("s");
	return c.text(
		["User-agent: *", "Allow: /", "Disallow: /admin", "Disallow: /api/", "Disallow: /gio-hang", "Disallow: /thanh-toan", "Disallow: /don-hang/", "Disallow: /tim-kiem", "", `Sitemap: ${s.siteUrl}/sitemap.xml`, ""].join("\n"),
		200,
		{ "Cache-Control": "public, max-age=3600" },
	);
});

app.get("/sitemap.xml", edgeCache, async (c) => {
	const s = c.get("s");
	const live = (await loadCatalog(c.env.DB)).filter((p) => p.status === "active");
	const latest = live.map((p) => p.updatedAt).sort().at(-1);
	const xml = sitemapXml(s, [
		{ path: "/", lastmod: latest },
		{ path: "/san-pham", lastmod: latest },
		...Object.keys(collections).map((slug) => ({ path: collectionPath(slug), lastmod: latest })),
		...Object.keys(categories).map((slug) => ({ path: categoryPath(slug), lastmod: latest })),
		...live.map((p) => ({ path: productPath(p), lastmod: p.updatedAt, images: p.images })),
		{ path: "/video" },
		{ path: "/ho-tro" },
		{ path: "/chinh-sach" },
		{ path: "/gioi-thieu" },
		{ path: "/tra-cuu-don-hang" },
	]);
	return c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": PUBLIC_PAGE });
});

/** Google Merchant Center product feed (submit in Merchant Center → Products → Add from a file link). */
app.get("/feeds/google.xml", edgeCache, async (c) =>
	c.body(googleFeed(c.get("s"), await loadCatalog(c.env.DB)), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": PUBLIC_PAGE }),
);

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
	const { items, address } = parsed.data;
	const shipping = c.get("s").shipping;
	const quote = buildQuote(items, await loadProducts(c.env.DB, items.map((i) => i.productId)), shipping);
	try {
		return c.json(await priceShipping(quote, shipping, address), 200, noStore);
	} catch (error) {
		// A ward GHN doesn't deliver to: no fee until the shopper picks one from the list.
		if (error instanceof ShippingAddressError) return c.json({ ...quote, shippingFee: 0, total: quote.subtotal, shippingPending: true, addressIssue: "ward" }, 200, noStore);
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
	return result ? c.json(result, 200, noStore) : c.json({ error: "not_found" }, 404, noStore);
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
	return page(c, { title: titled("Không tìm thấy trang"), noindex: true }, <NotFoundPage ctx={viewCtx(c)} />, { status: 404 });
});

app.onError((error, c) => {
	log.error("request.failed", { path: new URL(c.req.url).pathname, error: String(error) });
	if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "server_error" }, 500, noStore);
	if (!c.get("s")) c.set("s", settings(c.env, new URL(c.req.url).origin));
	return page(c, { title: titled("Có lỗi xảy ra"), noindex: true }, <ErrorPage ctx={viewCtx(c)} />, { status: 500 });
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
