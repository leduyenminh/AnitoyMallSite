import { enabledPaymentMethods, paymentLabelsByLang } from "../../lib/config";
import { routes } from "../../lib/i18n";
import { formatVnd } from "../../lib/money";
import { HCM_PROVINCE, provinces } from "../../lib/validation";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { provinceLabel, text } from "../text";
import { Breadcrumbs } from "../ui";

// Cart and checkout render their shells on the server; the lines come from the shopper's cart in
// localStorage, priced by POST /api/cart/quote (the server is the source of truth for prices).
// English pages post exactly the same order: field values (provinces included) are the
// Vietnamese ones the server validates; only the labels are translated.

export function CartPage({ ctx }: { ctx: ViewCtx }) {
	const t = text[ctx.lang];
	const r = routes[ctx.lang];
	return (
		<div class="container page">
			<Breadcrumbs items={[{ name: t.home, href: r.home }, { name: t.cart }]} />
			<h1>{t.cart}</h1>
			<div class="checkout" data-cart-page>
				<section class="window card-pad" aria-label={t.itemsInCart}>
					<div data-cart-lines>
						<p class="muted">{t.loadingCart}</p>
					</div>
				</section>
				<OrderSummary ctx={ctx} cta={{ href: r.checkout, label: t.proceedToCheckout }} />
			</div>
		</div>
	);
}

export function CheckoutPage({ ctx, hcmWards }: { ctx: ViewCtx; hcmWards: string[] | null }) {
	const { s, lang } = ctx;
	const t = text[lang];
	const methods = enabledPaymentMethods(s);
	return (
		<div class="container page">
			<Breadcrumbs items={[{ name: t.cart, href: routes[lang].cart }, { name: t.checkout }]} />
			<h1>{t.checkout}</h1>
			{t.deliveryNote && <p class="notice">{t.deliveryNote}</p>}
			<form class="checkout" data-checkout-form novalidate>
				<div class="checkout__main">
					<section class="window card-pad">
						<h2>
							<Icon name="user" size={18} /> {t.recipient}
						</h2>
						<div class="form-grid">
							<label class="field">
								<span>{t.fullName}</span>
								<input name="name" autocomplete="name" required minlength={2} maxlength={100} />
							</label>
							<label class="field">
								<span>{t.phone}</span>
								<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required pattern="(\+?84|0)[35789][0-9]{8}" placeholder="09xxxxxxxx" />
							</label>
							<label class="field field--wide">
								<span>{t.emailOptional}</span>
								<input name="email" type="email" autocomplete="email" maxlength={200} />
							</label>
						</div>
					</section>
					<section class="window card-pad">
						<h2>
							<Icon name="truck" size={18} /> {t.deliveryAddress}
						</h2>
						<div class="form-grid">
							<label class="field field--wide">
								<span>{t.province}</span>
								<select name="province" required autocomplete="address-level1">
									<option value="">{t.chooseProvince}</option>
									{provinces.map((p) => (
										<option value={p}>{provinceLabel(p, lang)}</option>
									))}
								</select>
							</label>
							<label class="field">
								<span>{t.ward}</span>
								<input name="ward" required minlength={2} maxlength={100} autocomplete="address-level2" />
								{hcmWards && (
									<>
										{/* GHN books HCM parcels by ward: offer GHN's ward names (app.js links the list for HCM). */}
										<datalist id="hcm-wards" data-ward-list={HCM_PROVINCE}>
											{hcmWards.map((w) => (
												<option value={w}></option>
											))}
										</datalist>
										<small class="muted" data-ward-hint hidden>
											{t.wardHint}
										</small>
									</>
								)}
							</label>
							<label class="field">
								<span>{t.street}</span>
								<input name="street" required minlength={3} maxlength={200} autocomplete="street-address" />
							</label>
							<label class="field field--wide">
								<span>{t.noteForShop}</span>
								<textarea name="note" rows={2} maxlength={500} placeholder={t.notePlaceholder}></textarea>
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
							<Icon name="cash" size={18} /> {t.paymentMethod}
						</h2>
						<div class="pay-methods" role="radiogroup" aria-label={t.paymentMethod}>
							{methods.map((m, i) => (
								<div class="pay-method">
									<label class="pay-method__option">
										<input type="radio" name="paymentMethod" value={m} checked={i === 0} />
										<span>{paymentLabelsByLang[lang][m].title}</span>
									</label>
									{/* The shop's account, shown while VietQR is selected (CSS); the QR with amount and memo comes after ordering. */}
									{m === "vietqr" && s.bank && (
										<div class="pay-account">
											<span class="pay-account__text">
												<strong class="pay-account__no mono">{s.bank.accountNo}</strong>
												<span class="pay-account__name">{s.bank.accountName}</span>
											</span>
											<span class="pay-account__bank">{s.bank.name}</span>
											<small class="pay-account__note muted">{t.bankNote}</small>
										</div>
									)}
								</div>
							))}
						</div>
						<p class="small muted">{t.expiryNote(s.bank ? Math.round(s.ttl.bank / 60) : null, Math.round(s.ttl.cod / 60))}</p>
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
	const { lang } = ctx;
	const t = text[lang];
	const shipping = ctx.s.shipping;
	return (
		<aside class="summary window card-pad" aria-label={t.orderSummary}>
			<h2>{t.yourOrder}</h2>
			{submit && (
				<div class="summary__lines" data-summary-lines>
					<p class="muted">{t.loading}</p>
				</div>
			)}
			<div class="ship-meter" data-ship-meter hidden>
				<p data-ship-text></p>
				<div class="ship-meter__bar">
					<span data-ship-bar></span>
				</div>
			</div>
			<dl class="totals">
				<dt>{t.subtotal}</dt>
				<dd data-sum-subtotal>–</dd>
				<dt>{t.shipping}</dt>
				<dd data-sum-shipping>–</dd>
				<dt class="totals__grand">{t.total}</dt>
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
						{t.placeOrder}
					</button>
					<p class="small muted">{t.privacyNote}</p>
				</>
			)}
			<p class="small muted">{t.shippingNote(formatVnd(shipping.localFee, lang), formatVnd(shipping.fee, lang), formatVnd(shipping.freeThreshold, lang))}</p>
		</aside>
	);
}
