import type { Child } from "hono/jsx";
import { collectionName, isSoldOut, leadSku, priceRange, productViews, tiktokVideoUrl } from "../lib/catalog";
import type { Settings } from "../lib/config";
import { formatCount, formatVnd, percentOff } from "../lib/money";
import { imageSrc, productPath } from "../lib/seo";
import type { Product, Video } from "../lib/types";
import { Icon } from "./icons";

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

export function SectionHeader({ title, sub, href, linkLabel = "Xem tất cả" }: { title: string; sub?: string; href?: string; linkLabel?: string }) {
	return (
		<div class="section-head">
			<div>
				<h2>{title}</h2>
				{sub && <p class="muted">{sub}</p>}
			</div>
			{href && (
				<a class="link-more" href={href}>
					{linkLabel} <Icon name="chevron" size={16} />
				</a>
			)}
		</div>
	);
}

export function Price({ product, showTag = true }: { product: Product; showTag?: boolean }) {
	const sku = leadSku(product);
	if (!sku) return null;
	const range = priceRange(product);
	const off = percentOff(sku.price, sku.compareAtPrice);
	return (
		<div class="price-row">
			<span class="price">
				{range.max > range.min && <small>từ </small>}
				{formatVnd(sku.price)}
			</span>
			{sku.compareAtPrice && <s class="price-was">{formatVnd(sku.compareAtPrice)}</s>}
			{showTag && off && <span class="tag tag--sale">-{off}%</span>}
		</div>
	);
}

/** Rating and units sold on TikTok Shop, attributed (not presented as this site's reviews). */
export function TikTokStats({ product, long = false }: { product: Product; long?: boolean }) {
	const r = product.tiktokRating;
	const sold = product.tiktokSold ?? 0;
	if (!r && !sold) return null;
	return (
		<p class="tt-stats" title="Đánh giá và lượt bán trên TikTok Shop">
			{r && (
				<span class="tt-stats__rating">
					<Icon name="star" size={14} /> {r.value.toFixed(1)}
					{long && <span class="muted"> ({r.count} đánh giá)</span>}
				</span>
			)}
			{sold > 0 && <span>Đã bán {formatCount(sold)}</span>}
			{long && <span class="muted">trên TikTok Shop</span>}
		</p>
	);
}

export function ProductCard({ s, product, eager = false }: { s: Settings; product: Product; eager?: boolean }) {
	const sku = leadSku(product);
	const soldOut = isSoldOut(product);
	const views = productViews(product);
	const off = sku ? percentOff(sku.price, sku.compareAtPrice) : undefined;
	const image = product.images[0] ?? "/media/icon-512.png";
	const single = product.skus.length === 1 && sku && !soldOut;
	return (
		<article class={`product-card window${soldOut ? " is-soldout" : ""}`}>
			<a class="product-card__media" href={productPath(product)} tabindex={-1} aria-hidden="true">
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
				{soldOut && <span class="tag tag--muted product-card__off">Hết hàng</span>}
				{views > 0 && (
					<span class="product-card__views">
						<Icon name="play" size={12} /> {formatCount(views)}
					</span>
				)}
			</a>
			<div class="product-card__body">
				<span class="eyebrow">{collectionName(product.collection)}</span>
				<h3 class="product-card__title">
					<a href={productPath(product)}>{product.title}</a>
				</h3>
				<Price product={product} showTag={false} />
				<div class="product-card__foot">
					<TikTokStats product={product} />
					{single ? (
						<button
							type="button"
							class="icon-btn icon-btn--accent"
							aria-label={`Thêm ${product.title} vào giỏ`}
							data-add-to-cart={JSON.stringify({ productId: product.id, skuId: sku.id, price: sku.price })}
						>
							<Icon name="plus" />
						</button>
					) : (
						<a class="icon-btn" href={productPath(product)} aria-label={`Chọn mẫu ${product.title}`}>
							<Icon name="chevron" />
						</a>
					)}
				</div>
			</div>
		</article>
	);
}

export function ProductGrid({ s, products, eagerFirst = 0 }: { s: Settings; products: Product[]; eagerFirst?: number }) {
	return (
		<div class="product-grid">
			{products.map((p, i) => (
				<ProductCard s={s} product={p} eager={i < eagerFirst} />
			))}
		</div>
	);
}

/**
 * A TikTok video as a lightweight facade: the cover and view count load with the page, and
 * TikTok's official embed player loads only when the shopper taps play.
 */
export function VideoCard({ video, product, compact = false }: { video: Video; product?: Product; compact?: boolean }) {
	return (
		<figure class={`video-card window${compact ? " video-card--compact" : ""}`}>
			<button type="button" class="video-card__play" data-tiktok-play={video.id} aria-label={`Phát video: ${video.title || "TikTok"}`}>
				<img src={video.cover} width="270" height="480" alt="" loading="lazy" decoding="async" />
				<span class="video-card__views">
					<Icon name="play" size={12} /> {formatCount(video.views)} lượt xem
				</span>
				<span class="video-card__btn" aria-hidden="true">
					<Icon name="play" size={28} />
				</span>
			</button>
			<figcaption>
				<p class="video-card__title">{video.title}</p>
				<p class="small muted">
					<a href={tiktokVideoUrl(video.id)} target="_blank" rel="noopener">
						@leduyenminh trên TikTok
					</a>
					{product && (
						<>
							{" · "}
							<a href={productPath(product)}>Xem sản phẩm</a>
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

export function Perks({ s }: { s: Settings }) {
	const items = [
		{ icon: "truck", title: "Freeship", text: `Đơn từ ${formatVnd(s.shipping.freeThreshold)}` },
		{ icon: "cash", title: "COD toàn quốc", text: "Kiểm tra rồi mới trả tiền" },
		{ icon: "qr", title: "Chuyển khoản VietQR", text: "Tiền về thẳng tài khoản BIDV của shop" },
		{ icon: "tiktok", title: "Video thật", text: "Mọi sản phẩm đều có trên TikTok" },
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
