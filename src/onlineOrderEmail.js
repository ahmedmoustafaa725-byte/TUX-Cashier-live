const EMAILJS_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

const formatMoney = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "E£0.00";
  return `E£${num.toFixed(2)}`;
};

const buildOrderDetailsText = (posOrder) => {
  if (!posOrder || !Array.isArray(posOrder.cart) || posOrder.cart.length === 0) {
    return "No items provided.";
  }
  const lines = [];
  posOrder.cart.forEach((item, index) => {
    const name = item?.name || `Item ${index + 1}`;
    const qty = Math.max(1, Number(item?.qty ?? item?.quantity ?? 1) || 1);
    const price = Number(item?.price || 0);
    lines.push(`${index + 1}. ${name} × ${qty} — ${formatMoney(price)}`);
    if (Array.isArray(item?.extras) && item.extras.length > 0) {
      item.extras.forEach((extra) => {
        const extraName = extra?.name || "Extra";
        const extraPrice = Number(extra?.price || 0);
        lines.push(`   • + ${extraName} (${formatMoney(extraPrice)}) × ${qty}`);
      });
    }
  });
  return lines.join("\n");
};

const findEmailInObject = (obj) => {
  if (!obj || typeof obj !== "object") return null;
  const entries = Object.entries(obj);
  for (const [key, value] of entries) {
    if (typeof value === "string") {
      if (/email/i.test(key) && /@/.test(value)) {
        return value.trim();
      }
    } else if (value && typeof value === "object") {
      const nested = findEmailInObject(value);
      if (nested) return nested;
    }
  }
  return null;
};

const extractCustomerEmail = (onlineOrder = {}) => {
  const explicitCandidates = [
    onlineOrder.customerEmail,
    onlineOrder.deliveryEmail,
    onlineOrder.email,
    onlineOrder?.raw?.customerEmail,
    onlineOrder?.raw?.customer_email,
    onlineOrder?.raw?.email,
    onlineOrder?.raw?.contactEmail,
    onlineOrder?.raw?.contact_email,
    onlineOrder?.raw?.deliveryEmail,
    onlineOrder?.raw?.delivery_email,
  ];
  for (const candidate of explicitCandidates) {
    if (typeof candidate === "string" && /@/.test(candidate)) {
      return candidate.trim();
    }
  }
  const nestedSources = [
    onlineOrder?.raw,
    onlineOrder?.raw?.customer,
    onlineOrder?.raw?.delivery,
    onlineOrder?.raw?.contact,
    onlineOrder?.raw?.user,
    onlineOrder?.raw?.client,
    onlineOrder?.raw?.recipient,
    onlineOrder?.raw?.shipping,
    onlineOrder?.raw?.billing,
  ];
  for (const source of nestedSources) {
    const found = findEmailInObject(source);
    if (found) return found.trim();
  }
  return "";
};

const resolveDeliveryZone = (onlineOrder = {}) => {
  const zone =
    onlineOrder.deliveryZoneName ||
    onlineOrder?.raw?.deliveryZone ||
    onlineOrder?.raw?.delivery?.zoneName ||
    onlineOrder?.raw?.delivery?.zone ||
    onlineOrder?.raw?.zoneName ||
    onlineOrder?.raw?.zone ||
    onlineOrder.deliveryZoneId;
  return zone ? String(zone) : "";
};

const getEmailConfig = () => {
  if (typeof document === "undefined") return null;
  const rootEl = document.getElementById("root");
  if (!rootEl || !rootEl.dataset) return null;
   const {
    emailService,
    emailTemplate,
    emailPublic,
    emailPrivate,
    emailFrom,
  } = rootEl.dataset;
  if (!emailService || !emailTemplate || !emailPublic) return null;
  return {
    serviceId: emailService,
    templateId: emailTemplate,
    publicKey: emailPublic,
    privateKey: emailPrivate || "",
    fromEmail: emailFrom || "",
  };
};
const resolveConfirmationCode = (posOrder = {}, onlineOrder = {}) => {
  const candidates = [
    onlineOrder.confirmationCode,
    onlineOrder.confirmation_code,
    onlineOrder?.raw?.confirmationCode,
    onlineOrder?.raw?.confirmation_code,
    onlineOrder.channelOrderNo,
    posOrder.channelOrderNo,
    posOrder.orderNo,
    onlineOrder.orderNo,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const trimmed = String(candidate).trim();
    if (trimmed) return trimmed;
  }
  return "";
};
const buildTemplateParams = (posOrder = {}, onlineOrder = {}) => {
  const toName = onlineOrder.deliveryName || onlineOrder?.raw?.customer?.name || "Customer";
  const orderId = posOrder.channelOrderNo || posOrder.orderNo || onlineOrder.orderNo || "";
  const placedDate = new Date(
    Number(onlineOrder.createdAtMs) ||
      (onlineOrder.createdAt instanceof Date ? onlineOrder.createdAt.getTime() : 0) ||
      (posOrder.date instanceof Date ? posOrder.date.getTime() : Date.now())
  );
  const paymentSummary = Array.isArray(posOrder.paymentParts) && posOrder.paymentParts.length > 0
    ? posOrder.paymentParts
        .map((part) => `${part.method || "Payment"}: ${formatMoney(part.amount)}`)
        .join(" + ")
    : posOrder.payment || onlineOrder.payment || "Online";
  const subtotal =
    posOrder.itemsTotal != null
      ? Number(posOrder.itemsTotal)
      : Number(posOrder.total || 0) - Number(posOrder.deliveryFee || 0);
  const orderDetails = buildOrderDetailsText(posOrder);

  return {
    to_name: toName,
    to_email: extractCustomerEmail(onlineOrder),
    order_id: orderId ? `#${orderId}` : "Your order",
    order_total: formatMoney(posOrder.total),
        confirmation_code: resolveConfirmationCode(posOrder, onlineOrder),

    order_subtotal: formatMoney(subtotal),
    delivery_fee: formatMoney(posOrder.deliveryFee),
    order_details: orderDetails,
    placed_at: placedDate.toLocaleString(),
    address: posOrder.deliveryAddress || onlineOrder.deliveryAddress || "Pickup at store",
    phone: onlineOrder.deliveryPhone || posOrder.deliveryPhone || "",
    instructions: posOrder.note || onlineOrder.note || "None",
    fulfillment: posOrder.orderType || onlineOrder.orderType || "Pickup",
    payment_method: paymentSummary,
    delivery_zone: resolveDeliveryZone(onlineOrder) || "",
    from_email: getEmailConfig()?.fromEmail || "",
    from_name: "TUX",
  };
};

export const sendOnlineOrderConfirmationEmail = async (posOrder, onlineOrder) => {
  const config = getEmailConfig();
  if (!config) {
    return { status: "skipped", reason: "missing-config" };
  }
  if (!config.privateKey) {
    return { status: "skipped", reason: "missing-access-token" };
  }
  const templateParams = buildTemplateParams(posOrder, onlineOrder);
  if (!templateParams.to_email) {
    return { status: "skipped", reason: "missing-recipient" };
  }

  try {
    const response = await fetch(EMAILJS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.publicKey,
        accessToken: config.privateKey,
        template_params: templateParams,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const error = text ? `${response.status} ${response.statusText}: ${text}` : `${response.status} ${response.statusText}`;
      return { status: "failed", error };
    }

    return { status: "sent" };
  } catch (err) {
    return { status: "failed", error: err?.message || String(err) };
  }
};

export default sendOnlineOrderConfirmationEmail;
