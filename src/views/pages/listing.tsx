import { categoryName, collectionName, sortLabels, type Filters, type SortKey } from "../../lib/catalog";
import { categories, collections } from "../../lib/config";
import { categoryPath, collectionPath } from "../../lib/seo";
import type { Product } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { Breadcrumbs, EmptyState, ProductGrid } from "../ui";

export const PAGE_SIZE = 24;

const priceBands = [
	{ label: "Dưới 50K", min: undefined, max: 50000 },
	{ label: "50K – 100K", min: 50000, max: 100000 },
	{ label: "Trên 100K", min: 100000, max: undefined },
];

export interface ListingProps {
	ctx: ViewCtx;
	title: string;
	intro?: string;
	products: Product[];
	total: number;
	page: number;
	filters: Filters;
	/** Base path the filter links point at (keeps collection/category pages on their own URL). */
	basePath: string;
	crumbs: { name: string; href?: string }[];
}

function href(basePath: string, f: Filters, patch: Partial<Filters> & { page?: number }) {
	const next = { ...f, ...patch };
	const q = new URLSearchParams();
	if (next.q) q.set("q", next.q);
	if (next.collection && !basePath.startsWith("/bo-suu-tap")) q.set("bst", next.collection);
	if (next.category && !basePath.startsWith("/danh-muc")) q.set("loai", next.category);
	if (next.inStock) q.set("con-hang", "1");
	if (next.minPrice !== undefined) q.set("gia-tu", String(next.minPrice));
	if (next.maxPrice !== undefined) q.set("gia-den", String(next.maxPrice));
	if (next.sort && next.sort !== "featured") q.set("sort", next.sort);
	if (patch.page && patch.page > 1) q.set("trang", String(patch.page));
	const qs = q.toString();
	return qs ? `${basePath}?${qs}` : basePath;
}

export function ListingPage(props: ListingProps) {
	const { ctx, filters: f, basePath } = props;
	const pages = Math.max(1, Math.ceil(props.total / PAGE_SIZE));
	const onCollectionPage = basePath.startsWith("/bo-suu-tap");
	const onCategoryPage = basePath.startsWith("/danh-muc");
	return (
		<div class="container page">
			<Breadcrumbs items={props.crumbs} />
			<header class="page-head">
				<h1>{props.title}</h1>
				{props.intro && <p class="muted">{props.intro}</p>}
			</header>
			<div class="listing">
				<aside class="filters window" aria-label="Bộ lọc">
					<details open>
						<summary>
							<Icon name="filter" size={16} /> Bộ lọc
						</summary>
						{!onCollectionPage && (
							<fieldset>
								<legend>Bộ sưu tập</legend>
								<a class="chip" aria-pressed={!f.collection ? "true" : "false"} href={href(basePath, f, { collection: undefined })}>
									Tất cả
								</a>
								{Object.entries(collections).map(([slug, c]) => (
									<a class="chip" aria-pressed={f.collection === slug ? "true" : "false"} href={href(basePath, f, { collection: slug })}>
										{c.name}
									</a>
								))}
							</fieldset>
						)}
						{onCollectionPage && (
							<p class="small">
								<a href={collectionPath(f.collection ?? "")}>{collectionName(f.collection ?? "")}</a> ·{" "}
								<a href="/san-pham">Xem tất cả bộ sưu tập</a>
							</p>
						)}
						{!onCategoryPage && (
							<fieldset>
								<legend>Loại sản phẩm</legend>
								<a class="chip" aria-pressed={!f.category ? "true" : "false"} href={href(basePath, f, { category: undefined })}>
									Tất cả
								</a>
								{Object.entries(categories).map(([slug, c]) => (
									<a class="chip" aria-pressed={f.category === slug ? "true" : "false"} href={href(basePath, f, { category: slug })}>
										{c.name}
									</a>
								))}
							</fieldset>
						)}
						{onCategoryPage && (
							<p class="small">
								<a href={categoryPath(f.category ?? "")}>{categoryName(f.category ?? "")}</a> · <a href="/san-pham">Mọi loại sản phẩm</a>
							</p>
						)}
						<fieldset>
							<legend>Khoảng giá</legend>
							<a class="chip" aria-pressed={f.minPrice === undefined && f.maxPrice === undefined ? "true" : "false"} href={href(basePath, f, { minPrice: undefined, maxPrice: undefined })}>
								Mọi mức giá
							</a>
							{priceBands.map((b) => (
								<a
									class="chip"
									aria-pressed={f.minPrice === b.min && f.maxPrice === b.max ? "true" : "false"}
									href={href(basePath, f, { minPrice: b.min, maxPrice: b.max })}
								>
									{b.label}
								</a>
							))}
						</fieldset>
						<fieldset>
							<legend>Tình trạng</legend>
							<a class="chip" aria-pressed={f.inStock ? "true" : "false"} href={href(basePath, f, { inStock: !f.inStock })}>
								Chỉ hàng còn sẵn
							</a>
						</fieldset>
					</details>
				</aside>
				<section class="listing__results" aria-label="Sản phẩm">
					<div class="toolbar">
						<p class="muted">{props.total} sản phẩm</p>
						{!f.q && (
							<nav class="sort" aria-label="Sắp xếp">
								{(Object.keys(sortLabels) as SortKey[]).map((key) => (
									<a class="chip" aria-pressed={f.sort === key ? "true" : "false"} href={href(basePath, f, { sort: key })} rel="nofollow">
										{sortLabels[key]}
									</a>
								))}
							</nav>
						)}
					</div>
					{props.products.length ? (
						<ProductGrid s={ctx.s} products={props.products} eagerFirst={4} />
					) : (
						<EmptyState title="Không tìm thấy sản phẩm" text="Thử từ khoá khác hoặc bỏ bớt bộ lọc." action={{ href: "/san-pham", label: "Xem tất cả sản phẩm" }} />
					)}
					{pages > 1 && (
						<nav class="pager" aria-label="Phân trang">
							{Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
								<a class="chip" aria-current={n === props.page ? "page" : undefined} href={href(basePath, f, { page: n })}>
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
