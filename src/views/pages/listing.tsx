import { categoryName, collectionName, sortLabels, type Filters, type SortKey } from "../../lib/catalog";
import { categories, collections, groupText } from "../../lib/config";
import { type Lang, listingParams, routes } from "../../lib/i18n";
import { categoryPath, collectionPath } from "../../lib/seo";
import type { Product } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { text } from "../text";
import { Breadcrumbs, EmptyState, ProductGrid } from "../ui";

export const PAGE_SIZE = 24;

const priceBands = [
	{ min: undefined, max: 50000 },
	{ min: 50000, max: 100000 },
	{ min: 100000, max: undefined },
];

export interface ListingProps {
	ctx: ViewCtx;
	title: string;
	intro?: string;
	/** Already in the page's language (localizeProduct). */
	products: Product[];
	total: number;
	page: number;
	filters: Filters;
	/** Base path the filter links point at (keeps collection/category pages on their own URL). */
	basePath: string;
	/** What the base path lists: its own collection or category filter is not offered again. */
	scope: "all" | "collection" | "category" | "search";
	crumbs: { name: string; href?: string }[];
}

/** Filter link in the page's language: Vietnamese and English pages use their own parameter names. */
export function listingHref(lang: Lang, basePath: string, scope: ListingProps["scope"], f: Filters, patch: Partial<Filters> & { page?: number }) {
	const p = listingParams[lang];
	const next = { ...f, ...patch };
	const q = new URLSearchParams();
	if (next.q) q.set("q", next.q);
	if (next.collection && scope !== "collection") q.set(p.collection, next.collection);
	if (next.category && scope !== "category") q.set(p.category, next.category);
	if (next.inStock) q.set(p.inStock, "1");
	if (next.minPrice !== undefined) q.set(p.minPrice, String(next.minPrice));
	if (next.maxPrice !== undefined) q.set(p.maxPrice, String(next.maxPrice));
	if (next.sort && next.sort !== "featured") q.set("sort", next.sort);
	if (patch.page && patch.page > 1) q.set(p.page, String(patch.page));
	const qs = q.toString();
	return qs ? `${basePath}?${qs}` : basePath;
}

export function ListingPage(props: ListingProps) {
	const { ctx, filters: f, basePath, scope } = props;
	const { lang } = ctx;
	const t = text[lang];
	const href = (patch: Partial<Filters> & { page?: number }) => listingHref(lang, basePath, scope, f, patch);
	const pages = Math.max(1, Math.ceil(props.total / PAGE_SIZE));
	const onCollectionPage = scope === "collection";
	const onCategoryPage = scope === "category";
	return (
		<div class="container page">
			<Breadcrumbs items={props.crumbs} />
			<header class="page-head">
				<h1>{props.title}</h1>
				{props.intro && <p class="muted">{props.intro}</p>}
			</header>
			<div class="listing">
				<aside class="filters window" aria-label={t.filters}>
					<details open>
						<summary>
							<Icon name="filter" size={16} /> {t.filters}
						</summary>
						{!onCollectionPage && (
							<fieldset>
								<legend>{t.collection}</legend>
								<a class="chip" aria-pressed={!f.collection ? "true" : "false"} href={href({ collection: undefined })}>
									{t.all}
								</a>
								{Object.entries(collections).map(([slug, c]) => (
									<a class="chip" aria-pressed={f.collection === slug ? "true" : "false"} href={href({ collection: slug })}>
										{groupText(c, lang).name}
									</a>
								))}
							</fieldset>
						)}
						{onCollectionPage && (
							<p class="small">
								<a href={collectionPath(f.collection ?? "", lang)}>{collectionName(f.collection ?? "", lang)}</a> ·{" "}
								<a href={routes[lang].products}>{t.allCollections}</a>
							</p>
						)}
						{!onCategoryPage && (
							<fieldset>
								<legend>{t.productType}</legend>
								<a class="chip" aria-pressed={!f.category ? "true" : "false"} href={href({ category: undefined })}>
									{t.all}
								</a>
								{Object.entries(categories).map(([slug, c]) => (
									<a class="chip" aria-pressed={f.category === slug ? "true" : "false"} href={href({ category: slug })}>
										{groupText(c, lang).name}
									</a>
								))}
							</fieldset>
						)}
						{onCategoryPage && (
							<p class="small">
								<a href={categoryPath(f.category ?? "", lang)}>{categoryName(f.category ?? "", lang)}</a> ·{" "}
								<a href={routes[lang].products}>{t.allProductTypes}</a>
							</p>
						)}
						<fieldset>
							<legend>{t.priceRange}</legend>
							<a class="chip" aria-pressed={f.minPrice === undefined && f.maxPrice === undefined ? "true" : "false"} href={href({ minPrice: undefined, maxPrice: undefined })}>
								{t.anyPrice}
							</a>
							{priceBands.map((b, i) => (
								<a class="chip" aria-pressed={f.minPrice === b.min && f.maxPrice === b.max ? "true" : "false"} href={href({ minPrice: b.min, maxPrice: b.max })}>
									{t.priceBands[i]}
								</a>
							))}
						</fieldset>
						<fieldset>
							<legend>{t.availability}</legend>
							<a class="chip" aria-pressed={f.inStock ? "true" : "false"} href={href({ inStock: !f.inStock })}>
								{t.inStockOnly}
							</a>
						</fieldset>
					</details>
				</aside>
				<section class="listing__results" aria-label={t.products}>
					<div class="toolbar">
						<p class="muted">{t.productCount(props.total)}</p>
						{!f.q && (
							<nav class="sort" aria-label={t.sort}>
								{(Object.keys(sortLabels[lang]) as SortKey[]).map((key) => (
									<a class="chip" aria-pressed={f.sort === key ? "true" : "false"} href={href({ sort: key })} rel="nofollow">
										{sortLabels[lang][key]}
									</a>
								))}
							</nav>
						)}
					</div>
					{props.products.length ? (
						<ProductGrid s={ctx.s} lang={lang} products={props.products} eagerFirst={4} />
					) : (
						<EmptyState title={t.noProducts} text={t.noProductsHint} action={{ href: routes[lang].products, label: t.seeAllProducts }} />
					)}
					{pages > 1 && (
						<nav class="pager" aria-label={t.pagination}>
							{Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
								<a class="chip" aria-current={n === props.page ? "page" : undefined} href={href({ page: n })}>
									{n}
								</a>
							))}
						</nav>
					)}
				</section>
			</div>
		</div>
	);
}
