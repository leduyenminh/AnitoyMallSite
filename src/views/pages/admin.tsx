import type { Child } from "hono/jsx";
import { catalogSource } from "../../lib/db";
import { formatVnd } from "../../lib/money";
import { allowedActions, type OrderAction } from "../../lib/orders";
import { paymentLabels } from "../../lib/config";
import type { Order, Product } from "../../lib/types";
import { statusLabels } from "./order";

const actionLabels: Record<OrderAction, string> = {
	confirm: "Xác nhận đơn",
	mark_paid: "Đã nhận tiền",
	ship: "Đã giao cho vận chuyển",
	deliver: "Đã giao thành công",
	cancel: "Huỷ đơn (trả hàng về kho)",
};

const dt = (iso: string) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));

export function AdminDocument({ title, build, children }: { title: string; build: string; children: Child }) {
	return (
		<html lang="vi" data-theme="light">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="robots" content="noindex, nofollow" />
				<title>{`${title} · Quản trị`}</title>
				<link rel="stylesheet" href={`/assets/app.css?v=${build}`} />
				<script type="module" src={`/assets/admin.js?v=${build}`} />
			</head>
			<body class="admin">
				<header class="admin__bar">
					<a href="/admin">
						<strong>Anitoy · Quản trị</strong>
					</a>
					<nav>
						<a href="/admin">Đơn hàng</a>
						<a href="/admin/san-pham">Sản phẩm</a>
						<a href="/" target="_blank">
							Xem shop ↗
						</a>
					</nav>
				</header>
				<main class="container page">{children}</main>
			</body>
		</html>
	);
}

export function AdminOrders({ orders, counts, status, q }: { orders: Order[]; counts: Record<string, number>; status?: string; q?: string }) {
	const tabs = ["", "pending", "confirmed", "shipped", "delivered", "cancelled"];
	return (
		<>
			<h1>Đơn hàng</h1>
			<form class="toolbar" method="get" action="/admin">
				<nav class="sort">
					{tabs.map((t) => (
						<a class="chip" aria-pressed={(status ?? "") === t ? "true" : "false"} href={t ? `/admin?status=${t}` : "/admin"}>
							{t ? statusLabels[t as Order["status"]] : "Tất cả"} {t ? `(${counts[t] ?? 0})` : ""}
						</a>
					))}
				</nav>
				<input name="q" value={q} placeholder="Mã đơn hoặc SĐT" />
				<button class="btn btn--primary" type="submit">
					Tìm
				</button>
			</form>
			<div class="table-wrap window">
				<table class="table">
					<thead>
						<tr>
							<th>Mã đơn</th>
							<th>Thời gian</th>
							<th>Khách</th>
							<th>Thanh toán</th>
							<th>Trạng thái</th>
							<th class="num">Tổng</th>
							<th>Tự huỷ lúc</th>
						</tr>
					</thead>
					<tbody>
						{orders.map((o) => (
							<tr>
								<td>
									<a class="mono" href={`/admin/don-hang/${o.id}`}>
										{o.id}
									</a>
								</td>
								<td>{dt(o.createdAt)}</td>
								<td>
									{o.customer.name}
									<br />
									<small>{o.customer.phone}</small>
								</td>
								<td>
									{paymentLabels[o.paymentMethod].title}
									<br />
									<small class={o.paymentStatus === "paid" ? "ok" : "muted"}>{o.paymentStatus === "paid" ? "Đã trả" : "Chưa trả"}</small>
								</td>
								<td>
									<span class={`status status--${o.status}`}>{statusLabels[o.status]}</span>
								</td>
								<td class="num">{formatVnd(o.total)}</td>
								<td>{o.expiresAt && o.status === "pending" && o.paymentStatus === "unpaid" ? dt(o.expiresAt) : "–"}</td>
							</tr>
						))}
					</tbody>
				</table>
				{!orders.length && <p class="card-pad muted">Chưa có đơn hàng.</p>}
			</div>
		</>
	);
}

export function AdminOrder({ order, canBookGhn }: { order: Order; canBookGhn: boolean }) {
	const actions = allowedActions(order);
	return (
		<>
			<p>
				<a href="/admin">← Đơn hàng</a>
			</p>
			<h1>
				Đơn <span class="mono">{order.id}</span> · {statusLabels[order.status]}
			</h1>
			<div class="checkout">
				<div class="checkout__main">
					<section class="window card-pad">
						<h2>Xử lý</h2>
						<div class="admin-actions" data-order={order.id} data-version={order.version}>
							{actions.map((a) => (
								<button type="button" class={`btn ${a === "cancel" ? "btn--ghost" : "btn--primary"}`} data-action={a} data-confirm={a === "cancel" ? "Huỷ đơn và trả hàng về kho?" : undefined}>
									{actionLabels[a]}
								</button>
							))}
							{canBookGhn && (
								<button
									type="button"
									class="btn btn--primary"
									data-book-ghn
									data-confirm="Tạo vận đơn GHN cho đơn này? Tên, số điện thoại, địa chỉ và ghi chú của khách sẽ được gửi cho GHN."
								>
									Tạo vận đơn GHN
								</button>
							)}
						</div>
						<p class="form-error" data-form-error hidden></p>
						{order.shipment && (
							<p>
								GHN: <strong class="mono">{order.shipment.code}</strong> · {order.shipment.status}
								{order.paymentMethod === "cod" && order.paymentStatus === "unpaid" ? " · COD được ghi nhận khi GHN chuyển tiền" : ""}
							</p>
						)}
						<p class="small muted">
							{paymentLabels[order.paymentMethod].title} · {order.paymentStatus === "paid" ? "đã thanh toán" : "chưa thanh toán"}
							{order.payment?.transactionId ? ` · mã GD ${order.payment.transactionId}` : ""}
							{order.expiresAt && order.status === "pending" && order.paymentStatus === "unpaid" ? ` · tự huỷ lúc ${dt(order.expiresAt)} nếu chưa xác nhận` : ""}
						</p>
					</section>
					<section class="window card-pad">
						<h2>Khách hàng</h2>
						<p>
							<strong>{order.customer.name}</strong> · <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
							{order.customer.email ? ` · ${order.customer.email}` : ""}
						</p>
						<p>
							{order.address.street}, {order.address.ward}, {order.address.province}
						</p>
						{order.note && <p>Ghi chú: {order.note}</p>}
					</section>
					<section class="window card-pad">
						<h2>Lịch sử</h2>
						<ol class="timeline">
							{order.history.map((h) => (
								<li>
									{dt(h.at)} – {statusLabels[h.status]}
									{h.note ? ` (${h.note})` : ""}
								</li>
							))}
						</ol>
					</section>
				</div>
				<aside class="summary window card-pad">
					<ul class="lines">
						{order.lines.map((l) => (
							<li class="line">
								{l.image && <img src={l.image} width="48" height="48" alt="" />}
								<div>
									{l.title}
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
						<dt>Vận chuyển</dt>
						<dd>{formatVnd(order.shippingFee)}</dd>
						<dt class="totals__grand">Tổng</dt>
						<dd class="totals__grand">{formatVnd(order.total)}</dd>
					</dl>
				</aside>
			</div>
		</>
	);
}

export function AdminProducts({ products }: { products: Product[] }) {
	return (
		<>
			<h1>Sản phẩm</h1>
			<div class="window card-pad admin-import">
				<p>
					Catalog nhập từ TikTok Shop lúc {dt(catalogSource.importedAt)}. Chạy <code>npm run import</code> rồi deploy để cập nhật ảnh, mô tả; bấm nút dưới đây để áp dụng
					vào cơ sở dữ liệu.
				</p>
				<button type="button" class="btn btn--ghost" data-import="content">
					Cập nhật nội dung (giữ giá & tồn kho)
				</button>
				<button type="button" class="btn btn--ghost" data-import="prices" data-confirm="Đặt lại giá mọi sản phẩm có trên TikTok Shop = giá niêm yết TikTok trừ phí TikTok (giữ tồn kho)?">
					Áp dụng giá từ TikTok (trừ phí, giữ tồn kho)
				</button>
				<button type="button" class="btn btn--ghost" data-import="commerce" data-confirm="Ghi đè giá và tồn kho bằng số liệu TikTok Shop?">
					Cập nhật cả giá & tồn kho từ TikTok
				</button>
			</div>
			{products.map((p) => (
				<section class="window card-pad admin-product" data-product-id={p.id}>
					<header class="row-between">
						<div>
							<a href={`/san-pham/${p.slug}`} target="_blank">
								<strong>{p.title}</strong>
							</a>
							<p class="small muted">
								{p.id} · {p.tiktokProductId ? "TikTok Shop" : "chỉ có trong video"}
							</p>
						</div>
						<label>
							Trạng thái{" "}
							<select data-product-status>
								{(["active", "draft", "archived"] as const).map((st) => (
									<option value={st} selected={p.status === st}>
										{st === "active" ? "Đang bán" : st === "draft" ? "Nháp (ẩn)" : "Ngừng bán"}
									</option>
								))}
							</select>
						</label>
					</header>
					<table class="table">
						<thead>
							<tr>
								<th>Mẫu</th>
								<th>Giá (₫)</th>
								<th>Giá gạch (₫)</th>
								<th>Tồn kho</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{p.skus.map((k) => (
								<tr data-sku-id={k.id} data-seen-stock={k.stock}>
									<td>{k.name}</td>
									<td>
										<input type="number" min="0" step="1000" value={k.price} data-field="price" />
									</td>
									<td>
										<input type="number" min="0" step="1000" value={k.compareAtPrice ?? ""} data-field="compareAtPrice" />
									</td>
									<td>
										<input type="number" min="0" step="1" value={k.stock} data-field="stock" />
									</td>
									<td>
										<button type="button" class="btn btn--primary btn--sm" data-save-sku>
											Lưu
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			))}
		</>
	);
}
