import { categoryName, collectionName, isSoldOut, leadSku, productVideos } from "../../lib/catalog";
import { enabledPaymentMethods, paymentLabelsByLang, site } from "../../lib/config";
import { routes } from "../../lib/i18n";
import { formatVnd, percentOff } from "../../lib/money";
import { categoryPath, collectionPath, imageSrc } from "../../lib/seo";
import type { Product } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { text } from "../text";
import { Breadcrumbs, Paragraphs, ProductGrid, Rail, SectionHeader, TikTokStats, VideoCard } from "../ui";

/**
 * `product` and `related` are already in the page's language (localizeProduct). `untranslated`:
 * an English page whose title and description are still the Vietnamese ones.
 */
export function ProductPage({
	ctx,
	product,
	related,
	selectedSkuId,
	untranslated = false,
}: {
	ctx: ViewCtx;
	product: Product;
	related: Product[];
	selectedSkuId?: string;
	untranslated?: boolean;
}) {
	const { s, lang } = ctx;
	const t = text[lang];
	const textLang = untranslated ? "vi" : undefined;
	const soldOut = isSoldOut(product);
	const sku = product.skus.find((k) => k.id === selectedSkuId) ?? leadSku(product)!;
	const off = percentOff(sku.price, sku.compareAtPrice);
	const vids = productVideos(product);
	const totalViews = vids.reduce((n, v) => n + v.views, 0);
	const gallery = [...new Set([...(sku.image ? [sku.image] : []), ...product.images])];
	const methods = enabledPaymentMethods(s);
	// Data for the variant picker and cart (prices are re-checked by the server at checkout).
	const data = {
		id: product.id,
		title: product.title,
		slug: product.slug,
		skus: product.skus.map((k) => ({ id: k.id, name: k.name, price: k.price, compareAtPrice: k.compareAtPrice ?? null, stock: k.stock, image: k.image ?? null })),
	};

	return (
		<div class="container page pdp" data-product={JSON.stringify(data)}>
			<Breadcrumbs
				items={[
					{ name: t.home, href: routes[lang].home },
					{ name: collectionName(product.collection, lang), href: collectionPath(product.collection, lang) },
					{ name: product.title },
				]}
			/>
			<div class="pdp__hero">
				<section class="gallery window" aria-label={t.productPhotos}>
					<div class="gallery__main" data-gallery-track>
						{gallery.map((src, i) => (
							<img
								src={imageSrc(s, src, 900)}
								width="800"
								height="800"
								alt={i === 0 ? product.title : t.photoAlt(product.title, i + 1)}
								loading={i === 0 ? "eager" : "lazy"}
								fetchpriority={i === 0 ? "high" : undefined}
								decoding="async"
								data-gallery-slide={i}
							/>
						))}
					</div>
					<div class="gallery__thumbs" role="tablist" aria-label={t.choosePhoto}>
						{gallery.map((src, i) => (
							<button type="button" role="tab" aria-selected={i === 0 ? "true" : "false"} data-gallery-thumb={i} aria-label={t.photo(i + 1)}>
								<img src={imageSrc(s, src, 160)} width="72" height="72" alt="" loading="lazy" />
							</button>
						))}
						{vids.slice(0, 4).map((v) => (
							<button type="button" class="gallery__video" data-tiktok-play={v.id} aria-label={t.playTikTok}>
								<img src={v.cover} width="72" height="72" alt="" loading="lazy" />
								<Icon name="play" size={18} />
							</button>
						))}
					</div>
				</section>

				<section class="buybox">
					<a class="eyebrow" href={collectionPath(product.collection, lang)}>
						{collectionName(product.collection, lang)}
					</a>
					<h1 class="buybox__title" lang={textLang}>
						{product.title}
					</h1>
					<div class="buybox__meta">
						<TikTokStats product={product} lang={lang} long />
						{totalViews > 0 && (
							<a href="#videos" class="small">
								<Icon name="play" size={14} /> {t.videoCount(vids.length)}
							</a>
						)}
					</div>

					<div class="buybox__price window">
						<span class="price price--lg" data-price>
							{formatVnd(sku.price, lang)}
						</span>
						<s class="price-was" data-compare hidden={!sku.compareAtPrice}>
							{sku.compareAtPrice ? formatVnd(sku.compareAtPrice, lang) : ""}
						</s>
						<span class="tag tag--sale" data-off hidden={!off}>
							{off ? `-${off}%` : ""}
						</span>
						{sku.compareAtPrice && <p class="small muted">{t.compareAtNote}</p>}
					</div>

					{product.skus.length > 1 && (
						<fieldset class="variants">
							<legend>
								{t.variant} <strong data-variant-name>{sku.name}</strong>
							</legend>
							<div class="variants__list">
								{product.skus.map((k) => (
									<label class={`variant${k.stock <= 0 ? " is-out" : ""}`}>
										<input type="radio" name="sku" value={k.id} checked={k.id === sku.id} data-sku-option />
										{k.image && <img src={imageSrc(s, k.image, 96)} width="36" height="36" alt="" loading="lazy" />}
										<span>{k.name}</span>
										{k.stock <= 0 && <small>{t.variantSoldOut}</small>}
									</label>
								))}
							</div>
						</fieldset>
					)}

					<div class="qty-row">
						<span>{t.quantity}</span>
						<div class="stepper" data-stepper>
							<button type="button" aria-label={t.decrease} data-step="-1">
								<Icon name="minus" size={16} />
							</button>
							<input type="number" inputmode="numeric" min="1" max="20" value="1" aria-label={t.quantity} data-qty />
							<button type="button" aria-label={t.increase} data-step="1">
								<Icon name="plus" size={16} />
							</button>
						</div>
						<span class="small muted" data-stock>
							{sku.stock > 0 ? t.inStock(sku.stock) : t.soldOut}
						</span>
					</div>

					<div class="buybox__actions">
						<button type="button" class="btn btn--primary btn--lg" data-add-current disabled={soldOut}>
							<Icon name="cart" /> {t.addToCart}
						</button>
						<button type="button" class="btn btn--accent btn--lg" data-buy-now disabled={soldOut}>
							{t.buyNow}
						</button>
					</div>
					{soldOut && (
						<p class="notice">
							{t.soldOutHere}
							{product.tiktokUrl ? t.soldOutSeeTikTok : ""}
						</p>
					)}
					{product.tiktokUrl && (
						<a class="btn btn--ghost btn--block" href={product.tiktokUrl} target="_blank" rel="noopener nofollow">
							<Icon name="tiktok" size={18} /> {t.viewOnTikTokShop}
						</a>
					)}

					<ul class="assurance window">
						<li>
							<Icon name="truck" size={18} /> {t.deliveryAssurance(s.shipping.eta, formatVnd(s.shipping.freeThreshold, lang))}
						</li>
						<li>
							<Icon name="cash" size={18} /> {t.paymentAssurance(methods.map((m) => paymentLabelsByLang[lang][m].title.replace(/ \(.*\)/, "")).join(", "))}
						</li>
						<li>
							<Icon name="shield" size={18} /> {s.returnDays > 0 ? t.returnsWithin(s.returnDays) : t.replacedIfDamaged}
						</li>
					</ul>
				</section>
			</div>

			<div class="pdp__details">
				<section class="window card-pad" aria-labelledby="desc-title">
					<h2 id="desc-title">{t.description}</h2>
					{untranslated && t.descriptionUntranslated && <p class="small muted">{t.descriptionUntranslated}</p>}
					<div class="prose" lang={textLang}>
						<Paragraphs text={product.description} />
					</div>
				</section>
				{product.attributes.length > 0 && (
					<section class="window card-pad" aria-labelledby="spec-title">
						<h2 id="spec-title">{t.specs}</h2>
						<dl class="specs">
							<dt>{t.category}</dt>
							<dd>
								<a href={categoryPath(product.category, lang)}>{categoryName(product.category, lang)}</a>
							</dd>
							{product.attributes.map((a) => (
								<>
									<dt>{a.name}</dt>
									<dd>{a.value}</dd>
								</>
							))}
						</dl>
					</section>
				)}
			</div>

			{vids.length > 0 && (
				<section class="section" id="videos">
					<SectionHeader title={t.videosOnTikTok} sub={t.videosFrom(vids.length, site.tiktok.handle)} />
					<Rail label={t.productVideos}>
						{vids.map((v) => (
							<VideoCard video={v} lang={lang} compact />
						))}
					</Rail>
				</section>
			)}

			{related.length > 0 && (
				<section class="section">
					<SectionHeader title={t.youMayAlsoLike} href={collectionPath(product.collection, lang)} linkLabel={t.viewAll} />
					<ProductGrid s={s} lang={lang} products={related} />
				</section>
			)}

			<div class="buybar window" data-buybar>
				<div>
					<span class="price" data-price>
						{formatVnd(sku.price, lang)}
					</span>
				</div>
				<button type="button" class="btn btn--primary" data-add-current disabled={soldOut}>
					<Icon name="cart" size={18} />
					<span class="sr-only">{t.addToCart}</span>
				</button>
				<button type="button" class="btn btn--accent" data-buy-now disabled={soldOut}>
					{t.buyNow}
				</button>
			</div>
		</div>
	);
}
