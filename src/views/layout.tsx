import type { Child } from "hono/jsx";
import { categories, collections, enabledPaymentMethods, paymentLabels, site, type Settings } from "../lib/config";
import { formatShortVnd } from "../lib/money";
import { categoryPath, collectionPath, jsonLdString } from "../lib/seo";
import { Icon } from "./icons";

export interface ViewCtx {
	s: Settings;
	path: string;
	/** Build id, appended to asset URLs so a deploy busts browser caches. */
	build: string;
	/** Current search query, kept in the header search box. */
	query?: string;
}

export interface PageMeta {
	title: string;
	description?: string;
	/** Path of the canonical URL; omitted for pages that must not be indexed. */
	canonical?: string;
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

export const THEMES = [
	{ id: "system", label: "Theo hệ thống" },
	{ id: "light", label: "Sáng" },
	{ id: "dark", label: "Tối" },
	{ id: "win95", label: "Windows 95" },
] as const;

const navLinks = (ctx: ViewCtx) => [
	{ href: "/san-pham", label: "Tất cả" },
	...Object.entries(collections).map(([slug, c]) => ({ href: collectionPath(slug), label: c.name })),
	...Object.entries(categories)
		.filter(([slug]) => slug === "accessory")
		.map(([slug, c]) => ({ href: categoryPath(slug), label: c.name })),
	{ href: "/video", label: "Video TikTok" },
].map((l) => ({ ...l, active: ctx.path === l.href }));

export function Document({ ctx, meta, children }: { ctx: ViewCtx; meta: PageMeta; children: Child }) {
	const { s } = ctx;
	const canonical = meta.canonical !== undefined ? `${s.siteUrl}${meta.canonical}` : undefined;
	const image = meta.image ? (meta.image.startsWith("http") ? meta.image : `${s.siteUrl}${meta.image}`) : `${s.siteUrl}/media/icon-512.png`;
	const v = ctx.build;
	return (
		<html lang="vi">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
				<title>{meta.title}</title>
				{meta.description && <meta name="description" content={meta.description} />}
				{canonical && <link rel="canonical" href={canonical} />}
				<meta name="robots" content={meta.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"} />
				<meta property="og:site_name" content={site.name} />
				<meta property="og:locale" content="vi_VN" />
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
			<body class={meta.bodyClass} data-shipping-fee={s.shipping.fee} data-free-threshold={s.shipping.freeThreshold}>
				<a class="skip-link" href="#main">
					Bỏ qua tới nội dung
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
	return (
		<div class="topbar">
			<div class="container topbar__inner">
				<p>
					<Icon name="truck" size={16} /> Freeship đơn từ {formatShortVnd(ctx.s.shipping.freeThreshold)} · COD toàn quốc
				</p>
				<nav aria-label="Liên kết nhanh" class="topbar__links">
					<a href="/tra-cuu-don-hang">Tra cứu đơn hàng</a>
					<a href="/ho-tro">Hỗ trợ</a>
					<a href={site.tiktok.profileUrl} rel="noopener" target="_blank">
						TikTok @{site.tiktok.handle}
					</a>
				</nav>
			</div>
		</div>
	);
}

function Header({ ctx }: { ctx: ViewCtx }) {
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
				<a class="logo" href="/" aria-label={`${site.name} – Trang chủ`}>
					<img src="/media/avatar.webp" width="40" height="40" alt="" />
					<span class="logo__text">
						<small>Mall of</small>
						<strong>Anitoy</strong>
					</span>
				</a>
				<form class="search" action="/tim-kiem" method="get" role="search">
					<label class="sr-only" for="q">
						Tìm sản phẩm
					</label>
					<input id="q" name="q" type="search" placeholder="Tìm Frieren, neko, móc khoá…" autocomplete="off" value={ctx.query} />
					<button type="submit" aria-label="Tìm kiếm">
						<Icon name="search" />
					</button>
				</form>
				<div class="header-actions">
					<div class="theme-picker">
						<button type="button" class="icon-btn" data-theme-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Đổi giao diện">
							<Icon name="palette" />
						</button>
						<div class="theme-menu window" role="menu" hidden>
							{THEMES.map((t) => (
								<button type="button" role="menuitemradio" data-theme-option={t.id} aria-checked="false">
									<span class={`swatch swatch--${t.id}`} aria-hidden="true"></span>
									{t.label}
								</button>
							))}
						</div>
					</div>
					<a class="icon-btn hide-mobile" href="/tra-cuu-don-hang" aria-label="Tra cứu đơn hàng">
						<Icon name="receipt" />
					</a>
					<button type="button" class="icon-btn cart-btn" data-cart-open aria-label="Giỏ hàng">
						<Icon name="cart" />
						<span class="badge" data-cart-count hidden>
							0
						</span>
					</button>
				</div>
			</div>
			<nav class="catnav" aria-label="Danh mục">
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
	const { s } = ctx;
	return (
		<footer class="site-footer">
			<div class="container site-footer__grid">
				<section>
					<a class="logo" href="/">
						<img src="/media/avatar.webp" width="40" height="40" alt="" loading="lazy" />
						<span class="logo__text">
							<small>Mall of</small>
							<strong>Anitoy</strong>
						</span>
					</a>
					<p class="muted">Shop mô hình anime chibi của @{site.tiktok.handle}.</p>
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
				<nav aria-label="Mua sắm">
					<h2>Mua sắm</h2>
					<ul class="plain">
						<li>
							<a href="/san-pham">Tất cả sản phẩm</a>
						</li>
						{Object.entries(collections).map(([slug, c]) => (
							<li>
								<a href={collectionPath(slug)}>{c.name}</a>
							</li>
						))}
						<li>
							<a href="/video">Video TikTok</a>
						</li>
					</ul>
				</nav>
				<nav aria-label="Hỗ trợ khách hàng">
					<h2>Hỗ trợ</h2>
					<ul class="plain">
						<li>
							<a href="/tra-cuu-don-hang">Tra cứu đơn hàng</a>
						</li>
						<li>
							<a href="/ho-tro">Câu hỏi thường gặp</a>
						</li>
						<li>
							<a href="/chinh-sach#giao-hang">Chính sách giao hàng</a>
						</li>
						<li>
							<a href="/chinh-sach#doi-tra">Đổi trả</a>
						</li>
						<li>
							<a href="/chinh-sach#thanh-toan">Thanh toán</a>
						</li>
						<li>
							<a href="/chinh-sach#bao-mat">Bảo mật thông tin</a>
						</li>
						<li>
							<a href="/gioi-thieu">Giới thiệu</a>
						</li>
					</ul>
				</nav>
				<section>
					<h2>Thanh toán</h2>
					<ul class="pay-badges">
						{enabledPaymentMethods(s).map((m) => (
							<li class={`pay-badge pay-badge--${m}`}>{paymentLabels[m].title.replace(/ \(.*\)/, "")}</li>
						))}
					</ul>
				</section>
			</div>
			<div class="container site-footer__bottom">
				<p>
					© {new Date().getUTCFullYear()} {site.name}. Ảnh và video sản phẩm thuộc @{site.tiktok.handle}.
				</p>
			</div>
		</footer>
	);
}

/** Mobile bottom navigation; in the Windows 95 theme it becomes the taskbar with a Start menu. */
function Dock({ ctx }: { ctx: ViewCtx }) {
	const items = [
		{ href: "/", icon: "home", label: "Trang chủ" },
		{ href: "/san-pham", icon: "grid", label: "Sản phẩm" },
		{ href: "/video", icon: "play", label: "Video" },
		{ href: "/tra-cuu-don-hang", icon: "receipt", label: "Đơn hàng" },
	];
	return (
		<nav class="dock" aria-label="Điều hướng nhanh">
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
						<a href="/san-pham">📁 Tất cả sản phẩm</a>
					</li>
					{Object.entries(collections).map(([slug, c]) => (
						<li>
							<a href={collectionPath(slug)}>🗂️ {c.name}</a>
						</li>
					))}
					<li>
						<a href="/video">🎬 Video TikTok</a>
					</li>
					<li>
						<a href="/tra-cuu-don-hang">🔎 Tra cứu đơn hàng</a>
					</li>
					<li>
						<a href="/ho-tro">❓ Trợ giúp</a>
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
				<span>Giỏ hàng</span>
			</button>
			<span class="tray-clock" data-clock aria-hidden="true"></span>
		</nav>
	);
}

function CartDrawer({ ctx }: { ctx: ViewCtx }) {
	return (
		<div class="drawer" id="cart-drawer" hidden>
			<div class="drawer__backdrop" data-cart-close></div>
			<aside class="drawer__panel window" role="dialog" aria-modal="true" aria-labelledby="cart-title">
				<div class="titlebar" aria-hidden="true">
					<span>Giỏ hàng</span>
					<span class="titlebar__buttons">
						<i>×</i>
					</span>
				</div>
				<header class="drawer__header">
					<h2 id="cart-title">Giỏ hàng</h2>
					<button type="button" class="icon-btn" data-cart-close aria-label="Đóng giỏ hàng">
						<Icon name="close" />
					</button>
				</header>
				<div class="drawer__body" data-cart-lines>
					<p class="muted">Đang tải…</p>
				</div>
				<footer class="drawer__footer">
					<div class="ship-meter" data-ship-meter hidden>
						<p data-ship-text></p>
						<div class="ship-meter__bar">
							<span data-ship-bar></span>
						</div>
					</div>
					<div class="row-between">
						<span>Tạm tính</span>
						<strong data-cart-subtotal>0 ₫</strong>
					</div>
					<a href="/thanh-toan" class="btn btn--accent btn--block" data-cart-checkout>
						Thanh toán
					</a>
					<a href="/gio-hang" class="btn btn--ghost btn--block">
						Xem giỏ hàng
					</a>
					<p class="muted small center">Phí ship {formatShortVnd(ctx.s.shipping.fee)} · miễn phí từ {formatShortVnd(ctx.s.shipping.freeThreshold)}</p>
				</footer>
			</aside>
		</div>
	);
}
