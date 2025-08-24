// src/posPrint.js
// QZ Tray helper for direct ESC/POS printing (auto, no browser dialog).
// Usage:
//   import { printReceiptDirect, choosePrintersViaPrompt } from "./posPrint";
//   await printReceiptDirect(order, { widthMm: 80, copy: "Customer" });

/** Get the global qz object safely */
function getQz() {
  return typeof window !== "undefined" ? window.qz : undefined;
}

/** Ensure QZ Tray script is loaded and websocket is connected */
export async function ensureQz() {
  const qz = getQz();
  if (!qz) {
    throw new Error(
      "QZ Tray bridge not found. Make sure you added <script src=\"https://cdn.jsdelivr.net/npm/qz-tray/qz-tray.js\"></script> in public/index.html and you’re running in the browser."
    );
  }

  // Support both old and new API shapes
  if (qz.websocket && typeof qz.websocket.isActive === "function") {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }
  } else if (typeof qz.isActive === "function" && typeof qz.connect === "function") {
    if (!qz.isActive()) {
      await qz.connect();
    }
  }
  return qz;
}

/** List available OS printers on this machine */
export async function listPrinters() {
  const qz = await ensureQz();
  return qz.printers.find();
}

// Separate saved choices for customer & kitchen printers
const STORAGE_KEYS = {
  cust: "PREFERRED_PRINTER_CUSTOMER",
  kit: "PREFERRED_PRINTER_KITCHEN",
};

export function savePrinter(which, name) {
  const key = STORAGE_KEYS[which];
  if (!key) throw new Error("Unknown printer slot: " + which);
  localStorage.setItem(key, name);
}

export function getPrinter(which) {
  const key = STORAGE_KEYS[which];
  if (!key) throw new Error("Unknown printer slot: " + which);
  return localStorage.getItem(key) || null;
}

/** Create a QZ print config for a given OS printer name */
function createConfig(qz, name) {
  return qz.configs.create(name, {
    encoding: "CP437",
    rasterize: false,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    colorType: "grayscale",
  });
}

/* -------------------------- ESC/POS helpers -------------------------- */
/* (Single literals to satisfy ESLint no-useless-concat) */
const INIT = "\x1B@";

const A = {
  L: "\x1Ba\x00",
  C: "\x1Ba\x01",
  R: "\x1Ba\x02",
};

const BOLD_ON = "\x1BE\x01";
const BOLD_OFF = "\x1BE\x00";

const DOUBLE_ON = "\x1B!\x30"; // double height+width
const DOUBLE_OFF = "\x1B!\x00";

// FEED uses a dynamic value; concatenation with a variable is allowed
const FEED = (n = 3) => "\x1Bd" + String.fromCharCode(n);

const CUT = "\x1DV\x00";

const dash = (n) => "-".repeat(n) + "\n";

function linePrice(left, price, cols) {
  const p = Number(price).toFixed(2);
  const gap = Math.max(1, cols - left.length - p.length);
  return left + " ".repeat(gap) + p + "\n";
}

/**
 * Build an ESC/POS receipt string (58mm ≈ 32 cols, 80mm ≈ 48 cols)
 * @param {object} order - { orderNo, date, worker, payment, orderType, deliveryFee, itemsTotal, total, cart[], note }
 * @param {object} opts  - { title, address, phone, widthMm, copy }
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
  if (order?.note) {
    s += `Note: ${String(order.note).trim()}\n`;
  }
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

/** Low-level: send raw text (ESC/POS) to a named printer */
async function printRawEscPos(printerName, raw) {
  const qz = await ensureQz();
  const data = [{ type: "raw", format: "plain", data: raw }];
  await qz.print(createConfig(qz, printerName), data);
}

/**
 * Public API: print a receipt directly (no dialog)
 * @param {object} order
 * @param {object} options - { widthMm: 58|80, copy: "Customer"|"Kitchen" }
 */
export async function printReceiptDirect(order, { widthMm = 80, copy = "Customer" } = {}) {
  const slot = copy === "Kitchen" ? "kit" : "cust";
  let name = getPrinter(slot);
  if (!name) {
    const list = await listPrinters();
    if (!list.length) throw new Error("No printers found on this machine. Install the driver and restart QZ Tray.");
    name = list[0];
    savePrinter(slot, name);
  }
  const raw = buildReceipt(order, { widthMm, copy });
  await printRawEscPos(name, raw);
}

/** Simple UI flow to choose and save Customer & Kitchen printers using prompt() */
export async function choosePrintersViaPrompt() {
  await ensureQz();
  const list = await listPrinters();
  if (!list.length) {
    alert("No printers found. Install your thermal printer driver and try again.");
    return;
  }
  const currentCust = getPrinter("cust") || list[0];
  const currentKit = getPrinter("kit") || list[0];

  const cust = window.prompt(`Customer printer:\n${list.join("\n")}`, currentCust);
  if (cust) savePrinter("cust", cust);

  const kit = window.prompt(`Kitchen printer:\n${list.join("\n")}`, currentKit);
  if (kit) savePrinter("kit", kit);

  const savedCust = getPrinter("cust");
  const savedKit = getPrinter("kit");
  window.alert(`Saved printers:\nCustomer → ${savedCust}\nKitchen  → ${savedKit}`);
}
