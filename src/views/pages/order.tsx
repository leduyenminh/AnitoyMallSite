import { raw } from "hono/html";
import { paymentLabelsByLang } from "../../lib/config";
import { type Lang, locales, routes } from "../../lib/i18n";
import { formatVnd } from "../../lib/money";
import { qrSvg, vietQrPayload } from "../../lib/payments/vietqr";
import type { Order, OrderEvent, OrderLine } from "../../lib/types";
import { Icon } from "../icons";
import type { ViewCtx } from "../layout";
import { text } from "../text";

/** Vietnamese status names (the admin uses them too). */
export const statusLabels: Record<OrderEvent["status"], string> = text.vi.orderStatus;

const STEPS = ["pending", "confirmed", "shipped", "delivered"] as const;

const dateFormats: Record<Lang, Intl.DateTimeFormat> = {
	vi: new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }),
	en: new Intl.DateTimeFormat(locales.en.intl, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }),
};

/** Shop time (Vietnam); English readers abroad also get the offset. */
const dateTime = (iso: string, lang: Lang) => `${dateFormats[lang].format(new Date(iso))}${lang === "en" ? " (GMT+7)" : ""}`;

/**
 * The order is the shopper's own (opened with its access token). `lines` are the order's lines as
 * shown in the page's language (localizeLines); amounts come from `order`.
 */
export function OrderPage({ ctx, order, lines, notice }: { ctx: ViewCtx; order: Order; lines: OrderLine[]; notice?: "new" }) {
	const { s, lang } = ctx;
	const t = text[lang];
	const cancelled = order.status === "cancelled";
	const awaitingPayment = !cancelled && order.paymentStatus === "unpaid" && order.paymentMethod !== "cod";
	const step = STEPS.indexOf(order.status as (typeof STEPS)[number]);
	const historyNote = (note: string) => t.historyNotes[note] ?? note;
	return (
		<div class="container page order" data-order-id={order.id} data-order-version={order.version} data-poll={awaitingPayment || order.status === "pending" ? "1" : undefined}>
			{notice === "new" && (
				<div class="banner banner--success window">
					<Icon name="check" size={22} />
					<div>
						<strong>{t.orderPlaced}</strong>
						<p>{t.orderPlacedHint(order.id)}</p>
					</div>
				</div>
			)}

			<header class="page-head">
				<h1>
					{t.order} <span class="mono">{order.id}</span>
				</h1>
				<p class="muted">{t.placedAt(dateTime(order.createdAt, lang), paymentLabelsByLang[lang][order.paymentMethod].title)}</p>
			</header>

			<div class="checkout">
				<div class="checkout__main">
					<section class="window card-pad">
						<h2>{t.status}</h2>
						{cancelled ? (
							<p class="status status--cancelled">{order.history.some((h) => h.status === "expired") ? t.expiredCancelled : t.cancelled}</p>
						) : (
							<ol class="steps">
								{STEPS.map((st, i) => (
									<li class={i <= step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}>
										<span>{t.orderStatus[st]}</span>
									</li>
								))}
							</ol>
						)}
						<p>
							{t.paymentLabel}{" "}
							<strong class={order.paymentStatus === "paid" ? "ok" : ""}>{order.paymentStatus === "paid" ? t.paid : order.paymentMethod === "cod" ? t.payOnDelivery : t.unpaid}</strong>
						</p>
						{order.expiresAt && !cancelled && order.paymentStatus === "unpaid" && order.status === "pending" && (
							<p class="small muted">
								<Icon name="clock" size={14} /> {order.paymentMethod === "cod" ? t.codDeadline : t.payDeadline}
								{t.before}
								<time datetime={order.expiresAt} data-countdown>
									{dateTime(order.expiresAt, lang)}
								</time>
								{t.thenCancelled}
							</p>
						)}
					</section>

					{awaitingPayment && order.paymentMethod === "vietqr" && s.bank && (
						<section class="window card-pad vietqr">
							<h2>
								<Icon name="qr" size={18} /> {t.vietqrTitle}
							</h2>
							<div class="vietqr__body">
								<div class="vietqr__code">
									{raw(qrSvg(vietQrPayload({ bin: s.bank.bin, accountNo: s.bank.accountNo, amount: order.total, memo: order.id }), t.qrLabel(formatVnd(order.total, lang))))}
								</div>
								<dl class="kv">
									<dt>{t.bank}</dt>
									<dd>{s.bank.name}</dd>
									<dt>{t.accountNo}</dt>
									<dd>
										<span class="mono">{s.bank.accountNo}</span>
										<button type="button" class="copy" data-copy={s.bank.accountNo} aria-label={t.copyAccountNo}>
											<Icon name="copy" size={14} />
										</button>
									</dd>
									<dt>{t.accountName}</dt>
									<dd>{s.bank.accountName}</dd>
									<dt>{t.amount}</dt>
									<dd>
										<strong>{formatVnd(order.total, lang)}</strong>
										<button type="button" class="copy" data-copy={String(order.total)} aria-label={t.copyAmount}>
											<Icon name="copy" size={14} />
										</button>
									</dd>
									<dt>{t.memo}</dt>
									<dd>
										<strong class="mono">{order.id}</strong>
										<button type="button" class="copy" data-copy={order.id} aria-label={t.copyMemo}>
											<Icon name="copy" size={14} />
										</button>
									</dd>
								</dl>
							</div>
							<p class="small muted">
								{t.qrHowBefore}
								<strong>{order.id}</strong>
								{t.qrHowAfter} {s.sepayKey ? t.autoConfirm : t.manualConfirm}
							</p>
						</section>
					)}

					<section class="window card-pad">
						<h2>{t.deliverTo}</h2>
						<p>
							<strong>{order.customer.name}</strong> · {order.customer.phone}
						</p>
						<p>
							{order.address.street}, {order.address.ward}, {order.address.province}
						</p>
						{order.note && (
							<p class="muted">
								{t.noteLabel} {order.note}
							</p>
						)}
					</section>

					<section class="window card-pad">
						<h2>{t.history}</h2>
						<ol class="timeline">
							{[...order.history].reverse().map((h) => (
								<li>
									<time datetime={h.at}>{dateTime(h.at, lang)}</time> – {t.orderStatus[h.status]}
									{h.note && h.status !== "paid" ? ` (${historyNote(h.note)})` : ""}
								</li>
							))}
						</ol>
					</section>
				</div>

				<aside class="summary window card-pad">
					<h2>{t.items}</h2>
					<ul class="lines">
						{lines.map((l) => (
							<li class="line">
								{l.image && <img src={l.image} width="56" height="56" alt="" loading="lazy" />}
								<div>
									<a href={`${routes[lang].product}/${l.slug}`}>{l.title}</a>
									<p class="small muted">
										{l.skuName} × {l.quantity}
									</p>
								</div>
								<strong>{formatVnd(l.lineTotal, lang)}</strong>
							</li>
						))}
					</ul>
					<dl class="totals">
						<dt>{t.subtotal}</dt>
						<dd>{formatVnd(order.subtotal, lang)}</dd>
						<dt>{t.shipping}</dt>
						<dd>{order.shippingFee ? formatVnd(order.shippingFee, lang) : t.free}</dd>
						<dt class="totals__grand">{t.total}</dt>
						<dd class="totals__grand">{formatVnd(order.total, lang)}</dd>
					</dl>
					<a class="btn btn--ghost btn--block" href={routes[lang].products}>
						{t.continueShopping}
					</a>
				</aside>
			</div>
		</div>
	);
}

export function LookupPage({ ctx }: { ctx: ViewCtx }) {
	const t = text[ctx.lang];
	return (
		<div class="container page narrow">
			<header class="page-head">
				<h1>{t.trackOrder}</h1>
				<p class="muted">{t.lookupIntro}</p>
			</header>
			<form class="window card-pad form-grid" data-lookup-form>
				<label class="field">
					<span>{t.orderCode}</span>
					<input name="code" required minlength={7} maxlength={20} autocapitalize="characters" placeholder="MA…" />
				</label>
				<label class="field">
					<span>{t.phoneNumber}</span>
					<input name="phone" type="tel" inputmode="tel" required minlength={9} maxlength={20} />
				</label>
				<p class="form-error field--wide" data-form-error role="alert" hidden></p>
				<button type="submit" class="btn btn--primary field--wide">
					{t.lookUp}
				</button>
			</form>
			<div data-lookup-result aria-live="polite"></div>
		</div>
	);
}
