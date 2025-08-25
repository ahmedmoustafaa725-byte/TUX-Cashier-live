// src/posPrint.js
// Direct ESC/POS printing via QZ Tray — no UI, no prompts.
// Default: auto-pick the first OS printer found.
// Optional: hard-code printer names below to force a specific device.

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
function createConfig(qz, name, overrides = {}) {
  return qz.configs.create(name, {
    encoding: "CP437",
    rasterize: false, // raw ESC/POS text; images are handled via raw image flavor below
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    colorType: "grayscale",
    ...overrides,
  });
}

/* ── ESC/POS helpers ─────────────────────────────────────────────────── */
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

// feed n lines
const FEED = (n = 3) => "\x1Bd" + String.fromCharCode(n);

// full cut
const CUT = "\x1DV\x00";

const dash = (n) => "-".repeat(n) + "\n";

function linePrice(left, price, cols) {
  const p = Number(price).toFixed(2);
  const gap = Math.max(1, cols - left.length - p.length);
  return left + " ".repeat(gap) + p + "\n";
}

/** Resolve first path that exists (HEAD), else return null */
async function resolveFirstExisting(paths) {
  for (const p of paths) {
    try {
      const res = await fetch(p, { method: "HEAD" });
      if (res.ok) return p;
    } catch (_) {}
  }
  return null;
}

/** Build array of raw-image items for ESC/POS via QZ Tray (centered) */
async function buildLogoItems() {
  // Try common locations/filenames; feel free to change to your exact files
  const qrPath       = await resolveFirstExisting(["/receipt/qr.png","/receipt/qr.jpg","/qr.png","/qr.jpg"]);
  const deliveryPath = await resolveFirstExisting(["/receipt/delivery.png","/receipt/delivery.jpg","/delivery.png","/delivery.jpg"]);
  const tuxPath      = await resolveFirstExisting(["/receipt/tux.png","/receipt/tux.jpg","/logo.png","/logo.jpg"]);

  const items = [];

  // Center align for images
  items.push(A.C);

  const toImage = (filePath) => ({
    type: "raw",
    format: "image",
    flavor: "file",            // path/URL served by your app (Netlify public/)
    data: filePath,
    options: {
      language: "ESCPOS",      // let QZ convert to ESC/POS image commands
      dotDensity: "double",    // good balance for 80mm printers
      // You can also use { width: 380 } to constrain width in dots if desired
    },
  });

  if (qrPath)       items.push(toImage(qrPath), FEED(1));
  if (deliveryPath) items.push(toImage(deliveryPath), FEED(1));
  if (tuxPath)      items.push(toImage(tuxPath), FEED(1));

  // back to left align for any subsequent raw text (if any)
  items.push(A.L);

  return items;
}

/**
 * Build ESC/POS receipt (58mm≈32 cols, 80mm≈48 cols)
 * Now supports includeCut: pass false when you want to append logos before cutting.
 */
function buildReceipt(order, {
  title = "TUX",
  address = "El-Saada St – Zahraa El-Maadi",
  phone = "0100-000-0000",
  widthMm = 80,
  copy = "Customer",
  includeCut = true,
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

  // Footer (copy label)
  s += FEED(2) + A.C + `${copy} copy\n`;

  // Only cut here if requested; for Customer we append logos then cut.
  if (includeCut) {
    s += FEED(3) + CUT;
  }
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

// Low-level: send mixed data (raw strings + raw images) to a printer
async function printMixed(printerName, data) {
  const qz = await ensureQz();
  // Note: we keep rasterize:false; raw-image flavor handles ESC/POS images directly.
  await qz.print(createConfig(qz, printerName), data);
}

// Low-level: send pure ESC/POS text to a printer
async function printRawEscPos(printerName, raw) {
  const qz = await ensureQz();
  const data = [raw]; // shorthand for { type:'raw', format:'command', flavor:'plain', data: raw }
  await qz.print(createConfig(qz, printerName), data);
}

/**
 * Public: print a receipt (no dialog)
 * @param {object} order
 * @param {object} options - { widthMm: 58|80, copy: "Customer"|"Kitchen" }
 */
export async function printReceiptDirect(order, { widthMm = 80, copy = "Customer" } = {}) {
  const name = await resolvePrinterName(copy);

  if (copy === "Customer") {
    // 1) Build receipt WITHOUT final cut
    const rawNoCut = buildReceipt(order, { widthMm, copy, includeCut: false });

    // 2) Build logo items (centered). If none exist, this returns just alignment resets.
    const logoItems = await buildLogoItems();

    // 3) Add some spacing and then CUT
    const tail = [FEED(2), CUT];

    // 4) Print all in-order: text -> logos -> tail
    await printMixed(name, [rawNoCut, ...logoItems, ...tail]);
  } else {
    // Kitchen: unchanged behavior (no logos)
    const raw = buildReceipt(order, { widthMm, copy, includeCut: true });
    await printRawEscPos(name, raw);
  }
}
