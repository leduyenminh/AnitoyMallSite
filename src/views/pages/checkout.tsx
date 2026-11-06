import { enabledPaymentMethods, paymentLabels } from "../../lib/config";
import { formatVnd } from "../../lib/money";
import { HCM_PROVINCE, provinces } from "../../lib/validation";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { Breadcrumbs } from "../ui";

// Cart and checkout render their shells on the server; the lines come from the shopper's cart in
// localStorage, priced by POST /api/cart/quote (the server is the source of truth for prices).

export function CartPage({ ctx }: { ctx: ViewCtx }) {
	return (
		<div class="container page">
			<Breadcrumbs items={[{ name: "Trang chủ", href: "/" }, { name: "Giỏ hàng" }]} />
			<h1>Giỏ hàng</h1>
			<div class="checkout" data-cart-page>
				<section class="window card-pad" aria-label="Sản phẩm trong giỏ">
					<div data-cart-lines>
						<p class="muted">Đang tải giỏ hàng…</p>
					</div>
				</section>
				<OrderSummary ctx={ctx} cta={{ href: "/thanh-toan", label: "Tiến hành thanh toán" }} />
			</div>
		</div>
	);
}

export function CheckoutPage({ ctx, hcmWards }: { ctx: ViewCtx; hcmWards: string[] | null }) {
	const { s } = ctx;
	const methods = enabledPaymentMethods(s);
	return (
		<div class="container page">
			<Breadcrumbs items={[{ name: "Giỏ hàng", href: "/gio-hang" }, { name: "Thanh toán" }]} />
			<h1>Thanh toán</h1>
			<form class="checkout" data-checkout-form novalidate>
				<div class="checkout__main">
					<section class="window card-pad">
						<h2>
							<Icon name="user" size={18} /> Thông tin người nhận
						</h2>
						<div class="form-grid">
							<label class="field">
								<span>Họ và tên *</span>
								<input name="name" autocomplete="name" required minlength={2} maxlength={100} />
							</label>
							<label class="field">
								<span>Số điện thoại *</span>
								<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required pattern="(\+?84|0)[35789][0-9]{8}" placeholder="09xxxxxxxx" />
							</label>
							<label class="field field--wide">
								<span>Email (không bắt buộc)</span>
								<input name="email" type="email" autocomplete="email" maxlength={200} />
							</label>
						</div>
					</section>
					<section class="window card-pad">
						<h2>
							<Icon name="truck" size={18} /> Địa chỉ giao hàng
						</h2>
						<div class="form-grid">
							<label class="field field--wide">
								<span>Tỉnh / Thành phố *</span>
								<select name="province" required autocomplete="address-level1">
									<option value="">Chọn tỉnh / thành phố</option>
									{provinces.map((p) => (
										<option value={p}>{p}</option>
									))}
								</select>
							</label>
							<label class="field">
								<span>Phường / Xã *</span>
								<input name="ward" required minlength={2} maxlength={100} autocomplete="address-level2" />
								{hcmWards && (
									<>
										{/* GHN prices HCM deliveries by ward: offer GHN's ward names (app.js links the list for HCM). */}
										<datalist id="hcm-wards" data-ward-list={HCM_PROVINCE}>
											{hcmWards.map((w) => (
												<option value={w}></option>
											))}
										</datalist>
										<small class="muted" data-ward-hint hidden>
											Chọn phường / xã trong danh sách để tính phí giao hàng.
										</small>
									</>
								)}
							</label>
							<label class="field">
								<span>Số nhà, tên đường *</span>
								<input name="street" required minlength={3} maxlength={200} autocomplete="street-address" />
							</label>
							<label class="field field--wide">
								<span>Ghi chú cho shop</span>
								<textarea name="note" rows={2} maxlength={500} placeholder="Ví dụ: giao giờ hành chính"></textarea>
							</label>
							{/* Honeypot for bots; hidden from people and assistive tech. */}
							<label class="hp" aria-hidden="true">
								Website
								<input name="website" tabindex={-1} autocomplete="off" />
							</label>
						</div>
					</section>
					<section class="window card-pad">
						<h2>
							<Icon name="cash" size={18} /> Phương thức thanh toán
						</h2>
						<div class="pay-methods" role="radiogroup" aria-label="Phương thức thanh toán">
							{methods.map((m, i) => (
								<div class="pay-method">
									<label class="pay-method__option">
										<input type="radio" name="paymentMethod" value={m} checked={i === 0} />
										<span>{paymentLabels[m].title}</span>
									</label>
									{/* The shop's account, shown while VietQR is selected (CSS); the QR with amount and memo comes after ordering. */}
									{m === "vietqr" && s.bank && (
										<div class="pay-account">
											<span class="pay-account__text">
												<strong class="pay-account__no mono">{s.bank.accountNo}</strong>
												<span class="pay-account__name">{s.bank.accountName}</span>
											</span>
											<span class="pay-account__bank">{s.bank.name}</span>
											<small class="pay-account__note muted">Chuyển khoản sau khi đặt hàng, theo mã QR và nội dung trên trang đơn hàng.</small>
										</div>
									)}
								</div>
							))}
						</div>
						<p class="small muted">
							Đơn chưa được thanh toán hoặc xác nhận sẽ tự huỷ sau {s.bank ? `${Math.round(s.ttl.bank / 60)} giờ (VietQR) và ` : ""}
							{Math.round(s.ttl.cod / 60)} giờ (COD).
						</p>
					</section>
					{s.turnstile && <div class="cf-turnstile" data-sitekey={s.turnstile.siteKey} data-turnstile></div>}
				</div>
				<OrderSummary ctx={ctx} submit />
			</form>
			{s.turnstile && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>}
		</div>
	);
}

function OrderSummary({ ctx, cta, submit }: { ctx: ViewCtx; cta?: { href: string; label: string }; submit?: boolean }) {
	return (
		<aside class="summary window card-pad" aria-label="Tóm tắt đơn hàng">
			<h2>Đơn hàng</h2>
			{submit && (
				<div class="summary__lines" data-summary-lines>
					<p class="muted">Đang tải…</p>
				</div>
			)}
			<div class="ship-meter" data-ship-meter hidden>
				<p data-ship-text></p>
				<div class="ship-meter__bar">
					<span data-ship-bar></span>
				</div>
			</div>
			<dl class="totals">
				<dt>Tạm tính</dt>
				<dd data-sum-subtotal>–</dd>
				<dt>Phí vận chuyển</dt>
				<dd data-sum-shipping>–</dd>
				<dt class="totals__grand">Tổng cộng</dt>
				<dd class="totals__grand" data-sum-total>
					–
				</dd>
			</dl>
			<p class="notice" data-quote-notice hidden></p>
			{cta && (
				<a class="btn btn--accent btn--lg btn--block" href={cta.href} data-cart-checkout>
					{cta.label}
				</a>
			)}
			{submit && (
				<>
					<p class="form-error" data-form-error role="alert" hidden></p>
					<button type="submit" class="btn btn--accent btn--lg btn--block" data-submit>
						Đặt hàng
					</button>
					<p class="small muted">Thông tin của bạn chỉ dùng để giao hàng và liên hệ về đơn này.</p>
				</>
			)}
			<p class="small muted">
				{ctx.s.shipping.ghn
					? `Phí ship TP.HCM theo bảng giá GHN, tỉnh khác ${formatVnd(ctx.s.shipping.fee)}`
					: `Phí ship ${formatVnd(ctx.s.shipping.fee)}`}
				, miễn phí cho đơn từ {formatVnd(ctx.s.shipping.freeThreshold)}.
			</p>
		</aside>
	);
}
