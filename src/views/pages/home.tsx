import { activeProducts, isSoldOut, productViews, sortProducts, videoById, videos } from "../../lib/catalog";
import { categories, collections, groupText, site } from "../../lib/config";
import { routes } from "../../lib/i18n";
import { formatCount } from "../../lib/money";
import { categoryPath, collectionPath, imageSrc, productPath } from "../../lib/seo";
import type { Product } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { text } from "../text";
import { Perks, ProductCard, ProductGrid, Rail, SectionHeader, VideoCard } from "../ui";

/** `products` are already in the page's language (localizeProduct). */
export function HomePage({ ctx, products }: { ctx: ViewCtx; products: Product[] }) {
	const { s, lang } = ctx;
	const t = text[lang];
	const r = routes[lang];
	const live = activeProducts(products);
	const featured = sortProducts(live, "featured", videoById);
	const bestsellers = sortProducts(live, "bestselling", videoById).filter((p) => !isSoldOut(p)).slice(0, 10);
	const heroes = featured.slice(0, 3);
	const totalViews = videos.reduce((n, v) => n + v.views, 0);
	const topVideos = [...videos].sort((a, b) => b.views - a.views).slice(0, 8);
	const productForVideo = new Map(live.flatMap((p) => p.videoIds.map((id) => [id, p] as const)));
	const groups = [
		...Object.entries(collections).map(([slug, c]) => ({ href: collectionPath(slug, lang), name: groupText(c, lang).name, items: live.filter((p) => p.collection === slug) })),
		...Object.entries(categories).map(([slug, c]) => ({ href: categoryPath(slug, lang), name: groupText(c, lang).name, items: live.filter((p) => p.category === slug) })),
	].filter((g) => g.items.length);

	return (
		<>
			<section class="hero">
				<div class="container hero__inner">
					<div class="hero__copy">
						<p class="eyebrow eyebrow--pill">
							<Icon name="tiktok" size={14} /> {t.heroEyebrow(site.tiktok.handle)}
						</p>
						<h1>
							{t.heroTitle}
							<em>{t.heroTitleEm}</em>
						</h1>
						<p class="hero__lead">{t.heroLead}</p>
						<div class="hero__cta">
							<a class="btn btn--accent btn--lg" href={r.products}>
								{t.shopNow}
							</a>
							<a class="btn btn--ghost btn--lg" href={r.videos}>
								<Icon name="play" size={18} /> {t.watchVideos}
							</a>
						</div>
						<p class="hero__proof">
							<strong>{formatCount(totalViews, lang)}</strong>
							{t.heroProof(videos.length)}
						</p>
					</div>
					<div class="hero__art" aria-hidden="true">
						{heroes.map((p, i) => (
							<a class={`hero__tile hero__tile--${i + 1} window`} href={productPath(p, lang)} tabindex={-1}>
								<img src={imageSrc(s, p.images[0] ?? "", 480)} width="400" height="400" alt="" loading={i === 0 ? "eager" : "lazy"} fetchpriority={i === 0 ? "high" : undefined} />
							</a>
						))}
					</div>
				</div>
			</section>

			<div class="container">
				<Perks s={s} lang={lang} />
			</div>

			<section class="section container" aria-label={t.categories}>
				<SectionHeader title={t.categories} />
				<ul class="cat-tiles">
					{groups.map((g) => (
						<li>
							<a class="cat-tile window" href={g.href}>
								<img src={imageSrc(s, g.items[0]!.images[0] ?? "", 160)} width="72" height="72" alt="" loading="lazy" />
								<span>{g.name}</span>
								<small class="muted">{t.productCount(g.items.length)}</small>
							</a>
						</li>
					))}
				</ul>
			</section>

			{bestsellers.length > 0 && (
				<section class="section section--band">
					<div class="container">
						<SectionHeader title={t.bestsellers} href={`${r.products}?sort=bestselling`} linkLabel={t.viewAll} />
						<Rail label={t.bestsellersRail}>
							{bestsellers.map((p, i) => (
								<ProductCard s={s} lang={lang} product={p} eager={i < 2} />
							))}
						</Rail>
					</div>
				</section>
			)}

			<section class="section container">
				<SectionHeader title={t.todaysPicks} href={r.products} linkLabel={t.viewAll} />
				<ProductGrid s={s} lang={lang} products={featured.sort((a, b) => productViews(b) - productViews(a)).slice(0, 12)} />
			</section>

			<section class="section section--band">
				<div class="container">
					<SectionHeader title={t.hotOnTikTok} href={r.videos} linkLabel={t.viewAll} />
					<Rail label={t.tiktokVideos}>
						{topVideos.map((v) => (
							<VideoCard video={v} lang={lang} product={productForVideo.get(v.id)} compact />
						))}
					</Rail>
				</div>
			</section>

			<section class="section container trust">
				<div class="trust__item window">
					<Icon name="shield" size={28} />
					<h3>{t.trust.directTitle}</h3>
					<p class="muted">{t.trust.directText}</p>
				</div>
				<div class="trust__item window">
					<Icon name="box" size={28} />
					<h3>{t.trust.packedTitle}</h3>
					<p class="muted">{t.trust.packedText}</p>
				</div>
				<div class="trust__item window">
					<Icon name="receipt" size={28} />
					<h3>{t.trust.trackTitle}</h3>
					<p class="muted">
						{t.trust.trackBefore}
						<a href={r.lookup}>{t.trust.trackLink}</a>
						{t.trust.trackAfter}
					</p>
				</div>
			</section>
		</>
	);
}
