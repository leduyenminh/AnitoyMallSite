import file from "../../data/translations.en.json";
import type { Lang } from "./i18n";
import type { Product } from "./types";

// English text for product pages under /en (data/translations.en.json): faithful translations of the
// TikTok listings, which the seller reviews before they go live (CLAUDE.md invariant 12). Display only: prices, stock, ids and the Vietnamese records in D1 are never touched. A product's
// English title and description are shown only while its Vietnamese title and description are the
// ones they were translated from (`source`); after an import changes them, the page falls back to
// Vietnamese until the translation is reviewed again. SKU names and specifications are translated
// by their exact Vietnamese wording, so a changed wording also falls back to Vietnamese.

export interface ProductTranslation {
	/** English URL slug (lower-case ASCII words joined by "-"). */
	slug: string;
	/** sourceHash() of the Vietnamese title and description this text was translated from. */
	source: string;
	title: string;
	description: string;
	/** For the reviewer; never shown. */
	note?: string;
}

interface TranslationFile {
	products: Record<string, ProductTranslation>;
	skuNames: Record<string, string>;
	attributeNames: Record<string, string>;
	attributeValues: Record<string, string>;
}

const en = file as unknown as TranslationFile;

/** FNV-1a (32-bit) of a product's Vietnamese title and description, as 8 hex digits. */
export function sourceHash(p: Pick<Product, "title" | "description">): string {
	const text = `${p.title}\n\n${p.description}`;
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

export const translationFile = en;

/** The product's English slug (its Vietnamese slug when it has no translation). */
export const englishSlug = (p: Pick<Product, "id" | "slug">): string => en.products[p.id]?.slug ?? p.slug;

/** The English title and description, when they still match the Vietnamese ones. */
export function englishText(p: Pick<Product, "id" | "title" | "description">): ProductTranslation | undefined {
	const t = en.products[p.id];
	return t && t.source === sourceHash(p) ? t : undefined;
}

export const englishSkuName = (name: string): string => en.skuNames[name] ?? name;

/** The product as shown in `lang`. Everything but its text (ids, slug, prices, stock) is unchanged. */
export function localizeProduct(p: Product, lang: Lang): Product {
	if (lang === "vi") return p;
	const t = englishText(p);
	return {
		...p,
		title: t?.title ?? p.title,
		description: t?.description ?? p.description,
		skus: p.skus.map((s) => ({ ...s, name: englishSkuName(s.name) })),
		attributes: p.attributes.map((a) => ({ name: en.attributeNames[a.name] ?? a.name, value: en.attributeValues[a.value] ?? a.value })),
	};
}

/** Searchable English words for a product (empty when it has no current translation). */
export function englishSearchText(p: Product): string {
	const t = englishText(p);
	return [t?.title ?? "", ...p.skus.map((s) => en.skuNames[s.name] ?? "")].join(" ");
}

/**
 * Order or cart lines shown in `lang`: product title, SKU name and English slug. Amounts are
 * unchanged. A line keeps its recorded title unless that is still the product's current title.
 */
export function localizeLines<L extends { title: string; skuName: string; slug: string }>(lines: L[], products: Product[], lang: Lang): L[] {
	if (lang === "vi") return lines;
	return lines.map((line) => {
		const p = products.find((x) => x.slug === line.slug);
		const t = p && p.title === line.title ? englishText(p) : undefined;
		return { ...line, title: t?.title ?? line.title, skuName: englishSkuName(line.skuName), slug: p ? englishSlug(p) : line.slug };
	});
}
