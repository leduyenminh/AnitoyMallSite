import type { Child } from "hono/jsx";
import { collectionName, combinedRating, isSoldOut, leadSku, priceRange, productViews, tiktokVideoUrl, unitsSold } from "../lib/catalog";
import type { Settings } from "../lib/config";
import type { Lang } from "../lib/i18n";
import { formatCount, formatVnd, percentOff } from "../lib/money";
import type { PublicReview } from "../lib/reviews";
import { imageSrc, productPath } from "../lib/seo";
import type { Product, Video } from "../lib/types";
import { Icon } from "./icons";
import { text } from "./text";

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
	return (
		<nav class="breadcrumbs" aria-label="Breadcrumb">
			<ol>
				{items.map((item, i) => (
					<li>
						{item.href && i < items.length - 1 ? <a href={item.href}>{item.name}</a> : <span aria-current="page">{item.name}</span>}
					</li>
				))}
			</ol>
		</nav>
	);
}

export function SectionHeader({ title, sub, href, linkLabel }: { title: string; sub?: string; href?: string; linkLabel?: string }) {
	return (
		<div class="section-head">
			<div>
				<h2>{title}</h2>
				{sub && <p class="muted">{sub}</p>}
			</div>
			{href && (
				<a class="link-more" href={href}>
					{linkLabel ?? text.vi.viewAll} <Icon name="chevron" size={16} />
				</a>
			)}
		</div>
	);
}

export function Price({ product, lang, showTag = true }: { product: Product; lang: Lang; showTag?: boolean }) {
	const sku = leadSku(product);
	if (!sku) return null;
	const range = priceRange(product);
	const off = percentOff(sku.price, sku.compareAtPrice);
	return (
		<div class="price-row">
			<span class="price">
				{range.max > range.min && <small>{text[lang].from}</small>}
				{formatVnd(sku.price, lang)}
			</span>
			{sku.compareAtPrice && <s class="price-was">{formatVnd(sku.compareAtPrice, lang)}</s>}
			{showTag && off && <span class="tag tag--sale">-{off}%</span>}
		</div>
	);
}

/**
 * The rating of TikTok Shop (as imported) and this website's approved reviews combined, attributed
 * to both, and units sold on TikTok Shop and this website together. `long` adds the counts and
 * each side's own rating.
 */
export function TikTokStats({ product, lang, long = false }: { product: Product; lang: Lang; long?: boolean }) {
	const t = text[lang];
	const r = combinedRating(product);
	const sold = unitsSold(product);
	if (!r && !sold) return null;
	const where = r?.tiktok && r.site ? t.ratingsBoth(r.count) : r?.site ? t.ratingsSite(r.count) : t.ttRatings(r?.tiktok?.count ?? 0);
	return (
		<>
			<p class="tt-stats">
				{r && (
					<span class="tt-stats__rating" title={r.tiktok && r.site ? t.ratingTitle : r.site ? t.siteRatingTitle : t.ttRatingTitle}>
						<Icon name="star" size={14} /> {r.value.toFixed(1)}
						{long && <span class="muted">{where}</span>}
					</span>
				)}
				{sold > 0 && (
					<span title={t.soldTitle}>
						{t.sold(formatCount(sold, lang))}
						{long && <span class="muted">{t.soldWhere}</span>}
					</span>
				)}
			</p>
			{long && r?.tiktok && r.site && <p class="small muted">{t.ratingSplit(r.tiktok.value.toFixed(1), r.tiktok.count, r.site.value.toFixed(1), r.site.count)}</p>}
		</>
	);
}

/** Approved reviews from this website's buyers (plain text, masked names). */
export function ReviewList({ reviews, count, lang }: { reviews: PublicReview[]; count: number; lang: Lang }) {
	const t = text[lang];
	const date = new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });
	return (
		<section class="section" id="reviews" aria-labelledby="reviews-title">
			<SectionHeader title={t.reviewsTitle} sub={t.reviewsSub(count)} />
			<ul class="reviews">
				{reviews.map((r) => (
					<li class="review window card-pad">
						<p class="review__head">
							<span class="tt-stats__rating" role="img" aria-label={t.stars(r.rating)}>
								{"★".repeat(r.rating)}
								<span class="muted">{"★".repeat(5 - r.rating)}</span>
							</span>{" "}
							<strong>{r.author}</strong> · <span class="small muted">{t.verifiedBuyer}</span> ·{" "}
							<time class="small muted" datetime={r.createdAt}>
								{date.format(new Date(r.createdAt))}
							</time>
						</p>
						{r.comment && (
							<div class="prose" lang={r.lang === lang ? undefined : r.lang}>
								<Paragraphs text={r.comment} />
							</div>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

/** `product` is already in `lang` (localizeProduct). */
export function ProductCard({ s, lang, product, eager = false }: { s: Settings; lang: Lang; product: Product; eager?: boolean }) {
	const t = text[lang];
	const sku = leadSku(product);
	const soldOut = isSoldOut(product);
	const views = productViews(product);
	const off = sku ? percentOff(sku.price, sku.compareAtPrice) : undefined;
	const image = product.images[0] ?? "/media/icon-512.png";
	const single = product.skus.length === 1 && sku && !soldOut;
	const href = productPath(product, lang);
	return (
		<article class={`product-card window${soldOut ? " is-soldout" : ""}`}>
			<a class="product-card__media" href={href} tabindex={-1} aria-hidden="true">
				<img
					src={imageSrc(s, image, 480)}
					width="400"
					height="400"
					alt=""
					loading={eager ? "eager" : "lazy"}
					decoding="async"
					fetchpriority={eager ? "high" : undefined}
				/>
				{off && !soldOut && <span class="tag tag--sale product-card__off">-{off}%</span>}
				{soldOut && <span class="tag tag--muted product-card__off">{t.soldOut}</span>}
				{views > 0 && (
					<span class="product-card__views">
						<Icon name="play" size={12} /> {formatCount(views, lang)}
					</span>
				)}
			</a>
			<div class="product-card__body">
				<span class="eyebrow">{collectionName(product.collection, lang)}</span>
				<h3 class="product-card__title">
					<a href={href}>{product.title}</a>
				</h3>
				<Price product={product} lang={lang} showTag={false} />
				<div class="product-card__foot">
					<TikTokStats product={product} lang={lang} />
					{single ? (
						<button
							type="button"
							class="icon-btn icon-btn--accent"
							aria-label={t.addToCartLabel(product.title)}
							data-add-to-cart={JSON.stringify({ productId: product.id, skuId: sku.id, price: sku.price })}
						>
							<Icon name="plus" />
						</button>
					) : (
						<a class="icon-btn" href={href} aria-label={t.chooseVariantLabel(product.title)}>
							<Icon name="chevron" />
						</a>
					)}
				</div>
			</div>
		</article>
	);
}

export function ProductGrid({ s, lang, products, eagerFirst = 0 }: { s: Settings; lang: Lang; products: Product[]; eagerFirst?: number }) {
	return (
		<div class="product-grid">
			{products.map((p, i) => (
				<ProductCard s={s} lang={lang} product={p} eager={i < eagerFirst} />
			))}
		</div>
	);
}

/**
 * A TikTok video as a lightweight facade: the cover and view count load with the page, and
 * TikTok's official embed player loads only when the shopper taps play. Video titles are the
 * TikTok captions, in Vietnamese on every page.
 */
export function VideoCard({ video, lang, product, compact = false }: { video: Video; lang: Lang; product?: Product; compact?: boolean }) {
	const t = text[lang];
	return (
		<figure class={`video-card window${compact ? " video-card--compact" : ""}`}>
			<button type="button" class="video-card__play" data-tiktok-play={video.id} aria-label={t.playVideo(video.title || "TikTok")}>
				<img src={video.cover} width="270" height="480" alt="" loading="lazy" decoding="async" />
				<span class="video-card__views">
					<Icon name="play" size={12} /> {t.views(formatCount(video.views, lang))}
				</span>
				<span class="video-card__btn" aria-hidden="true">
					<Icon name="play" size={28} />
				</span>
			</button>
			<figcaption>
				<p class="video-card__title" lang={lang === "vi" ? undefined : "vi"}>
					{video.title}
				</p>
				<p class="small muted">
					<a href={tiktokVideoUrl(video.id)} target="_blank" rel="noopener">
						{t.onTikTok("leduyenminh")}
					</a>
					{product && (
						<>
							{" · "}
							<a href={productPath(product, lang)}>{t.viewProduct}</a>
						</>
					)}
				</p>
			</figcaption>
		</figure>
	);
}

export function Rail({ children, label }: { children: Child; label: string }) {
	return (
		<div class="rail" role="region" aria-label={label} tabindex={0}>
			{children}
		</div>
	);
}

export function Perks({ s, lang }: { s: Settings; lang: Lang }) {
	const p = text[lang].perks;
	const items = [
		{ icon: "truck", title: p.freeTitle, text: p.freeText(formatVnd(s.shipping.freeThreshold, lang)) },
		{ icon: "cash", title: p.codTitle, text: p.codText },
		{ icon: "qr", title: p.qrTitle, text: p.qrText },
	];
	return (
		<ul class="perks">
			{items.map((i) => (
				<li class="window">
					<span class="perks__icon">
						<Icon name={i.icon} size={22} />
					</span>
					<span>
						<strong>{i.title}</strong>
						<small>{i.text}</small>
					</span>
				</li>
			))}
		</ul>
	);
}

/** Plain-text paragraphs (descriptions are never rendered as HTML). */
export function Paragraphs({ text }: { text: string }) {
	return (
		<>
			{text
				.split(/\n{2,}/)
				.map((para) => para.trim())
				.filter(Boolean)
				.map((para) => (
					<p>
						{para.split("\n").map((line, i) => (
							<>
								{i > 0 && <br />}
								{line}
							</>
						))}
					</p>
				))}
		</>
	);
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: { href: string; label: string } }) {
	return (
		<div class="empty window">
			<Icon name="box" size={40} />
			<h2>{title}</h2>
			{text && <p class="muted">{text}</p>}
			{action && (
				<a class="btn btn--primary" href={action.href}>
					{action.label}
				</a>
			)}
		</div>
	);
}
