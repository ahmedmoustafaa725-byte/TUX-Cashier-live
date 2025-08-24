// src/posPrint.js
// Direct ESC/POS printing via QZ Tray — no UI, no prompts.
// Default: auto-pick the first OS printer found.
// Optional: hard-code printer names below to force a specific device.
// ==== QZ SECURITY (signed requests) ====

// Paste the FULL content of qz-public.crt between the lines below
const QZ_CERT_PEM =  `-----BEGIN CERTIFICATE-----
MIICszCCAZsCFEDMPY9Ranwy++6HoBvg+hae7UzGMA0GCSqGSIb3DQEBCwUAMBYx
FDASBgNVBAMMC3R1eC1jYXNoaWVyMB4XDTI1MDgyNDA1MzM0OFoXDTM1MDgyMjA1
MzM0OFowFjEUMBIGA1UEAwwLdHV4LWNhc2hpZXIwggEiMA0GCSqGSIb3DQEBAQUA
A4IBDwAwggEKAoIBAQDNeAnhhvG0+o7G6K2yvTxIFJEnq8TTSg8fXeOjQpmtKoie
kH6elyNrVhXP3iIHCdQoPNWyHtPfOeldMgex4GDweMs/teRGi/zfSrp+1y/HYZti
fpc4mtxTAlMtyaehdyESrwDG1bjfskOsB2P6rpGsaoTjwNZmERCDRd1hAptaV0oT
efXoCb7j7eUJaybiMdjLdfVUY2PSk/+YeerJBmND3Mgn59hSeDabwlm7JYmyx+t7
cnjUCl1pzXtK3JCnb9h9sD99LxdIb9ShFnXEwJTP7DQzm58JVp0Vadxn5Q6kPhF7
5a7GxFHh+o+blHkKYy4gc8V2f91mQO5mVRb8Lb5dAgMBAAEwDQYJKoZIhvcNAQEL
BQADggEBAKtrWGCcl6z/WRBtLSJkUlqMo6NaqCnmDZVN82lzlPGXNa6e1YRGKU7d
oJtxrmJtkV5dooYeM3Jgbs1B1ZzFxPwcI0V/+5rVBnD3Da7dyxqrf9nl+MjxBKKl
JpkhyeEE/0BZ+uiDYPR70PZbJAG5KB90u+brvHMXujPwRnG6Y23r+15fMMExPkbZ
rz44xQzM/voQoO5XmzeYtv4nBSkChiaz9Vt2ESpBBABPUX9X5jSzmdxAvk1c9ESw
zHThXfS5J1RhyLzbWY3M3OuJS7viLR7XOEtmpvtSgg34oN2mBxs592zD46thr3hk
VDKwue+bmWVF5Oe1HAc0q3a3jiHN798=
-----END CERTIFICATE-----`
;

function setupQzSecurity(qz) {
  // Provide public certificate
  qz.security.setCertificatePromise((resolve) => resolve(QZ_CERT_PEM));

  // Ask Netlify function to sign using private key
  qz.security.setSignaturePromise((toSign) =>
    new Promise((resolve, reject) => {
      fetch("/.netlify/functions/qz-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toSign }),
      })
        .then((r) => r.text())
        .then(resolve)
        .catch(reject);
    })
  );
}

// ── OPTIONAL: hard-code specific printer names (exact OS names) ─────────
const CUSTOMER_PRINTER = ""; // e.g., "EPSON TM-T20II Receipt"
const KITCHEN_PRINTER  = ""; // e.g., "EPSON TM-T20II Kitchen"

// Get global qz object
function getQz() {
  return typeof window !== "undefined" ? window.qz : undefined;
}

// Ensure QZ Tray is connected (supports old/new API shapes)
export async function ensureQz() {
  const qz = getQz();
  if (!qz) {
    throw new Error(
      'QZ Tray bridge not found. Add <script src="https://cdn.jsdelivr.net/npm/qz-tray/qz-tray.js"></script> in public/index.html and open this app in a browser.'
    );
  }

  // 🔑 NEW: configure QZ security (cert + signer)
  setupQzSecurity(qz);
  
  if (qz.websocket && typeof qz.websocket.isActive === "function") {
    if (!qz.websocket.isActive()) await qz.websocket.connect();
  } else if (typeof qz.isActive === "function" && typeof qz.connect === "function") {
    if (!qz.isActive()) await qz.connect();
  }
  return qz;
}

// Find OS printers
export async function listPrinters() {
  const qz = await ensureQz();
  return qz.printers.find();
}

// Create print config
function createConfig(qz, name) {
  return qz.configs.create(name, {
    encoding: "CP437",
    rasterize: false,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    colorType: "grayscale",
  });
}

/* ── ESC/POS helpers (single literals to satisfy ESLint) ─────────────── */
const INIT = "\x1B@";

const A = {
  L: "\x1Ba\x00",
  C: "\x1Ba\x01",
  R: "\x1Ba\x02",
};

const BOLD_ON  = "\x1BE\x01";
const BOLD_OFF = "\x1BE\x00";

const DOUBLE_ON  = "\x1B!\x30"; // double height+width
const DOUBLE_OFF = "\x1B!\x00";

// dynamic ok:
const FEED = (n = 3) => "\x1Bd" + String.fromCharCode(n);

const CUT = "\x1DV\x00";

const dash = (n) => "-".repeat(n) + "\n";

function linePrice(left, price, cols) {
  const p = Number(price).toFixed(2);
  const gap = Math.max(1, cols - left.length - p.length);
  return left + " ".repeat(gap) + p + "\n";
}

/**
 * Build ESC/POS receipt (58mm≈32 cols, 80mm≈48 cols)
 */
function buildReceipt(order, {
  title = "TUX",
  address = "El-Saada St – Zahraa El-Maadi",
  phone = "0100-000-0000",
  widthMm = 80,
  copy = "Customer",
} = {}) {
  const cols = widthMm >= 80 ? 48 : 32;
  const ts = new Date(order?.date || Date.now()).toLocaleString();

  let s = "";
  s += INIT;
  s += A.C + BOLD_ON + DOUBLE_ON + `${title}\n` + DOUBLE_OFF + BOLD_OFF;
  s += A.C + `${address}\n${phone}\n`;
  s += dash(cols);
  s += A.L + `Order: #${order?.orderNo ?? ""}\nDate : ${ts}\n`;
  s += `Worker: ${order?.worker || ""}\nPayment: ${order?.payment || ""}\nType: ${order?.orderType || ""}\n`;
  if (order?.orderType === "Delivery" && order?.deliveryFee) {
    s += `Delivery Fee: ${Number(order.deliveryFee).toFixed(2)}\n`;
  }
  if (order?.note) s += `Note: ${String(order.note).trim()}\n`;
  s += dash(cols);

  // Items
  let calcItemsTotal = 0;
  for (const it of order?.cart || []) {
    const base = Number(it?.price || 0);
    calcItemsTotal += base + (it?.extras || []).reduce((a, e) => a + Number(e?.price || 0), 0);
    s += linePrice(it?.name || "Item", base, cols);
    for (const ex of it?.extras || []) {
      s += linePrice("  + " + (ex?.name || ""), Number(ex?.price || 0), cols);
    }
  }

  s += dash(cols);

  const itemsTotal = Number(order?.itemsTotal ?? calcItemsTotal);
  const delivery = Number(order?.deliveryFee || 0);
  const total = Number(order?.total ?? (itemsTotal + delivery));

  s += linePrice("Items", itemsTotal, cols);
  if (delivery) s += linePrice("Delivery", delivery, cols);
  s += dash(cols);
  s += BOLD_ON + linePrice("TOTAL", total, cols) + BOLD_OFF;

  s += FEED(2) + A.C + `${copy} copy\n` + FEED(3) + CUT;
  return s;
}

// Resolve printer name: prefer hard-coded; else first printer
async function resolvePrinterName(copy) {
  const hardcoded =
    copy === "Kitchen" ? (KITCHEN_PRINTER || CUSTOMER_PRINTER) : (CUSTOMER_PRINTER || KITCHEN_PRINTER);
  const list = await listPrinters();
  if (!list.length) throw new Error("No printers found on this machine. Install the driver and restart QZ Tray.");
  if (hardcoded) {
    const found = list.find((n) => n === hardcoded);
    if (!found) {
      console.warn(`Hard-coded printer "${hardcoded}" not found. Using first available: ${list[0]}`);
      return list[0];
    }
    return hardcoded;
  }
  return list[0];
}

// Low-level: send ESC/POS to a printer
async function printRawEscPos(printerName, raw) {
  const qz = await ensureQz();
  const data = [{ type: "raw", format: "plain", data: raw }];
  await qz.print(createConfig(qz, printerName), data);
}

/**
 * Public: print a receipt (no dialog)
 * @param {object} order
 * @param {object} options - { widthMm: 58|80, copy: "Customer"|"Kitchen" }
 */
export async function printReceiptDirect(order, { widthMm = 80, copy = "Customer" } = {}) {
  const name = await resolvePrinterName(copy);
  const raw = buildReceipt(order, { widthMm, copy });
  await printRawEscPos(name, raw);
}
