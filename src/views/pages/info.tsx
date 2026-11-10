import { activeProducts, videos } from "../../lib/catalog";
import { enabledPaymentMethods, paymentLabelsByLang, site, type Settings } from "../../lib/config";
import { type Lang, policyAnchors, routes } from "../../lib/i18n";
import { formatVnd } from "../../lib/money";
import type { Product } from "../../lib/types";
import type { ViewCtx } from "../layout";
import { text } from "../text";
import { Breadcrumbs, EmptyState, VideoCard } from "../ui";

/** How shipping is charged, as one sentence without the free-shipping part. */
const shippingRule = (s: Settings, lang: Lang) => text[lang].shippingRule(formatVnd(s.shipping.localFee, lang), formatVnd(s.shipping.fee, lang));

export function faq(s: Settings, lang: Lang = "vi"): { q: string; a: string }[] {
	const labels = paymentLabelsByLang[lang];
	const methods = enabledPaymentMethods(s)
		.map((m) => labels[m].title)
		.join(", ");
	const free = formatVnd(s.shipping.freeThreshold, lang);
	const bankHours = Math.round(s.ttl.bank / 60);
	const codHours = Math.round(s.ttl.cod / 60);
	if (lang === "en") {
		return [
			{
				q: "Do you ship outside Vietnam?",
				a: "Not at the moment: we deliver to addresses in Vietnam only, priced in Vietnamese đồng (VND). Checkout needs a Vietnamese mobile number, and a VietQR transfer needs a Vietnamese banking app.",
			},
			{ q: "How long does delivery take?", a: `Orders are delivered within about ${s.shipping.eta} working days anywhere in Vietnam, depending on the area.` },
			{ q: "How much is shipping?", a: `${shippingRule(s, lang)}. Orders from ${free} ship free.` },
			{ q: "How can I pay?", a: `${methods}. You don't need an account to order.` },
			{
				q: "How does a VietQR transfer work?",
				a: "After you order, the order page shows a QR code with the exact amount and your order code as the transfer note. Scan it with any Vietnamese banking app and the money goes straight into the shop's BIDV account.",
			},
			{
				q: "Why was my order cancelled automatically?",
				a: `So that stock isn't held forever for unfinished orders, a VietQR order with no transfer is cancelled after ${bankHours} hours, and a COD order the shop hasn't confirmed after ${codHours} hours. You can order again at any time.`,
			},
			{
				q: "What if my item arrives faulty or broken?",
				a:
					s.returnDays > 0
						? `You can return it within ${s.returnDays} days of delivery. Items damaged in transit are replaced free of charge.`
						: "Film yourself opening the parcel and contact the shop: items that are faulty or broken in transit are replaced free of charge.",
			},
			{ q: "Do the products look like the TikTok videos?", a: "Yes. The photos and videos on this website are the shop's own, from TikTok @leduyenminh." },
			{ q: "Can I buy on TikTok Shop instead?", a: "Yes, every product has a “View on TikTok Shop” button. TikTok vouchers and PayLater only work when you buy on TikTok." },
		];
	}
	return [
		{ q: "Shop giao hàng trong bao lâu?", a: `Đơn được giao trong khoảng ${s.shipping.eta} ngày làm việc trên toàn quốc, tuỳ khu vực.` },
		{
			q: "Phí vận chuyển là bao nhiêu?",
			a: `${shippingRule(s, lang)}. Đơn từ ${free} được miễn phí vận chuyển.`,
		},
		{ q: "Có những cách thanh toán nào?", a: `${methods}. Bạn không cần tạo tài khoản để đặt hàng.` },
		{
			q: "Chuyển khoản VietQR hoạt động thế nào?",
			a: "Sau khi đặt hàng, trang đơn hàng hiện mã QR với đúng số tiền và nội dung là mã đơn. Quét bằng app ngân hàng bất kỳ, tiền chuyển thẳng vào tài khoản BIDV của shop.",
		},
		{
			q: "Vì sao đơn của tôi tự huỷ?",
			a: `Để không giữ hàng mãi cho đơn chưa hoàn tất, đơn VietQR chưa nhận được tiền tự huỷ sau ${bankHours} giờ, đơn COD chưa được shop xác nhận sau ${codHours} giờ. Bạn có thể đặt lại bất cứ lúc nào.`,
		},
		{
			q: "Hàng bị lỗi hoặc vỡ khi nhận thì sao?",
			a:
				s.returnDays > 0
					? `Bạn có thể đổi trả trong ${s.returnDays} ngày kể từ khi nhận hàng. Hàng lỗi do vận chuyển được đổi mới miễn phí.`
					: "Quay video khi mở hộp và liên hệ shop: hàng lỗi hoặc vỡ do vận chuyển được đổi mới miễn phí.",
		},
		{ q: "Sản phẩm có giống trong video TikTok không?", a: "Có. Ảnh và video trên website là ảnh, video thật của shop trên TikTok @leduyenminh." },
		{ q: "Tôi có thể mua trên TikTok Shop không?", a: "Có, mỗi sản phẩm có nút “Xem trên TikTok Shop”. Voucher và PayLater của TikTok chỉ dùng được khi mua trên TikTok." },
	];
}

export function HelpPage({ ctx }: { ctx: ViewCtx }) {
	const { lang } = ctx;
	const t = text[lang];
	return (
		<div class="container page narrow">
			<Breadcrumbs items={[{ name: t.home, href: routes[lang].home }, { name: t.help }]} />
			<h1>{t.faqTitle}</h1>
			<div class="faq">
				{faq(ctx.s, lang).map((f, i) => (
					<details class="window card-pad" open={i === 0}>
						<summary>{f.q}</summary>
						<p>{f.a}</p>
					</details>
				))}
			</div>
			<p>
				{t.helpMoreBefore}
				<a href={routes[lang].policy}>{t.helpMorePolicies}</a>
				{t.helpMoreMiddle}
				<a href={site.tiktok.profileUrl} target="_blank" rel="noopener">
					TikTok
				</a>
				{t.helpMoreAfter}
			</p>
		</div>
	);
}

export function PolicyPage({ ctx }: { ctx: ViewCtx }) {
	const { s, lang } = ctx;
	const t = text[lang];
	const anchors = policyAnchors[lang];
	const labels = paymentLabelsByLang[lang];
	return (
		<div class="container page narrow prose">
			<Breadcrumbs items={[{ name: t.home, href: routes[lang].home }, { name: t.policies }]} />
			<h1>{t.policiesTitle}</h1>
			<section id={anchors.shipping} class="window card-pad">
				<h2>{t.policyShippingTitle}</h2>
				<p>{t.policyShipping(s.shipping.eta, shippingRule(s, lang), formatVnd(s.shipping.freeThreshold, lang))}</p>
			</section>
			<section id={anchors.returns} class="window card-pad">
				<h2>{t.returns}</h2>
				<p>
					{t.policyReturns(s.returnDays)}
					{t.policyReturnsVideo}
				</p>
			</section>
			<section id={anchors.payment} class="window card-pad">
				<h2>{t.payment}</h2>
				<ul>
					{enabledPaymentMethods(s).map((m) => (
						<li>
							<strong>{labels[m].title}</strong>: {labels[m].hint}
						</li>
					))}
				</ul>
				<p>{t.policyPayment}</p>
			</section>
			<section id={anchors.privacy} class="window card-pad">
				<h2>{t.privacy}</h2>
				<p>{t.policyPrivacy}</p>
			</section>
		</div>
	);
}

export function AboutPage({ ctx, products }: { ctx: ViewCtx; products: Product[] }) {
	const t = text[ctx.lang];
	return (
		<div class="container page narrow prose">
			<Breadcrumbs items={[{ name: t.home, href: routes[ctx.lang].home }, { name: t.about }]} />
			<h1>{t.aboutTitle(site.name)}</h1>
			<p>
				{t.aboutBefore(site.name)}
				<a href={site.tiktok.profileUrl}>@{site.tiktok.handle}</a>
				{t.aboutAfter(activeProducts(products).length, videos.length)}
			</p>
			<p>{t.aboutLines}</p>
		</div>
	);
}

/** `products` are already in the page's language (localizeProduct). */
export function VideosPage({ ctx, products }: { ctx: ViewCtx; products: Product[] }) {
	const { lang } = ctx;
	const t = text[lang];
	const byVideo = new Map(activeProducts(products).flatMap((p) => p.videoIds.map((id) => [id, p] as const)));
	const list = [...videos].sort((a, b) => Number(b.pinned ?? 0) - Number(a.pinned ?? 0) || b.uploadedAt.localeCompare(a.uploadedAt));
	return (
		<div class="container page">
			<Breadcrumbs items={[{ name: t.home, href: routes[lang].home }, { name: t.tiktokVideos }]} />
			<header class="page-head">
				<h1>{t.tiktokVideos}</h1>
				<p class="muted">{t.videosIntro(list.length, site.tiktok.handle)}</p>
			</header>
			<div class="video-grid">
				{list.map((v) => (
					<VideoCard video={v} lang={lang} product={byVideo.get(v.id)} />
				))}
			</div>
		</div>
	);
}

export function NotFoundPage({ ctx }: { ctx: ViewCtx }) {
	const t = text[ctx.lang];
	return (
		<div class="container page narrow">
			<EmptyState title={t.notFound} text={t.notFoundText} action={{ href: routes[ctx.lang].products, label: t.seeProducts }} />
		</div>
	);
}

export function ErrorPage({ ctx }: { ctx: ViewCtx }) {
	const t = text[ctx.lang];
	return (
		<div class="container page narrow">
			<EmptyState title={t.error} text={t.errorText} action={{ href: routes[ctx.lang].home, label: t.backHome }} />
		</div>
	);
}
