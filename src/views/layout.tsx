import type { Child } from "hono/jsx";
import { categories, collections, enabledPaymentMethods, groupText, paymentLabelsByLang, site, type Settings } from "../lib/config";
import { type Lang, LANGS, locales, otherLang, policyAnchors, routes, X_DEFAULT } from "../lib/i18n";
import { formatShortVnd, formatVnd } from "../lib/money";
import { categoryPath, collectionPath, jsonLdString } from "../lib/seo";
import { Icon } from "./icons";
import { languageNames, text } from "./text";

export interface ViewCtx {
	s: Settings;
	lang: Lang;
	path: string;
	/** Build id, appended to asset URLs so a deploy busts browser caches. */
	build: string;
	/** Current search query, kept in the header search box. */
	query?: string;
	/** This page in the other language (path and query), for the language switch. */
	alt: string;
}

export interface PageMeta {
	title: string;
	description?: string;
	/** Path of the canonical URL; omitted for pages that must not be indexed. */
	canonical?: string;
	/** The page in every language (path and query); listed as hreflang alternates on indexed pages. */
	alternates?: Record<Lang, string>;
	noindex?: boolean;
	image?: string;
	ogType?: "website" | "product";
	jsonLd?: unknown[];
	/** LCP image to preload. */
	preload?: string;
	bodyClass?: string;
}

// Applied before first paint so a saved theme never flashes. "system" follows the OS light/dark;
// an unknown saved value (such as the removed "aero" theme) falls back to it.
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem("theme");if(!/^(light|dark|win95)$/.test(p||""))p="system";var d=document.documentElement;var t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;d.dataset.theme=t;d.dataset.themePref=p}catch(e){document.documentElement.dataset.theme="light"}})()`;

export const THEMES = ["system", "light", "dark", "win95"] as const;

const navLinks = (ctx: ViewCtx) => {
	const t = text[ctx.lang];
	const r = routes[ctx.lang];
	return [
		{ href: r.products, label: t.all },
		...Object.entries(collections).map(([slug, c]) => ({ href: collectionPath(slug, ctx.lang), label: groupText(c, ctx.lang).name })),
		...Object.entries(categories)
			.filter(([slug]) => slug === "accessory")
			.map(([slug, c]) => ({ href: categoryPath(slug, ctx.lang), label: groupText(c, ctx.lang).name })),
		{ href: r.videos, label: t.tiktokVideos },
	].map((l) => ({ ...l, active: ctx.path === l.href }));
};

/** Link to this page in the other language. */
function LangSwitch({ ctx, compact = false }: { ctx: ViewCtx; compact?: boolean }) {
	const to = otherLang(ctx.lang);
	const name = languageNames[to];
	return (
		<a
			class={compact ? "icon-btn lang-switch" : undefined}
			href={ctx.alt}
			hreflang={locales[to].html}
			lang={locales[to].html}
			aria-label={compact ? name.name : undefined}
			title={compact ? name.name : undefined}
			data-lang-switch={compact ? to : undefined}
		>
			{compact ? name.short : name.name}
		</a>
	);
}

export function Document({ ctx, meta, children }: { ctx: ViewCtx; meta: PageMeta; children: Child }) {
	const { s, lang } = ctx;
	const t = text[lang];
	const abs = (path: string) => `${s.siteUrl}${path}`;
	const canonical = meta.canonical !== undefined ? abs(meta.canonical) : undefined;
	const image = meta.image ? (meta.image.startsWith("http") ? meta.image : `${s.siteUrl}${meta.image}`) : `${s.siteUrl}/media/icon-512.png`;
	// hreflang only between indexed pages: every language version, plus x-default.
	const alternates = canonical && !meta.noindex ? meta.alternates : undefined;
	const v = ctx.build;
	return (
		<html lang={locales[lang].html}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
				<title>{meta.title}</title>
				{meta.description && <meta name="description" content={meta.description} />}
				{canonical && <link rel="canonical" href={canonical} />}
				{alternates && LANGS.map((l) => <link rel="alternate" hreflang={locales[l].html} href={abs(alternates[l])} />)}
				{alternates && <link rel="alternate" hreflang="x-default" href={abs(alternates[X_DEFAULT])} />}
				<meta name="robots" content={meta.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"} />
				<meta property="og:site_name" content={site.name} />
				<meta property="og:locale" content={locales[lang].og} />
				{alternates && <meta property="og:locale:alternate" content={locales[otherLang(lang)].og} />}
				<meta property="og:type" content={meta.ogType ?? "website"} />
				<meta property="og:title" content={meta.title} />
				{meta.description && <meta property="og:description" content={meta.description} />}
				{canonical && <meta property="og:url" content={canonical} />}
				<meta property="og:image" content={image} />
				<meta name="twitter:card" content="summary_large_image" />
				<meta name="theme-color" content="#0b7a5c" media="(prefers-color-scheme: light)" />
				<meta name="theme-color" content="#0c1513" media="(prefers-color-scheme: dark)" />
				<link rel="icon" href="/favicon.ico" sizes="any" />
				<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
				<link rel="manifest" href="/manifest.webmanifest" />
				<script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
				<link
					rel="stylesheet"
					href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Lexend:wght@500;600;700&display=swap"
				/>
				{meta.preload && <link rel="preload" as="image" href={meta.preload} fetchpriority="high" />}
				<link rel="stylesheet" href={`/assets/app.css?v=${v}`} />
				<link rel="stylesheet" href={`/assets/themes.css?v=${v}`} />
				<script type="module" src={`/assets/app.js?v=${v}`} />
				{(meta.jsonLd ?? []).map((data) => (
					<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />
				))}
			</head>
			<body class={meta.bodyClass} data-free-threshold={s.shipping.freeThreshold}>
				<a class="skip-link" href="#main">
					{t.skipLink}
				</a>
				<TopBar ctx={ctx} />
				<Header ctx={ctx} />
				<main id="main" class="main">
					{children}
				</main>
				<Footer ctx={ctx} />
				<Dock ctx={ctx} />
				<CartDrawer ctx={ctx} />
				<div class="toast-region" aria-live="polite" id="toasts"></div>
			</body>
		</html>
	);
}

function TopBar({ ctx }: { ctx: ViewCtx }) {
	const t = text[ctx.lang];
	const r = routes[ctx.lang];
	return (
		<div class="topbar">
			<div class="container topbar__inner">
				<p>
					<Icon name="truck" size={16} /> {t.topbar(formatShortVnd(ctx.s.shipping.freeThreshold, ctx.lang))}
				</p>
				<nav aria-label={t.quickLinks} class="topbar__links">
					<a href={r.lookup}>{t.trackOrder}</a>
					<a href={r.help}>{t.help}</a>
					<a href={site.tiktok.profileUrl} rel="noopener" target="_blank">
						TikTok @{site.tiktok.handle}
					</a>
					<LangSwitch ctx={ctx} />
				</nav>
			</div>
		</div>
	);
}

function Header({ ctx }: { ctx: ViewCtx }) {
	const t = text[ctx.lang];
	const r = routes[ctx.lang];
	return (
		<header class="site-header window">
			<div class="titlebar" aria-hidden="true">
				<span>{site.name}</span>
				<span class="titlebar__buttons">
					<i>_</i>
					<i>□</i>
					<i>×</i>
				</span>
			</div>
			<div class="container site-header__inner">
				<a class="logo" href={r.home} aria-label={t.homeLabel(site.name)}>
					<img src="/media/avatar.webp" width="40" height="40" alt="" />
					<span class="logo__text">
						<small>Mall of</small>
						<strong>Anitoy</strong>
					</span>
				</a>
				<form class="search" action={r.search} method="get" role="search">
					<label class="sr-only" for="q">
						{t.searchLabel}
					</label>
					<input id="q" name="q" type="search" placeholder={t.searchPlaceholder} autocomplete="off" value={ctx.query} />
					<button type="submit" aria-label={t.search}>
						<Icon name="search" />
					</button>
				</form>
				<div class="header-actions">
					<LangSwitch ctx={ctx} compact />
					<div class="theme-picker">
						<button type="button" class="icon-btn" data-theme-toggle aria-haspopup="menu" aria-expanded="false" aria-label={t.changeTheme}>
							<Icon name="palette" />
						</button>
						<div class="theme-menu window" role="menu" hidden>
							{THEMES.map((id) => (
								<button type="button" role="menuitemradio" data-theme-option={id} aria-checked="false">
									<span class={`swatch swatch--${id}`} aria-hidden="true"></span>
									{t.themes[id]}
								</button>
							))}
						</div>
					</div>
					<a class="icon-btn hide-mobile" href={r.lookup} aria-label={t.trackOrder}>
						<Icon name="receipt" />
					</a>
					<button type="button" class="icon-btn cart-btn" data-cart-open aria-label={t.cart}>
						<Icon name="cart" />
						<span class="badge" data-cart-count hidden>
							0
						</span>
					</button>
				</div>
			</div>
			<nav class="catnav" aria-label={t.categoriesNav}>
				<div class="container catnav__inner">
					{navLinks(ctx).map((l) => (
						<a href={l.href} aria-current={l.active ? "page" : undefined}>
							{l.label}
						</a>
					))}
				</div>
			</nav>
		</header>
	);
}

function Footer({ ctx }: { ctx: ViewCtx }) {
	const { s, lang } = ctx;
	const t = text[lang];
	const r = routes[lang];
	const policy = (anchor: keyof (typeof policyAnchors)["vi"]) => `${r.policy}#${policyAnchors[lang][anchor]}`;
	return (
		<footer class="site-footer">
			<div class="container site-footer__grid">
				<section>
					<a class="logo" href={r.home}>
						<img src="/media/avatar.webp" width="40" height="40" alt="" loading="lazy" />
						<span class="logo__text">
							<small>Mall of</small>
							<strong>Anitoy</strong>
						</span>
					</a>
					<p class="muted">{t.footerAbout(site.tiktok.handle)}</p>
					{(s.contact.phone || s.contact.email || s.contact.zalo) && (
						<ul class="plain">
							{s.contact.phone && (
								<li>
									Hotline: <a href={`tel:${s.contact.phone}`}>{s.contact.phone}</a>
								</li>
							)}
							{s.contact.zalo && (
								<li>
									Zalo: <a href={`https://zalo.me/${s.contact.zalo}`}>{s.contact.zalo}</a>
								</li>
							)}
							{s.contact.email && (
								<li>
									Email: <a href={`mailto:${s.contact.email}`}>{s.contact.email}</a>
								</li>
							)}
						</ul>
					)}
				</section>
				<nav aria-label={t.shop}>
					<h2>{t.shop}</h2>
					<ul class="plain">
						<li>
							<a href={r.products}>{t.allProducts}</a>
						</li>
						{Object.entries(collections).map(([slug, c]) => (
							<li>
								<a href={collectionPath(slug, lang)}>{groupText(c, lang).name}</a>
							</li>
						))}
						<li>
							<a href={r.videos}>{t.tiktokVideos}</a>
						</li>
					</ul>
				</nav>
				<nav aria-label={t.customerSupport}>
					<h2>{t.help}</h2>
					<ul class="plain">
						<li>
							<a href={r.lookup}>{t.trackOrder}</a>
						</li>
						<li>
							<a href={r.help}>{t.faq}</a>
						</li>
						<li>
							<a href={policy("shipping")}>{t.shippingPolicy}</a>
						</li>
						<li>
							<a href={policy("returns")}>{t.returns}</a>
						</li>
						<li>
							<a href={policy("payment")}>{t.payment}</a>
						</li>
						<li>
							<a href={policy("privacy")}>{t.privacy}</a>
						</li>
						<li>
							<a href={r.about}>{t.about}</a>
						</li>
						<li>
							<LangSwitch ctx={ctx} />
						</li>
					</ul>
				</nav>
				<section>
					<h2>{t.payment}</h2>
					<ul class="pay-badges">
						{enabledPaymentMethods(s).map((m) => (
							<li class={`pay-badge pay-badge--${m}`}>{paymentLabelsByLang[lang][m].title.replace(/ \(.*\)/, "")}</li>
						))}
					</ul>
				</section>
			</div>
			<div class="container site-footer__bottom">
				<p>{t.copyright(new Date().getUTCFullYear(), site.name, site.tiktok.handle)}</p>
				{t.deliveryNote && <p>{t.deliveryNote}</p>}
			</div>
		</footer>
	);
}

/** Mobile bottom navigation; in the Windows 95 theme it becomes the taskbar with a Start menu. */
function Dock({ ctx }: { ctx: ViewCtx }) {
	const { lang } = ctx;
	const t = text[lang];
	const r = routes[lang];
	const items = [
		{ href: r.home, icon: "home", label: t.home },
		{ href: r.products, icon: "grid", label: t.products },
		{ href: r.videos, icon: "play", label: t.videosShort },
		{ href: r.lookup, icon: "receipt", label: t.orders },
	];
	return (
		<nav class="dock" aria-label={t.quickNav}>
			<button type="button" class="start-btn" data-start-toggle aria-expanded="false">
				<img src="/media/avatar.webp" width="16" height="16" alt="" loading="lazy" />
				Start
			</button>
			<div class="start-menu window" hidden data-start-menu>
				<div class="start-menu__brand" aria-hidden="true">
					<span>Anitoy 95</span>
				</div>
				<ul class="plain">
					<li>
						<a href={r.products}>📁 {t.allProducts}</a>
					</li>
					{Object.entries(collections).map(([slug, c]) => (
						<li>
							<a href={collectionPath(slug, lang)}>🗂️ {groupText(c, lang).name}</a>
						</li>
					))}
					<li>
						<a href={r.videos}>🎬 {t.tiktokVideos}</a>
					</li>
					<li>
						<a href={r.lookup}>🔎 {t.trackOrder}</a>
					</li>
					<li>
						<a href={r.help}>❓ {t.helpMenu}</a>
					</li>
				</ul>
			</div>
			{items.map((i) => (
				<a href={i.href} class="dock__item" aria-current={ctx.path === i.href ? "page" : undefined}>
					<Icon name={i.icon} />
					<span>{i.label}</span>
				</a>
			))}
			<button type="button" class="dock__item" data-cart-open>
				<span class="dock__icon">
					<Icon name="cart" />
					<span class="badge" data-cart-count hidden>
						0
					</span>
				</span>
				<span>{t.cart}</span>
			</button>
			<span class="tray-clock" data-clock aria-hidden="true"></span>
		</nav>
	);
}

function CartDrawer({ ctx }: { ctx: ViewCtx }) {
	const { lang } = ctx;
	const t = text[lang];
	const r = routes[lang];
	return (
		<div class="drawer" id="cart-drawer" hidden>
			<div class="drawer__backdrop" data-cart-close></div>
			<aside class="drawer__panel window" role="dialog" aria-modal="true" aria-labelledby="cart-title">
				<div class="titlebar" aria-hidden="true">
					<span>{t.cart}</span>
					<span class="titlebar__buttons">
						<i>×</i>
					</span>
				</div>
				<header class="drawer__header">
					<h2 id="cart-title">{t.cart}</h2>
					<button type="button" class="icon-btn" data-cart-close aria-label={t.closeCart}>
						<Icon name="close" />
					</button>
				</header>
				<div class="drawer__body" data-cart-lines>
					<p class="muted">{t.loading}</p>
				</div>
				<footer class="drawer__footer">
					<div class="ship-meter" data-ship-meter hidden>
						<p data-ship-text></p>
						<div class="ship-meter__bar">
							<span data-ship-bar></span>
						</div>
					</div>
					<div class="row-between">
						<span>{t.subtotal}</span>
						<strong data-cart-subtotal>0 ₫</strong>
					</div>
					<a href={r.checkout} class="btn btn--accent btn--block" data-cart-checkout>
						{t.checkout}
					</a>
					<a href={r.cart} class="btn btn--ghost btn--block">
						{t.viewCart}
					</a>
					<p class="muted small center">{t.drawerShipping(formatVnd(ctx.s.shipping.localFee, lang), formatVnd(ctx.s.shipping.freeThreshold, lang))}</p>
				</footer>
			</aside>
		</div>
	);
}
