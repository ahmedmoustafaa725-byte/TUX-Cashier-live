// src/posPrint.js
// Minimal QZ Tray helper for direct ESC/POS printing (auto, no dialog).

const QZ = () => window.qz;

// ---- connect ----
export async function ensureQz() {
  if (!QZ()) throw new Error("QZ Tray script not loaded (index.html)");
  if (!QZ().isActive()) await QZ().connect();   // will prompt to Allow the first time
  return QZ();
}

export async function listPrinters() {
  const qz = await ensureQz();
  return qz.printers.find();
}

// Save separate choices for customer & kitchen printers
const K = {
  cust: "PREFERRED_PRINTER_CUSTOMER",
  kit:  "PREFERRED_PRINTER_KITCHEN",
};
export function savePrinter(which, name) { localStorage.setItem(K[which], name); }
export function getPrinter(which) { return localStorage.getItem(K[which]) || null; }

function cfg(name) {
  return QZ().configs.create(name, {
    encoding: "CP437",
    rasterize: false,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

// ---- simple ESC/POS helpers ----
const ESC = '\x1B', GS = '\x1D', INIT = ESC + '@';
const A = { L: ESC+'a'+'\x00', C: ESC+'a'+'\x01', R: ESC+'a'+'\x02' };
const BOLD_ON = ESC+'E'+'\x01', BOLD_OFF = ESC+'E'+'\x00';
const DOUBLE_ON = ESC+'!'+'\x30', DOUBLE_OFF = ESC+'!'+'\x00';
const FEED = (n=3)=> ESC+'d'+String.fromCharCode(n);
const CUT = GS+'V'+'\x00';
const dash = (n)=> '-'.repeat(n) + '\n';

function linePrice(left, price, cols) {
  const p = Number(price).toFixed(2);
  const gap = Math.max(1, cols - left.length - p.length);
  return left + ' '.repeat(gap) + p + '\n';
}

function buildReceipt(order, { title='TUX', address='El-Saada St – Zahraa El-Maadi', phone='0100-000-0000', widthMm=80, copy='Customer' }={}) {
  const cols = widthMm >= 80 ? 48 : 32;
  const ts = new Date(order.date || Date.now()).toLocaleString();

  let s = '';
  s += INIT;
  s += A.C + BOLD_ON + DOUBLE_ON + `${title}\n` + DOUBLE_OFF + BOLD_OFF;
  s += A.C + `${address}\n${phone}\n`;
  s += dash(cols);
  s += A.L + `Order: #${order.orderNo}\nDate : ${ts}\n`;
  s += `Worker: ${order.worker || ''}\nPayment: ${order.payment || ''}\nType: ${order.orderType || ''}\n`;
  if (order.orderType === 'Delivery' && order.deliveryFee) s += `Delivery Fee: ${Number(order.deliveryFee).toFixed(2)}\n`;
  if (order.note) s += `Note: ${String(order.note).trim()}\n`;
  s += dash(cols);

  // items
  let sub = 0;
  for (const it of (order.cart || [])) {
    const base = Number(it.price || 0);
    sub += base + (it.extras||[]).reduce((a,e)=>a+Number(e.price||0),0);
    s += linePrice(it.name || 'Item', base, cols);
    for (const ex of (it.extras || [])) s += linePrice('  + ' + ex.name, Number(ex.price||0), cols);
  }

  s += dash(cols);
  const itemsTotal = Number(order.itemsTotal ?? sub);
  const delivery = Number(order.deliveryFee || 0);
  const total = Number(order.total ?? (itemsTotal + delivery));

  s += linePrice('Items', itemsTotal, cols);
  if (delivery) s += linePrice('Delivery', delivery, cols);
  s += dash(cols);
  s += BOLD_ON + linePrice('TOTAL', total, cols) + BOLD_OFF;

  s += FEED(2) + A.C + `${copy} copy\n` + FEED(3) + CUT;
  return s;
}

async function printRawEscPos(printerName, raw) {
  const qz = await ensureQz();
  const data = [{ type: 'raw', format: 'plain', data: raw }];
  await qz.print(cfg(printerName), data);
}

// Public: print for Customer/Kitchen
export async function printReceiptDirect(order, { widthMm=80, copy='Customer' }={}) {
  const key = copy === 'Kitchen' ? 'kit' : 'cust';
  let name = getPrinter(key);
  if (!name) {
    const list = await listPrinters();
    if (!list.length) throw new Error('No printers found on this PC');
    // Pick the first for now; add a UI to choose & save below
    name = list[0];
    savePrinter(key, name);
  }
  const raw = buildReceipt(order, { widthMm, copy });
  await printRawEscPos(name, raw);
}

// Optional UI helper to choose & save printers
export async function choosePrintersViaPrompt() {
  await ensureQz();
  const list = await listPrinters();
  if (!list.length) return alert('No printers found. Install driver and retry.');
  const currentCust = getPrinter('cust') || list[0];
  const currentKit = getPrinter('kit') || list[0];
  const cust = prompt(`Customer printer:\n${list.join('\n')}`, currentCust);
  if (cust) savePrinter('cust', cust);
  const kit = prompt(`Kitchen printer:\n${list.join('\n')}`, currentKit);
  if (kit) savePrinter('kit', kit);
  alert(`Saved printers:\nCustomer → ${getPrinter('cust')}\nKitchen  → ${getPrinter('kit')}`);
}
