import { activeProducts, isSoldOut, productViews, sortProducts, videoById, videos } from "../../lib/catalog";
import { categories, collections, site } from "../../lib/config";
import { formatCount } from "../../lib/money";
import { categoryPath, collectionPath, imageSrc, productPath } from "../../lib/seo";
import type { Product } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { Perks, ProductCard, ProductGrid, Rail, SectionHeader, VideoCard } from "../ui";

export function HomePage({ ctx, products }: { ctx: ViewCtx; products: Product[] }) {
	const { s } = ctx;
	const live = activeProducts(products);
	const featured = sortProducts(live, "featured", videoById);
	const bestsellers = sortProducts(live, "bestselling", videoById).filter((p) => !isSoldOut(p)).slice(0, 10);
	const heroes = featured.slice(0, 3);
	const totalViews = videos.reduce((n, v) => n + v.views, 0);
	const topVideos = [...videos].sort((a, b) => b.views - a.views).slice(0, 8);
	const productForVideo = new Map(live.flatMap((p) => p.videoIds.map((id) => [id, p] as const)));
	const groups = [
		...Object.entries(collections).map(([slug, c]) => ({ href: collectionPath(slug), name: c.name, items: live.filter((p) => p.collection === slug) })),
		...Object.entries(categories).map(([slug, c]) => ({ href: categoryPath(slug), name: c.name, items: live.filter((p) => p.category === slug) })),
	].filter((g) => g.items.length);

	return (
		<>
			<section class="hero">
				<div class="container hero__inner">
					<div class="hero__copy">
						<p class="eyebrow eyebrow--pill">
							<Icon name="tiktok" size={14} /> Shop mô hình anime từ TikTok @{site.tiktok.handle}
						</p>
						<h1>
							Góc bàn xinh hơn với <em>những người bạn tí hon</em>
						</h1>
						<p class="hero__lead">Frieren, Fern, Stark, hội Neko kawaii và nhiều hơn nữa – mô hình chibi, figure 20cm, móc khoá acrylic. Đặt trực tiếp tại shop, COD toàn quốc.</p>
						<div class="hero__cta">
							<a class="btn btn--accent btn--lg" href="/san-pham">
								Mua sắm ngay
							</a>
							<a class="btn btn--ghost btn--lg" href="/video">
								<Icon name="play" size={18} /> Xem video
							</a>
						</div>
						<p class="hero__proof">
							<strong>{formatCount(totalViews)}</strong> lượt xem trên {videos.length} video TikTok
						</p>
					</div>
					<div class="hero__art" aria-hidden="true">
						{heroes.map((p, i) => (
							<a class={`hero__tile hero__tile--${i + 1} window`} href={productPath(p)} tabindex={-1}>
								<img src={imageSrc(s, p.images[0] ?? "", 480)} width="400" height="400" alt="" loading={i === 0 ? "eager" : "lazy"} fetchpriority={i === 0 ? "high" : undefined} />
							</a>
						))}
					</div>
				</div>
			</section>

			<div class="container">
				<Perks s={s} />
			</div>

			<section class="section container" aria-label="Danh mục">
				<SectionHeader title="Danh mục" />
				<ul class="cat-tiles">
					{groups.map((g) => (
						<li>
							<a class="cat-tile window" href={g.href}>
								<img src={imageSrc(s, g.items[0]!.images[0] ?? "", 160)} width="72" height="72" alt="" loading="lazy" />
								<span>{g.name}</span>
								<small class="muted">{g.items.length} sản phẩm</small>
							</a>
						</li>
					))}
				</ul>
			</section>

			{bestsellers.length > 0 && (
				<section class="section section--band">
					<div class="container">
						<SectionHeader title="Bán chạy" href="/san-pham?sort=bestselling" />
						<Rail label="Sản phẩm bán chạy">
							{bestsellers.map((p, i) => (
								<ProductCard s={s} product={p} eager={i < 2} />
							))}
						</Rail>
					</div>
				</section>
			)}

			<section class="section container">
				<SectionHeader title="Gợi ý hôm nay" href="/san-pham" />
				<ProductGrid s={s} products={featured.sort((a, b) => productViews(b) - productViews(a)).slice(0, 12)} />
			</section>

			<section class="section section--band">
				<div class="container">
					<SectionHeader title="Đang hot trên TikTok" href="/video" />
					<Rail label="Video TikTok">
						{topVideos.map((v) => (
							<VideoCard video={v} product={productForVideo.get(v.id)} compact />
						))}
					</Rail>
				</div>
			</section>

			<section class="section container trust">
				<div class="trust__item window">
					<Icon name="shield" size={28} />
					<h3>Mua trực tiếp, an toàn</h3>
					<p class="muted">Đặt hàng không cần tài khoản. Thanh toán khi nhận hàng (COD) hoặc chuyển khoản VietQR.</p>
				</div>
				<div class="trust__item window">
					<Icon name="box" size={28} />
					<h3>Đóng gói cẩn thận</h3>
					<p class="muted">Mô hình được bọc chống sốc. Hàng lỗi do vận chuyển được đổi mới.</p>
				</div>
				<div class="trust__item window">
					<Icon name="receipt" size={28} />
					<h3>Theo dõi đơn dễ dàng</h3>
					<p class="muted">
						Tra cứu đơn bằng mã đơn và số điện thoại tại <a href="/tra-cuu-don-hang">đây</a>.
					</p>
				</div>
			</section>
		</>
	);
}
