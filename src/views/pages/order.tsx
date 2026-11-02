import { raw } from "hono/html";
import { paymentLabels } from "../../lib/config";
import { formatVnd } from "../../lib/money";
import { isOnlineMethod } from "../../lib/orders";
import { qrSvg, vietQrPayload } from "../../lib/payments/vietqr";
import type { Order, OrderEvent } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";

export const statusLabels: Record<OrderEvent["status"], string> = {
	pending: "Chờ xác nhận",
	confirmed: "Đã xác nhận",
	shipped: "Đang giao",
	delivered: "Đã giao",
	cancelled: "Đã huỷ",
	paid: "Đã thanh toán",
	expired: "Hết hạn",
};

const STEPS = ["pending", "confirmed", "shipped", "delivered"] as const;

const dateTime = (iso: string) =>
	new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));

export function OrderPage({ ctx, order, notice }: { ctx: ViewCtx; order: Order; notice?: "new" | "paid" | "failed" }) {
	const { s } = ctx;
	const cancelled = order.status === "cancelled";
	const awaitingPayment = !cancelled && order.paymentStatus === "unpaid" && order.paymentMethod !== "cod";
	const step = STEPS.indexOf(order.status as (typeof STEPS)[number]);
	return (
		<div class="container page order" data-order-id={order.id} data-order-version={order.version} data-poll={awaitingPayment || order.status === "pending" ? "1" : undefined}>
			{notice === "new" && (
				<div class="banner banner--success window">
					<Icon name="check" size={22} />
					<div>
						<strong>Đặt hàng thành công!</strong>
						<p>Lưu lại đường dẫn trang này hoặc mã đơn {order.id} để theo dõi đơn hàng.</p>
					</div>
				</div>
			)}
			{notice === "paid" && order.paymentStatus === "paid" && (
				<div class="banner banner--success window">
					<Icon name="check" size={22} /> <strong>Thanh toán thành công.</strong>
				</div>
			)}
			{notice === "failed" && order.paymentStatus !== "paid" && (
				<div class="banner banner--warn window">
					<Icon name="close" size={22} /> <strong>Thanh toán chưa hoàn tất.</strong> Bạn có thể thử lại bên dưới.
				</div>
			)}

			<header class="page-head">
				<h1>
					Đơn hàng <span class="mono">{order.id}</span>
				</h1>
				<p class="muted">
					Đặt lúc {dateTime(order.createdAt)} · {paymentLabels[order.paymentMethod].title}
				</p>
			</header>

			<div class="checkout">
				<div class="checkout__main">
					<section class="window card-pad">
						<h2>Trạng thái</h2>
						{cancelled ? (
							<p class="status status--cancelled">{order.history.some((h) => h.status === "expired") ? "Đơn đã tự huỷ vì quá hạn thanh toán / xác nhận." : "Đơn đã huỷ."}</p>
						) : (
							<ol class="steps">
								{STEPS.map((st, i) => (
									<li class={i <= step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}>
										<span>{statusLabels[st]}</span>
									</li>
								))}
							</ol>
						)}
						<p>
							Thanh toán:{" "}
							<strong class={order.paymentStatus === "paid" ? "ok" : ""}>{order.paymentStatus === "paid" ? "Đã thanh toán" : order.paymentMethod === "cod" ? "Trả khi nhận hàng" : "Chưa thanh toán"}</strong>
						</p>
						{order.expiresAt && !cancelled && order.paymentStatus === "unpaid" && order.status === "pending" && (
							<p class="small muted">
								<Icon name="clock" size={14} /> {order.paymentMethod === "cod" ? "Shop sẽ gọi xác nhận đơn" : "Vui lòng thanh toán"} trước{" "}
								<time datetime={order.expiresAt} data-countdown>
									{dateTime(order.expiresAt)}
								</time>
								, sau đó đơn tự huỷ.
							</p>
						)}
					</section>

					{awaitingPayment && order.paymentMethod === "vietqr" && s.bank && (
						<section class="window card-pad vietqr">
							<h2>
								<Icon name="qr" size={18} /> Chuyển khoản VietQR
							</h2>
							<div class="vietqr__body">
								<div class="vietqr__code">
									{raw(qrSvg(vietQrPayload({ bin: s.bank.bin, accountNo: s.bank.accountNo, amount: order.total, memo: order.id }), `Mã VietQR thanh toán ${formatVnd(order.total)}`))}
								</div>
								<dl class="kv">
									<dt>Ngân hàng</dt>
									<dd>{s.bank.name}</dd>
									<dt>Số tài khoản</dt>
									<dd>
										<span class="mono">{s.bank.accountNo}</span>
										<button type="button" class="copy" data-copy={s.bank.accountNo} aria-label="Sao chép số tài khoản">
											<Icon name="copy" size={14} />
										</button>
									</dd>
									<dt>Chủ tài khoản</dt>
									<dd>{s.bank.accountName}</dd>
									<dt>Số tiền</dt>
									<dd>
										<strong>{formatVnd(order.total)}</strong>
										<button type="button" class="copy" data-copy={String(order.total)} aria-label="Sao chép số tiền">
											<Icon name="copy" size={14} />
										</button>
									</dd>
									<dt>Nội dung</dt>
									<dd>
										<strong class="mono">{order.id}</strong>
										<button type="button" class="copy" data-copy={order.id} aria-label="Sao chép nội dung chuyển khoản">
											<Icon name="copy" size={14} />
										</button>
									</dd>
								</dl>
							</div>
							<p class="small muted">
								Quét mã bằng app ngân hàng hoặc ví bất kỳ. Giữ nguyên số tiền và nội dung <strong>{order.id}</strong>.{" "}
								{s.sepayKey ? "Đơn được xác nhận tự động khi tiền về." : "Shop sẽ xác nhận ngay khi nhận được tiền."}
							</p>
						</section>
					)}

					{awaitingPayment && isOnlineMethod(order.paymentMethod) && (
						<section class="window card-pad">
							<h2>Thanh toán</h2>
							<p class="muted">Đơn đang chờ thanh toán qua {paymentLabels[order.paymentMethod].title}.</p>
							<button type="button" class="btn btn--accent btn--lg" data-pay-now>
								Thanh toán {formatVnd(order.total)}
							</button>
						</section>
					)}

					<section class="window card-pad">
						<h2>Giao tới</h2>
						<p>
							<strong>{order.customer.name}</strong> · {order.customer.phone}
						</p>
						<p>
							{order.address.street}, {order.address.ward}, {order.address.province}
						</p>
						{order.note && <p class="muted">Ghi chú: {order.note}</p>}
					</section>

					<section class="window card-pad">
						<h2>Lịch sử</h2>
						<ol class="timeline">
							{[...order.history].reverse().map((h) => (
								<li>
									<time datetime={h.at}>{dateTime(h.at)}</time> – {statusLabels[h.status]}
									{h.note && h.status !== "paid" ? ` (${h.note})` : ""}
								</li>
							))}
						</ol>
					</section>
				</div>

				<aside class="summary window card-pad">
					<h2>Sản phẩm</h2>
					<ul class="lines">
						{order.lines.map((l) => (
							<li class="line">
								{l.image && <img src={l.image} width="56" height="56" alt="" loading="lazy" />}
								<div>
									<a href={`/san-pham/${l.slug}`}>{l.title}</a>
									<p class="small muted">
										{l.skuName} × {l.quantity}
									</p>
								</div>
								<strong>{formatVnd(l.lineTotal)}</strong>
							</li>
						))}
					</ul>
					<dl class="totals">
						<dt>Tạm tính</dt>
						<dd>{formatVnd(order.subtotal)}</dd>
						<dt>Phí vận chuyển</dt>
						<dd>{order.shippingFee ? formatVnd(order.shippingFee) : "Miễn phí"}</dd>
						<dt class="totals__grand">Tổng cộng</dt>
						<dd class="totals__grand">{formatVnd(order.total)}</dd>
					</dl>
					<a class="btn btn--ghost btn--block" href="/san-pham">
						Tiếp tục mua sắm
					</a>
				</aside>
			</div>
		</div>
	);
}

export function LookupPage({ ctx: _ctx }: { ctx: ViewCtx }) {
	return (
		<div class="container page narrow">
			<header class="page-head">
				<h1>Tra cứu đơn hàng</h1>
				<p class="muted">Nhập mã đơn (ví dụ MA3K7PQ2X) và số điện thoại đặt hàng.</p>
			</header>
			<form class="window card-pad form-grid" data-lookup-form>
				<label class="field">
					<span>Mã đơn hàng</span>
					<input name="code" required minlength={7} maxlength={20} autocapitalize="characters" placeholder="MA…" />
				</label>
				<label class="field">
					<span>Số điện thoại</span>
					<input name="phone" type="tel" inputmode="tel" required minlength={9} maxlength={20} />
				</label>
				<p class="form-error field--wide" data-form-error role="alert" hidden></p>
				<button type="submit" class="btn btn--primary field--wide">
					Tra cứu
				</button>
			</form>
			<div data-lookup-result aria-live="polite"></div>
		</div>
	);
}
