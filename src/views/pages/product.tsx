import { categoryName, collectionName, isSoldOut, leadSku, productVideos } from "../../lib/catalog";
import { enabledPaymentMethods, paymentLabels } from "../../lib/config";
import { formatVnd, percentOff } from "../../lib/money";
import { categoryPath, collectionPath, imageSrc } from "../../lib/seo";
import type { Product } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { Breadcrumbs, Paragraphs, ProductGrid, Rail, SectionHeader, TikTokStats, VideoCard } from "../ui";

export function ProductPage({ ctx, product, related, selectedSkuId }: { ctx: ViewCtx; product: Product; related: Product[]; selectedSkuId?: string }) {
	const { s } = ctx;
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
					{ name: "Trang chủ", href: "/" },
					{ name: collectionName(product.collection), href: collectionPath(product.collection) },
					{ name: product.title },
				]}
			/>
			<div class="pdp__hero">
				<section class="gallery window" aria-label="Ảnh sản phẩm">
					<div class="gallery__main" data-gallery-track>
						{gallery.map((src, i) => (
							<img
								src={imageSrc(s, src, 900)}
								width="800"
								height="800"
								alt={i === 0 ? product.title : `${product.title} – ảnh ${i + 1}`}
								loading={i === 0 ? "eager" : "lazy"}
								fetchpriority={i === 0 ? "high" : undefined}
								decoding="async"
								data-gallery-slide={i}
							/>
						))}
					</div>
					<div class="gallery__thumbs" role="tablist" aria-label="Chọn ảnh">
						{gallery.map((src, i) => (
							<button type="button" role="tab" aria-selected={i === 0 ? "true" : "false"} data-gallery-thumb={i} aria-label={`Ảnh ${i + 1}`}>
								<img src={imageSrc(s, src, 160)} width="72" height="72" alt="" loading="lazy" />
							</button>
						))}
						{vids.slice(0, 4).map((v) => (
							<button type="button" class="gallery__video" data-tiktok-play={v.id} aria-label="Phát video TikTok">
								<img src={v.cover} width="72" height="72" alt="" loading="lazy" />
								<Icon name="play" size={18} />
							</button>
						))}
					</div>
				</section>

				<section class="buybox">
					<a class="eyebrow" href={collectionPath(product.collection)}>
						{collectionName(product.collection)}
					</a>
					<h1 class="buybox__title">{product.title}</h1>
					<div class="buybox__meta">
						<TikTokStats product={product} long />
						{totalViews > 0 && (
							<a href="#videos" class="small">
								<Icon name="play" size={14} /> {vids.length} video TikTok
							</a>
						)}
					</div>

					<div class="buybox__price window">
						<span class="price price--lg" data-price>
							{formatVnd(sku.price)}
						</span>
						<s class="price-was" data-compare hidden={!sku.compareAtPrice}>
							{sku.compareAtPrice ? formatVnd(sku.compareAtPrice) : ""}
						</s>
						<span class="tag tag--sale" data-off hidden={!off}>
							{off ? `-${off}%` : ""}
						</span>
						{sku.compareAtPrice && <p class="small muted">Giá gạch là giá niêm yết trên TikTok Shop.</p>}
					</div>

					{product.skus.length > 1 && (
						<fieldset class="variants">
							<legend>
								Mẫu: <strong data-variant-name>{sku.name}</strong>
							</legend>
							<div class="variants__list">
								{product.skus.map((k) => (
									<label class={`variant${k.stock <= 0 ? " is-out" : ""}`}>
										<input type="radio" name="sku" value={k.id} checked={k.id === sku.id} data-sku-option />
										{k.image && <img src={imageSrc(s, k.image, 96)} width="36" height="36" alt="" loading="lazy" />}
										<span>{k.name}</span>
										{k.stock <= 0 && <small>Hết</small>}
									</label>
								))}
							</div>
						</fieldset>
					)}

					<div class="qty-row">
						<span>Số lượng</span>
						<div class="stepper" data-stepper>
							<button type="button" aria-label="Giảm" data-step="-1">
								<Icon name="minus" size={16} />
							</button>
							<input type="number" inputmode="numeric" min="1" max="20" value="1" aria-label="Số lượng" data-qty />
							<button type="button" aria-label="Tăng" data-step="1">
								<Icon name="plus" size={16} />
							</button>
						</div>
						<span class="small muted" data-stock>
							{sku.stock > 0 ? `Còn ${sku.stock} sản phẩm` : "Hết hàng"}
						</span>
					</div>

					<div class="buybox__actions">
						<button type="button" class="btn btn--primary btn--lg" data-add-current disabled={soldOut}>
							<Icon name="cart" /> Thêm vào giỏ
						</button>
						<button type="button" class="btn btn--accent btn--lg" data-buy-now disabled={soldOut}>
							Mua ngay
						</button>
					</div>
					{soldOut && <p class="notice">Sản phẩm tạm hết hàng trên website.{product.tiktokUrl ? " Bạn có thể xem trên TikTok Shop." : ""}</p>}
					{product.tiktokUrl && (
						<a class="btn btn--ghost btn--block" href={product.tiktokUrl} target="_blank" rel="noopener nofollow">
							<Icon name="tiktok" size={18} /> Xem trên TikTok Shop
						</a>
					)}

					<ul class="assurance window">
						<li>
							<Icon name="truck" size={18} /> Giao trong {s.shipping.eta} ngày · freeship đơn từ {formatVnd(s.shipping.freeThreshold)}
						</li>
						<li>
							<Icon name="cash" size={18} /> Thanh toán: {methods.map((m) => paymentLabels[m].title.replace(/ \(.*\)/, "")).join(", ")}
						</li>
						<li>
							<Icon name="shield" size={18} /> {s.returnDays > 0 ? `Đổi trả trong ${s.returnDays} ngày` : "Đổi mới nếu hàng lỗi do vận chuyển"}
						</li>
					</ul>
				</section>
			</div>

			<div class="pdp__details">
				<section class="window card-pad" aria-labelledby="desc-title">
					<h2 id="desc-title">Mô tả sản phẩm</h2>
					<div class="prose">
						<Paragraphs text={product.description} />
					</div>
				</section>
				{product.attributes.length > 0 && (
					<section class="window card-pad" aria-labelledby="spec-title">
						<h2 id="spec-title">Thông số</h2>
						<dl class="specs">
							<dt>Danh mục</dt>
							<dd>
								<a href={categoryPath(product.category)}>{categoryName(product.category)}</a>
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
					<SectionHeader title="Video trên TikTok" sub={`${vids.length} video từ @leduyenminh`} />
					<Rail label="Video sản phẩm">
						{vids.map((v) => (
							<VideoCard video={v} compact />
						))}
					</Rail>
				</section>
			)}

			{related.length > 0 && (
				<section class="section">
					<SectionHeader title="Có thể bạn cũng thích" href={collectionPath(product.collection)} />
					<ProductGrid s={s} products={related} />
				</section>
			)}

			<div class="buybar window" data-buybar>
				<div>
					<span class="price" data-price>
						{formatVnd(sku.price)}
					</span>
				</div>
				<button type="button" class="btn btn--primary" data-add-current disabled={soldOut}>
					<Icon name="cart" size={18} />
					<span class="sr-only">Thêm vào giỏ</span>
				</button>
				<button type="button" class="btn btn--accent" data-buy-now disabled={soldOut}>
					Mua ngay
				</button>
			</div>
		</div>
	);
}
