import { activeProducts, videos } from "../../lib/catalog";
import { enabledPaymentMethods, paymentLabels, site, type Settings } from "../../lib/config";
import { formatVnd } from "../../lib/money";
import type { Product } from "../../lib/types";
import type { ViewCtx } from "../layout";
import { Breadcrumbs, EmptyState, VideoCard } from "../ui";

export function faq(s: Settings): { q: string; a: string }[] {
	const methods = enabledPaymentMethods(s)
		.map((m) => paymentLabels[m].title)
		.join(", ");
	return [
		{ q: "Shop giao hàng trong bao lâu?", a: `Đơn được giao trong khoảng ${s.shipping.eta} ngày làm việc trên toàn quốc, tuỳ khu vực.` },
		{
			q: "Phí vận chuyển là bao nhiêu?",
			a: `Phí ship đồng giá ${formatVnd(s.shipping.fee)}. Đơn từ ${formatVnd(s.shipping.freeThreshold)} được miễn phí vận chuyển.`,
		},
		{ q: "Có những cách thanh toán nào?", a: `${methods}. Bạn không cần tạo tài khoản để đặt hàng.` },
		{
			q: "Chuyển khoản VietQR hoạt động thế nào?",
			a: "Sau khi đặt hàng, trang đơn hàng hiện mã QR với đúng số tiền và nội dung là mã đơn. Quét bằng app ngân hàng bất kỳ, tiền chuyển thẳng vào tài khoản BIDV của shop.",
		},
		{
			q: "Vì sao đơn của tôi tự huỷ?",
			a: `Để không giữ hàng mãi cho đơn chưa hoàn tất, đơn VietQR chưa nhận được tiền tự huỷ sau ${Math.round(s.ttl.bank / 60)} giờ, đơn COD chưa được shop xác nhận sau ${Math.round(s.ttl.cod / 60)} giờ. Bạn có thể đặt lại bất cứ lúc nào.`,
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
	return (
		<div class="container page narrow">
			<Breadcrumbs items={[{ name: "Trang chủ", href: "/" }, { name: "Hỗ trợ" }]} />
			<h1>Câu hỏi thường gặp</h1>
			<div class="faq">
				{faq(ctx.s).map((f, i) => (
					<details class="window card-pad" open={i === 0}>
						<summary>{f.q}</summary>
						<p>{f.a}</p>
					</details>
				))}
			</div>
			<p>
				Cần thêm trợ giúp? Xem <a href="/chinh-sach">chính sách của shop</a> hoặc nhắn tin cho shop trên{" "}
				<a href={site.tiktok.profileUrl} target="_blank" rel="noopener">
					TikTok
				</a>
				.
			</p>
		</div>
	);
}

export function PolicyPage({ ctx }: { ctx: ViewCtx }) {
	const { s } = ctx;
	return (
		<div class="container page narrow prose">
			<Breadcrumbs items={[{ name: "Trang chủ", href: "/" }, { name: "Chính sách" }]} />
			<h1>Chính sách mua hàng</h1>
			<section id="giao-hang" class="window card-pad">
				<h2>Giao hàng</h2>
				<p>
					Giao toàn quốc trong {s.shipping.eta} ngày. Phí ship {formatVnd(s.shipping.fee)}, miễn phí cho đơn từ {formatVnd(s.shipping.freeThreshold)}. Địa chỉ dùng
					34 tỉnh, thành phố theo đơn vị hành chính mới từ 1/7/2025.
				</p>
			</section>
			<section id="doi-tra" class="window card-pad">
				<h2>Đổi trả</h2>
				<p>
					{s.returnDays > 0
						? `Shop nhận đổi trả trong ${s.returnDays} ngày kể từ khi bạn nhận hàng, sản phẩm còn nguyên vẹn.`
						: "Shop không nhận trả hàng đổi ý. Sản phẩm lỗi, vỡ do vận chuyển được đổi mới miễn phí."}{" "}
					Vui lòng quay video khi mở hộp để được hỗ trợ nhanh.
				</p>
			</section>
			<section id="thanh-toan" class="window card-pad">
				<h2>Thanh toán</h2>
				<ul>
					{enabledPaymentMethods(s).map((m) => (
						<li>
							<strong>{paymentLabels[m].title}</strong>: {paymentLabels[m].hint}
						</li>
					))}
				</ul>
				<p>Tiền chuyển khoản vào thẳng tài khoản BIDV của shop, không qua trung gian. Shop không bao giờ hỏi thông tin thẻ hay mật khẩu ngân hàng của bạn.</p>
			</section>
			<section id="bao-mat" class="window card-pad">
				<h2>Bảo mật thông tin</h2>
				<p>
					Họ tên, số điện thoại, email và địa chỉ chỉ dùng để giao hàng và liên hệ về đơn. Trang đơn hàng chỉ mở được bằng đường dẫn bí mật gửi cho bạn; tra cứu đơn
					chỉ hiện thông tin đã che bớt.
				</p>
			</section>
		</div>
	);
}

export function AboutPage({ ctx: _ctx, products }: { ctx: ViewCtx; products: Product[] }) {
	return (
		<div class="container page narrow prose">
			<Breadcrumbs items={[{ name: "Trang chủ", href: "/" }, { name: "Giới thiệu" }]} />
			<h1>Về {site.name}</h1>
			<p>
				{site.name} là shop mô hình anime chibi của TikTok <a href={site.tiktok.profileUrl}>@{site.tiktok.handle}</a>: {activeProducts(products).length} sản phẩm và{" "}
				{videos.length} video mở hộp, decor thật. Website là nơi bạn đặt hàng trực tiếp với shop, thanh toán khi nhận hàng (COD) hoặc chuyển khoản VietQR vào tài khoản BIDV của shop.
			</p>
			<p>Các dòng sản phẩm: Frieren, Neko Kawaii (Osakana, Kinako), Kimetsu no Yaiba, Chainsaw Man, Honkai: Star Rail, Genshin Impact.</p>
		</div>
	);
}

export function VideosPage({ ctx: _ctx, products }: { ctx: ViewCtx; products: Product[] }) {
	const byVideo = new Map(activeProducts(products).flatMap((p) => p.videoIds.map((id) => [id, p] as const)));
	const list = [...videos].sort((a, b) => Number(b.pinned ?? 0) - Number(a.pinned ?? 0) || b.uploadedAt.localeCompare(a.uploadedAt));
	return (
		<div class="container page">
			<Breadcrumbs items={[{ name: "Trang chủ", href: "/" }, { name: "Video TikTok" }]} />
			<header class="page-head">
				<h1>Video TikTok</h1>
				<p class="muted">{list.length} video mở hộp và decor từ @leduyenminh, phát bằng trình phát chính thức của TikTok.</p>
			</header>
			<div class="video-grid">
				{list.map((v) => (
					<VideoCard video={v} product={byVideo.get(v.id)} />
				))}
			</div>
		</div>
	);
}

export function NotFoundPage({ ctx: _ctx }: { ctx: ViewCtx }) {
	return (
		<div class="container page narrow">
			<EmptyState title="Không tìm thấy trang" text="Trang bạn tìm không tồn tại hoặc đã được chuyển." action={{ href: "/san-pham", label: "Xem sản phẩm" }} />
		</div>
	);
}

export function ErrorPage({ ctx: _ctx }: { ctx: ViewCtx }) {
	return (
		<div class="container page narrow">
			<EmptyState title="Có lỗi xảy ra" text="Vui lòng thử lại sau ít phút." action={{ href: "/", label: "Về trang chủ" }} />
		</div>
	);
}
