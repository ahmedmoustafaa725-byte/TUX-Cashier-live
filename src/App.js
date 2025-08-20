import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  serverTimestamp,
  Timestamp,
  collection,
  addDoc,
  updateDoc,
  getDoc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  doc as fsDoc,
} from "firebase/firestore";




// 1) Fill these with your project’s values from the Firebase console
// Import the functions you need from the SDKs you need
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

import { initializeApp, getApps, getApp } from "firebase/app";

// keep your REAL config:
const firebaseConfig = {
  apiKey: "AIzaSyAp1F6t8zgRiJI9xOzFkKJVsCQIT9BWXno",
  authDomain: "tux-cashier-system.firebaseapp.com",
  projectId: "tux-cashier-system",
  storageBucket: "tux-cashier-system.appspot.com", // <-- make sure it's appspot.com
  messagingSenderId: "978379497015",
  appId: "1:978379497015:web:ea165dcb6873e0c65929b2",
};

// reuse existing app if it’s already created
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);




// 2) Name your shop (used for collection/doc paths)
const SHOP_ID = "tux"; // change if you manage multiple shops (e.g. "tux-truck-1")

function ensureFirebase() {
-  if (!getApps().length) initializeApp(FIREBASE_CONFIG);
-  const auth = getAuth();
-  const db = getFirestore();
+  const theApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
+  const auth = getAuth(theApp);
+  const db = getFirestore(theApp);
  return { auth, db };
}



// Pack current state (dates -> ISO) for Firestore
function packStateForCloud(state) {
  const {
    menu,
    extraList,
    orders,
    inventory,
    nextOrderNo,
    dark,
    workers,
    paymentMethods,
    inventoryLocked,
    inventorySnapshot,
    inventoryLockedAt,
    adminPins,
    orderTypes,
    defaultDeliveryFee,
    expenses,
    dayMeta,
    bankTx,
  } = state;

  return {
    version: 1,
    updatedAt: serverTimestamp(),
    menu,
    extras: extraList,
    orders: (orders || []).map((o) => ({
      ...o,
      date: o.date ? o.date.toISOString() : null,
      restockedAt: o.restockedAt ? o.restockedAt.toISOString() : null,
    })),
    inventory,
    nextOrderNo,
    dark,
    workers,
    paymentMethods,
    inventoryLocked,
    inventorySnapshot,
    inventoryLockedAt: inventoryLockedAt ? new Date(inventoryLockedAt).toISOString() : null,
    adminPins,
    orderTypes,
    defaultDeliveryFee,
    expenses: (expenses || []).map((e) => ({
      ...e,
      date: e.date ? e.date.toISOString() : null,
    })),
    dayMeta: dayMeta
      ? {
          ...dayMeta,
          startedAt: dayMeta.startedAt ? dayMeta.startedAt.toISOString() : null,
          endedAt: dayMeta.endedAt ? dayMeta.endedAt.toISOString() : null,
          lastReportAt: dayMeta.lastReportAt ? dayMeta.lastReportAt.toISOString() : null,
          resetAt: dayMeta.resetAt ? dayMeta.resetAt.toISOString() : null,
          shiftChanges: Array.isArray(dayMeta.shiftChanges)
            ? dayMeta.shiftChanges.map((c) => ({
                ...c,
                at: c?.at ? new Date(c.at).toISOString() : null,
              }))
            : [],
        }
      : {},
    bankTx: (bankTx || []).map((t) => ({
      ...t,
      date: t.date ? t.date.toISOString() : null,
    })),
  };
}

// Unpack from Firestore (ISO -> Date)
function unpackStateFromCloud(data, fallbackDayMeta = {}) {
  const out = {};
  if (Array.isArray(data.orders)) {
    out.orders = data.orders.map((o) => ({
      ...o,
      date: o.date ? new Date(o.date) : new Date(),
      restockedAt: o.restockedAt ? new Date(o.restockedAt) : undefined,
    }));
  }
  if (Array.isArray(data.expenses)) {
    out.expenses = data.expenses.map((e) => ({
      ...e,
      date: e.date ? new Date(e.date) : new Date(),
    }));
  }
  if (Array.isArray(data.bankTx)) {
    out.bankTx = data.bankTx.map((t) => ({
      ...t,
      date: t.date ? new Date(t.date) : new Date(),
    }));
  }
  if (data.inventoryLockedAt) out.inventoryLockedAt = new Date(data.inventoryLockedAt);

  if (data.dayMeta) {
    out.dayMeta = {
      startedBy: data.dayMeta.startedBy || "",
      startedAt: data.dayMeta.startedAt ? new Date(data.dayMeta.startedAt) : null,
      endedAt: data.dayMeta.endedAt ? new Date(data.dayMeta.endedAt) : null,
      endedBy: data.dayMeta.endedBy || "",
      lastReportAt: data.dayMeta.lastReportAt ? new Date(data.dayMeta.lastReportAt) : null,
      resetBy: data.dayMeta.resetBy || "",
      resetAt: data.dayMeta.resetAt ? new Date(data.dayMeta.resetAt) : null,
      shiftChanges: Array.isArray(data.dayMeta.shiftChanges)
        ? data.dayMeta.shiftChanges.map((c) => ({ ...c, at: c.at ? new Date(c.at) : null }))
        : [],
    };
  } else {
    out.dayMeta = fallbackDayMeta;
  }

  // easy fields
  if (data.menu) out.menu = data.menu;
  if (data.extras) out.extraList = data.extras;
  if (data.inventory) out.inventory = data.inventory;
  if (typeof data.nextOrderNo === "number") out.nextOrderNo = data.nextOrderNo;
  if (typeof data.dark === "boolean") out.dark = data.dark;
  if (Array.isArray(data.workers)) out.workers = data.workers;
  if (Array.isArray(data.paymentMethods)) out.paymentMethods = data.paymentMethods;
  if (typeof data.inventoryLocked === "boolean") out.inventoryLocked = data.inventoryLocked;
  if (Array.isArray(data.inventorySnapshot)) out.inventorySnapshot = data.inventorySnapshot;
  if (data.adminPins) out.adminPins = data.adminPins;
  if (Array.isArray(data.orderTypes)) out.orderTypes = data.orderTypes;
  if (typeof data.defaultDeliveryFee === "number") out.defaultDeliveryFee = data.defaultDeliveryFee;

  return out;
}

// Normalize a single order for Firestore orders collection
function normalizeOrderForCloud(order) {
  return {
    orderNo: order.orderNo,
    worker: order.worker,
    payment: order.payment,
    orderType: order.orderType,
    deliveryFee: order.deliveryFee,
    total: order.total,
    itemsTotal: order.itemsTotal,
    done: !!order.done,
    voided: !!order.voided,
    note: order.note || "",
    date: order.date ? order.date.toISOString() : new Date().toISOString(),
    restockedAt: order.restockedAt ? order.restockedAt.toISOString() : null,
    cart: order.cart || [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

// Convert Firestore doc to local order shape
function orderFromCloudDoc(id, d) {
  const asDate = (v) =>
    v instanceof Timestamp ? v.toDate() : v ? new Date(v) : new Date();
  return {
    cloudId: id,
    orderNo: d.orderNo,
    worker: d.worker,
    payment: d.payment,
    orderType: d.orderType,
    deliveryFee: Number(d.deliveryFee || 0),
    total: Number(d.total || 0),
    itemsTotal: Number(d.itemsTotal || 0),
    done: !!d.done,
    voided: !!d.voided,
    note: d.note || "",
    date: asDate(d.date || d.createdAt),
    restockedAt: d.restockedAt ? asDate(d.restockedAt) : undefined,
    cart: Array.isArray(d.cart) ? d.cart : [],
  };
}

/* --------------------------- HELPERS --------------------------- */
// Load a file from /public as a Data URL for jsPDF
async function loadAsDataURL(path) {
  const res = await fetch(path);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

/* --------------------------- BASE DATA --------------------------- */
const BASE_MENU = [
  { id: 1, name: "Single Smashed Patty", price: 95, uses: {} },
  { id: 2, name: "Double Smashed Patty", price: 140, uses: {} },
  { id: 3, name: "Triple Smashed Patty", price: 160, uses: {} },
  { id: 4, name: "Tux Quatro Smashed Patty", price: 190, uses: {} },
  { id: 14, name: "TUXIFY Single", price: 120, uses: {} },
  { id: 15, name: "TUXIFY Double", price: 160, uses: {} },
  { id: 16, name: "TUXIFY Triple", price: 200, uses: {} },
  { id: 17, name: "TUXIFY Quatro", price: 240, uses: {} },
  { id: 5, name: "Classic Fries", price: 25, uses: {} },
  { id: 6, name: "Cheese Fries", price: 40, uses: {} },
  { id: 7, name: "Chili Fries", price: 50, uses: {} },
  { id: 8, name: "Tux Fries", price: 75, uses: {} },
  { id: 9, name: "Doppy Fries", price: 95, uses: {} },
  { id: 10, name: "Classic Hawawshi", price: 80, uses: {} },
  { id: 11, name: "Tux Hawawshi", price: 100, uses: {} },
  { id: 12, name: "Soda", price: 20, uses: {} },
  { id: 13, name: "Water", price: 10, uses: {} },
];
const BASE_EXTRAS = [
  { id: 101, name: "Extra Smashed Patty", price: 40, uses: {} },
  { id: 102, name: "Bacon", price: 20, uses: {} },
  { id: 103, name: "Cheese", price: 15, uses: {} },
  { id: 104, name: "Ranch", price: 15, uses: {} },
  { id: 105, name: "Mushroom", price: 15, uses: {} },
  { id: 106, name: "Caramelized Onion", price: 10, uses: {} },
  { id: 107, name: "Jalapeno", price: 10, uses: {} },
  { id: 108, name: "Tux Sauce", price: 10, uses: {} },
  { id: 109, name: "Extra Bun", price: 10, uses: {} },
  { id: 110, name: "Pickle", price: 5, uses: {} },
  { id: 111, name: "BBQ / Ketchup / Sweet Chili / Hot Sauce", price: 5, uses: {} },
  { id: 112, name: "Mozzarella Cheese", price: 20, uses: {} },
  { id: 113, name: "Tux Hawawshi Sauce", price: 10, uses: {} },
];
// Default inventory items
const DEFAULT_INVENTORY = [
  { id: "meat", name: "Meat", unit: "g", qty: 0 },
  { id: "cheese", name: "Cheese", unit: "slices", qty: 0 },
];
// Initial workers & payments (editable in UI)
const BASE_WORKERS = ["Hassan", "Warda", "Ahmed"];
const DEFAULT_PAYMENT_METHODS = ["Cash", "Card", "Instapay"];
// Dine options (editable in Prices)
const DEFAULT_ORDER_TYPES = ["Take-Away", "Dine-in", "Delivery"];
const DEFAULT_DELIVERY_FEE = 20;
// ---- Editor PIN to protect PRICES tab
const EDITOR_PIN = "0512";


// ---------- PIN defaults + helpers ----------
const DEFAULT_ADMIN_PINS = { 1: "1111", 2: "2222", 3: "3333", 4: "4444", 5: "5555", 6: "6666" };
const norm = (v) => String(v ?? "").trim();

export default function App() {
  const [activeTab, setActiveTab] = useState("orders");
  const [dark, setDark] = useState(false);

  const [menu, setMenu] = useState(BASE_MENU);
  const [extraList, setExtraList] = useState(BASE_EXTRAS);

  const [workers, setWorkers] = useState(BASE_WORKERS);
  const [newWorker, setNewWorker] = useState("");
  const [paymentMethods, setPaymentMethods] = useState(DEFAULT_PAYMENT_METHODS);
  const [newPayment, setNewPayment] = useState("");

  // Order Type options & default delivery fee (Editable in Prices)
  const [orderTypes, setOrderTypes] = useState(DEFAULT_ORDER_TYPES);
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState(DEFAULT_DELIVERY_FEE);

  // Order builder
  const [selectedBurger, setSelectedBurger] = useState(null);
  const [selectedExtras, setSelectedExtras] = useState([]);
  const [cart, setCart] = useState([]);
  const [worker, setWorker] = useState("");
  const [payment, setPayment] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [orderType, setOrderType] = useState(orderTypes[0] || "Take-Away");
  const [deliveryFee, setDeliveryFee] = useState(0);

  // Dynamic inventory
  const [inventory, setInventory] = useState(DEFAULT_INVENTORY);
  const [newInvName, setNewInvName] = useState("");
  const [newInvUnit, setNewInvUnit] = useState("");
  const [newInvQty, setNewInvQty] = useState(0);

  // Inventory lock & snapshot
  const [inventoryLocked, setInventoryLocked] = useState(false);
  const [inventorySnapshot, setInventorySnapshot] = useState([]);
  const [inventoryLockedAt, setInventoryLockedAt] = useState(null);

  // Admin PINs
  const [adminPins, setAdminPins] = useState({ ...DEFAULT_ADMIN_PINS });

  // Prices tab session unlock
  const [pricesUnlocked, setPricesUnlocked] = useState(false);

  // Which admin rows are unlocked for editing (1..6)
  const [adminPinsEditUnlocked, setAdminPinsEditUnlocked] = useState({
    1: false, 2: false, 3: false, 4: false, 5: false, 6: false,
  });

  // Orders
  const [orders, setOrders] = useState([]);
  const [nextOrderNo, setNextOrderNo] = useState(1);

  // Expenses
  const [expenses, setExpenses] = useState([]);
  const [newExpName, setNewExpName] = useState("");
  const [newExpUnit, setNewExpUnit] = useState("pcs");
  const [newExpQty, setNewExpQty] = useState(1);
  const [newExpUnitPrice, setNewExpUnitPrice] = useState(0);
  const [newExpNote, setNewExpNote] = useState("");

  // Bank (admin pin protected)
  const [bankUnlocked, setBankUnlocked] = useState(false);
  const [bankTx, setBankTx] = useState([]);
  const [bankForm, setBankForm] = useState({ type: "deposit", amount: 0, worker: "", note: "" });

  // Shift/day meta
  const [dayMeta, setDayMeta] = useState({
    startedBy: "",
    startedAt: null,
    endedAt: null,
    endedBy: "",
    lastReportAt: null,
    resetBy: "",
    resetAt: null,
    shiftChanges: [],
  });

  // Reports sorting
  const [sortBy, setSortBy] = useState("date-desc");

  // Live clock
  const [nowStr, setNowStr] = useState(new Date().toLocaleString());
  useEffect(() => {
    const t = setInterval(() => setNowStr(new Date().toLocaleString()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------- Prices tab local editors ----------
  const [usesEditOpenMenu, setUsesEditOpenMenu] = useState({});
  const [usesEditOpenExtra, setUsesEditOpenExtra] = useState({});
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState(0);
  const [newExtraName, setNewExtraName] = useState("");
  const [newExtraPrice, setNewExtraPrice] = useState(0);

  /* --------------------------- FIREBASE STATE --------------------------- */
  const [fbReady, setFbReady] = useState(false);
  const [fbUser, setFbUser] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(true); // autosave to state doc
  const [realtimeOrders, setRealtimeOrders] = useState(false); // live board via orders collection
  const [cloudStatus, setCloudStatus] = useState({ lastSaveAt: null, lastLoadAt: null, error: null });

  // Init + Anonymous Auth
  useEffect(() => {
    try {
      const { auth } = ensureFirebase();
      setFbReady(true);
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          try {
            await signInAnonymously(auth);
          } catch (e) {
            setCloudStatus((s) => ({ ...s, error: String(e) }));
          }
        } else {
          setFbUser(u);
        }
      });
      return () => unsub();
    } catch (e) {
      setCloudStatus((s) => ({ ...s, error: String(e) }));
    }
  }, []);

  // Firestore refs
  const db = useMemo(() => (fbReady ? ensureFirebase().db : null), [fbReady]);
  const stateDocRef = useMemo(
    () => (db ? fsDoc(db, "shops", SHOP_ID, "state", "pos") : null),
    [db]
  );
  const ordersColRef = useMemo(
    () => (db ? collection(db, "shops", SHOP_ID, "orders") : null),
    [db]
  );

  // Manual cloud load (pull)
  const loadFromCloud = async () => {
    if (!stateDocRef || !fbUser) return alert("Firebase not ready.");
    try {
      const snap = await getDoc(stateDocRef);
      if (!snap.exists()) return alert("No cloud state yet to load.");
      const data = snap.data() || {};
      const unpacked = unpackStateFromCloud(data, dayMeta);
      if (unpacked.menu) setMenu(unpacked.menu);
      if (unpacked.extraList) setExtraList(unpacked.extraList);
      if (unpacked.orders) setOrders(unpacked.orders);
      if (unpacked.inventory) setInventory(unpacked.inventory);
      if (unpacked.nextOrderNo != null) setNextOrderNo(unpacked.nextOrderNo);
      if (unpacked.dark != null) setDark(unpacked.dark);
      if (unpacked.workers) setWorkers(unpacked.workers);
      if (unpacked.paymentMethods) setPaymentMethods(unpacked.paymentMethods);
      if (unpacked.inventoryLocked != null) setInventoryLocked(unpacked.inventoryLocked);
      if (unpacked.inventorySnapshot) setInventorySnapshot(unpacked.inventorySnapshot);
      if (unpacked.inventoryLockedAt != null) setInventoryLockedAt(unpacked.inventoryLockedAt);
      if (unpacked.adminPins) setAdminPins({ ...DEFAULT_ADMIN_PINS, ...unpacked.adminPins });
      if (unpacked.orderTypes) setOrderTypes(unpacked.orderTypes);
      if (unpacked.defaultDeliveryFee != null) setDefaultDeliveryFee(unpacked.defaultDeliveryFee);
      if (unpacked.expenses) setExpenses(unpacked.expenses);
      if (unpacked.dayMeta) setDayMeta(unpacked.dayMeta);
      if (unpacked.bankTx) setBankTx(unpacked.bankTx);

      setCloudStatus((s) => ({ ...s, lastLoadAt: new Date(), error: null }));
      alert("Loaded from cloud ✔");
    } catch (e) {
      setCloudStatus((s) => ({ ...s, error: String(e) }));
      alert("Cloud load failed: " + e);
    }
  };

  // Autosave to cloud (state doc) — debounced
  useEffect(() => {
    if (!cloudEnabled || !stateDocRef || !fbUser) return;
    const t = setTimeout(async () => {
      try {
        const body = packStateForCloud({
          menu,
          extraList,
          orders,
          inventory,
          nextOrderNo,
          dark,
          workers,
          paymentMethods,
          inventoryLocked,
          inventorySnapshot,
          inventoryLockedAt,
          adminPins,
          orderTypes,
          defaultDeliveryFee,
          expenses,
          dayMeta,
          bankTx,
        });
        await setDoc(stateDocRef, body, { merge: true });
        setCloudStatus((s) => ({ ...s, lastSaveAt: new Date(), error: null }));
      } catch (e) {
        setCloudStatus((s) => ({ ...s, error: String(e) }));
      }
    }, 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cloudEnabled,
    stateDocRef,
    fbUser,
    menu,
    extraList,
    orders,
    inventory,
    nextOrderNo,
    dark,
    workers,
    paymentMethods,
    inventoryLocked,
    inventorySnapshot,
    inventoryLockedAt,
    adminPins,
    orderTypes,
    defaultDeliveryFee,
    expenses,
    dayMeta,
    bankTx,
  ]);

  // Optional: realtime orders stream
  useEffect(() => {
    if (!realtimeOrders || !ordersColRef || !fbUser) return;
    const qy = query(ordersColRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(qy, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push(orderFromCloudDoc(d.id, d.data())));
      // Replace local orders with cloud stream (you can merge if you prefer)
      setOrders(arr);
    });
    return () => unsub();
  }, [realtimeOrders, ordersColRef, fbUser]);

  /* --------------------------- EXISTING APP LOGIC --------------------------- */
  const toggleExtra = (extra) => {
    setSelectedExtras((prev) =>
      prev.find((e) => e.id === extra.id)
        ? prev.filter((e) => e.id !== extra.id)
        : [...prev, extra]
    );
  };

  const invById = useMemo(() => {
    const map = {};
    for (const item of inventory) map[item.id] = item;
    return map;
  }, [inventory]);

  // --------- Shift Controls ----------
  const startShift = () => {
    if (dayMeta.startedAt && !dayMeta.endedAt) return alert("Shift already started.");
    const nameInput = worker || window.prompt("Enter worker name to START shift (or select in Orders tab then return):", "");
    const name = norm(nameInput);
    if (!name) return alert("Worker name required.");
    setDayMeta({
      startedBy: name,
      startedAt: new Date(),
      endedAt: null,
      endedBy: "",
      lastReportAt: null,
      resetBy: "",
      resetAt: null,
      shiftChanges: [],
    });
    if (!inventoryLocked && inventory.length) {
      if (window.confirm("Lock current Inventory as Start-of-Day snapshot?")) lockInventoryForDay();
    }
  };

  // RENAMED: End Shift -> Change Shift
  const changeShift = () => {
    if (!dayMeta.startedAt || dayMeta.endedAt) return alert("Start a shift first.");
    const current = window.prompt(`Enter the CURRENT worker name to confirm:`, "");
    if (norm(current) !== norm(dayMeta.startedBy)) {
      return alert(`Only ${dayMeta.startedBy} can hand over the shift.`);
    }
    const next = window.prompt(`Enter the NEW worker name to take over:`, "");
    const newName = norm(next);
    if (!newName) return alert("New worker name required.");
    if (norm(newName) === norm(dayMeta.startedBy)) return alert("New worker must be different from current worker.");
    setDayMeta((d) => ({
      ...d,
      startedBy: newName,
      shiftChanges: [...(d.shiftChanges || []), { at: new Date(), from: d.startedBy, to: newName }],
    }));
    alert(`Shift changed: ${dayMeta.startedBy} → ${newName}`);
  };

  // NEW: End the Day (replaces Reset Day)
  const endDay = () => {
    if (!dayMeta.startedAt) return alert("Start a shift first.");
    const who = window.prompt("Enter your name to END THE DAY:", "");
    const endBy = norm(who);
    if (!endBy) return alert("Name is required.");

    // Mark end time now for the final PDF
    const endTime = new Date();
    const metaForReport = { ...dayMeta, endedAt: endTime, endedBy: endBy };

    // Download PDF first
    generatePDF(false, metaForReport);

    // Calculate margin (revenue excl. delivery - expenses)
    const validOrders = orders.filter((o) => !o.voided);
    const revenueExclDelivery = validOrders.reduce(
      (s, o) => s + Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0))),
      0
    );
    const expensesTotal = expenses.reduce((s, e) => s + Number((e.qty || 0) * (e.unitPrice || 0)), 0);
    const margin = revenueExclDelivery - expensesTotal;

    // Auto add to Bank as next day's initial balance
    const txs = [];
    if (margin > 0) {
      txs.push({
        id: `tx_${Date.now()}`,
        type: "init",
        amount: margin,
        worker: endBy,
        note: "Auto Init from day margin",
        date: new Date(),
      });
    } else if (margin < 0) {
      txs.push({
        id: `tx_${Date.now() + 1}`,
        type: "adjustDown",
        amount: Math.abs(margin),
        worker: endBy,
        note: "Auto Adjust Down (negative margin)",
        date: new Date(),
      });
    }
    if (txs.length) setBankTx((arr) => [...txs, ...arr]);

    // Reset day locally
    setOrders([]);
    setNextOrderNo(1);
    setInventoryLocked(false);
    setInventoryLockedAt(null);

    setDayMeta({
      startedBy: "",
      startedAt: null,
      endedAt: null,
      endedBy: "",
      lastReportAt: null,
      resetBy: "",
      resetAt: null,
      shiftChanges: [],
    });

    alert(`Day ended by ${endBy}. Report downloaded and day reset ✅`);
  };

  // --------- Inventory Locking / Unlock with PIN ----------
  const lockInventoryForDay = () => {
    if (inventoryLocked) return;
    if (inventory.length === 0) return alert("Add at least one inventory item first.");
    if (!window.confirm("Lock current inventory as Start-of-Day? You won't be able to edit until End the Day or admin unlock.")) return;

    const snap = inventory.map((it) => ({
      id: it.id,
      name: it.name,
      unit: it.unit,
      qtyAtLock: it.qty,
    }));
    setInventorySnapshot(snap);
    setInventoryLocked(true);
    setInventoryLockedAt(new Date());
  };

  const promptAdminAndPin = () => {
    const adminStr = window.prompt("Enter Admin number (1 to 6):", "1");
    if (!adminStr) return null;
    const n = Number(adminStr);
    if (![1, 2, 3, 4, 5, 6].includes(n)) {
      alert("Please enter a number from 1 to 6.");
      return null;
    }
    const entered = window.prompt(`Enter PIN for Admin ${n}:`, "");
    if (entered == null) return null;

    const expected = norm(adminPins[n]);
    const attempt = norm(entered);

    if (!expected) {
      alert(`Admin ${n} has no PIN set; set a PIN in Prices → Admin PINs.`);
      return null;
    }
    if (attempt !== expected) {
      alert("Invalid PIN.");
      return null;
    }
    return n;
  };

  const unlockInventoryWithPin = () => {
    if (!inventoryLocked) return alert("Inventory is already unlocked.");
    const adminNum = promptAdminAndPin();
    if (!adminNum) return;
    if (!window.confirm(`Admin ${adminNum}: Unlock inventory for editing? Snapshot will be kept.`)) return;
    setInventoryLocked(false);
    alert("Inventory unlocked for editing.");
  };

  // --------- Cart / Checkout ----------
  const addToCart = () => {
    if (!selectedBurger) return alert("Select a burger/item first.");

    const uses = {};
    const prodUses = selectedBurger.uses || {};
    for (const k of Object.keys(prodUses)) uses[k] = (uses[k] || 0) + (prodUses[k] || 0);
    for (const ex of selectedExtras) {
      const exUses = ex.uses || {};
      for (const k of Object.keys(exUses)) uses[k] = (uses[k] || 0) + (exUses[k] || 0);
    }

    const line = {
      ...selectedBurger,
      extras: [...selectedExtras],
      price: selectedBurger.price,
      uses,
    };

    setCart((c) => [...c, line]);
    setSelectedBurger(null);
    setSelectedExtras([]);
  };

  const removeFromCart = (i) => setCart((c) => c.filter((_, idx) => idx !== i));

  const checkout = async () => {
    if (!dayMeta.startedAt || dayMeta.endedAt) {
      return alert("Start a shift first (Shift → Start Shift).");
    }
    if (cart.length === 0) return alert("Cart is empty.");
    if (!worker) return alert("Select worker.");
    if (!payment) return alert("Select payment.");
    if (!orderType) return alert("Select order type.");

    // Sum required inventory across all cart lines
    const required = {};
    for (const line of cart) {
      const uses = line.uses || {};
      for (const k of Object.keys(uses)) {
        required[k] = (required[k] || 0) + (uses[k] || 0);
      }
    }
    // Check stock
    for (const k of Object.keys(required)) {
      const invItem = invById[k];
      if (!invItem) continue;
      if ((invItem.qty || 0) < required[k]) {
        return alert(`Not enough ${invItem.name} in stock. Need ${required[k]} ${invItem.unit}, have ${invItem.qty} ${invItem.unit}.`);
      }
    }
    // Deduct inventory
    setInventory((inv) =>
      inv.map((it) => {
        const need = required[it.id] || 0;
        return need ? { ...it, qty: it.qty - need } : it;
      })
    );

    // Totals
    const baseSubtotal = cart.reduce((s, b) => s + Number(b.price || 0), 0);
    const extrasSubtotal = cart.reduce(
      (s, b) => s + (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0),
      0
    );
    const itemsTotal = baseSubtotal + extrasSubtotal;
    const delFee = orderType === "Delivery" ? Math.max(0, Number(deliveryFee || 0)) : 0;
    const total = itemsTotal + delFee;

    const order = {
      orderNo: nextOrderNo,
      date: new Date(),
      worker,
      payment,
      orderType,
      deliveryFee: delFee,
      total,
      itemsTotal,
      cart,
      done: false,
      voided: false,
      restockedAt: undefined,
      note: orderNote.trim(),
    };

    setOrders((o) => [order, ...o]);
    setNextOrderNo((n) => n + 1);

    // Cloud write (orders collection)
    if (cloudEnabled && ordersColRef && fbUser) {
      try {
        const ref = await addDoc(ordersColRef, normalizeOrderForCloud(order));
        // attach cloudId to local order
        setOrders((prev) =>
          prev.map((oo) => (oo.orderNo === order.orderNo ? { ...oo, cloudId: ref.id } : oo))
        );
      } catch (e) {
        console.warn("Cloud order write failed:", e);
      }
    }

    // Print customer receipt (58 mm)
    printThermalTicket(order, 58, "Customer");

    // reset builder
    setCart([]);
    setWorker("");
    setPayment("");
    setOrderNote("");
    setOrderType(orderTypes[0] || "Take-Away");
    setDeliveryFee(orderType === "Delivery" ? defaultDeliveryFee : 0);
  };

  // --------- Order actions ----------
  const markOrderDone = async (orderNo) => {
    setOrders((o) =>
      o.map((ord) => {
        if (ord.orderNo !== orderNo) return ord;
        if (ord.done) return ord;
        return { ...ord, done: true };
      })
    );

    // Cloud update
    try {
      if (!cloudEnabled || !ordersColRef || !fbUser) return;
      let targetId = orders.find((o) => o.orderNo === orderNo)?.cloudId;
      if (!targetId) {
        // best-effort find by orderNo
        const qy = query(ordersColRef, where("orderNo", "==", orderNo));
        const ss = await getDocs(qy);
        if (!ss.empty) targetId = ss.docs[0].id;
      }
      if (targetId) {
        await updateDoc(fsDoc(db, "shops", SHOP_ID, "orders", targetId), {
          done: true,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn("Cloud update (done) failed:", e);
    }
  };

  const voidOrderAndRestock = async (orderNo) => {
    const ord = orders.find((o) => o.orderNo === orderNo);
    if (!ord) return;
    if (ord.done) return alert("This order is DONE and cannot be voided.");
    if (ord.voided) return alert("This order is already voided & restocked.");
    if (!window.confirm(`Void order #${orderNo} and restock inventory?`)) return;

    const giveBack = {};
    for (const line of ord.cart) {
      const uses = line.uses || {};
      for (const k of Object.keys(uses)) {
        giveBack[k] = (giveBack[k] || 0) + (uses[k] || 0);
      }
    }
    setInventory((inv) =>
      inv.map((it) => {
        const back = giveBack[it.id] || 0;
        return back ? { ...it, qty: it.qty + back } : it;
      })
    );
    setOrders((o) =>
      o.map((x) => (x.orderNo === orderNo ? { ...x, voided: true, restockedAt: new Date() } : x))
    );

    // Cloud update
    try {
      if (!cloudEnabled || !ordersColRef || !fbUser) return;
      let targetId = ord.cloudId;
      if (!targetId) {
        const qy = query(ordersColRef, where("orderNo", "==", orderNo));
        const ss = await getDocs(qy);
        if (!ss.empty) targetId = ss.docs[0].id;
      }
      if (targetId) {
        await updateDoc(fsDoc(db, "shops", SHOP_ID, "orders", targetId), {
          voided: true,
          restockedAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn("Cloud update (void) failed:", e);
    }
  };

  // --------------------------- REPORT TOTALS ---------------------------
  const getSortedOrders = () => {
    const arr = [...orders];
    if (sortBy === "date-desc") arr.sort((a, b) => b.date - a.date);
    if (sortBy === "date-asc") arr.sort((a, b) => a.date - b.date);
    if (sortBy === "worker") arr.sort((a, b) => a.worker.localeCompare(b.worker));
    if (sortBy === "payment") arr.sort((a, b) => a.payment.localeCompare(b.payment));
    return arr;
  };

  const totals = useMemo(() => {
    const validOrders = orders.filter((o) => !o.voided);
    const revenueTotal = validOrders.reduce(
      (s, o) => s + Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0))),
      0
    );
    const byPay = {};
    for (const p of paymentMethods) byPay[p] = 0;
    for (const o of validOrders) {
      const itemsOnly = Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0)));
      if (byPay[o.payment] == null) byPay[o.payment] = 0;
      byPay[o.payment] += itemsOnly;
    }
    const byType = {};
    for (const t of orderTypes) byType[t] = 0;
    for (const o of validOrders) {
      const itemsOnly = Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0)));
      if (byType[o.orderType] == null) byType[o.orderType] = 0;
      byType[o.orderType] += itemsOnly;
    }
    const deliveryFeesTotal = validOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const expensesTotal = expenses.reduce((s, e) => s + Number((e.qty || 0) * (e.unitPrice || 0)), 0);
    const margin = revenueTotal - expensesTotal;
    return { revenueTotal, byPay, byType, deliveryFeesTotal, expensesTotal, margin };
  }, [orders, paymentMethods, orderTypes, expenses]);

  const salesStats = useMemo(() => {
    const itemMap = new Map();
    const extraMap = new Map();
    const add = (map, id, name, count, revenue) => {
      const prev = map.get(id) || { id, name, count: 0, revenue: 0 };
      prev.count += count;
      prev.revenue += revenue;
      map.set(id, prev);
    };
    for (const o of orders) {
      if (o.voided) continue;
      for (const line of o.cart || []) {
        const base = Number(line.price || 0);
        add(itemMap, line.id, line.name, 1, base);
        for (const ex of line.extras || []) {
          add(extraMap, ex.id, ex.name, 1, Number(ex.price || 0));
        }
      }
    }
    const items = Array.from(itemMap.values()).sort((a, b) => b.count - a.count || b.revenue - a.revenue);
    const extras = Array.from(extraMap.values()).sort((a, b) => b.count - a.count || b.revenue - a.revenue);
    return { items, extras };
  }, [orders]);

  const inventoryReportRows = useMemo(() => {
    if (!inventorySnapshot || inventorySnapshot.length === 0) return [];
    const snapMap = {};
    for (const s of inventorySnapshot) snapMap[s.id] = s;
    return inventory.map((it) => {
      const s = snapMap[it.id];
      const start = s ? s.qtyAtLock : 0;
      const now = it.qty;
      const used = Math.max(0, start - now);
      return { name: it.name, unit: it.unit, start, now, used };
    });
  }, [inventory, inventorySnapshot]);

  // --------------------------- PDF: REPORT ---------------------------
  const generatePDF = (silent = false, metaOverride = null) => {
    try {
      const m = metaOverride || dayMeta;
      const doc = new jsPDF();
      doc.text("TUX — Shift Report", 14, 12);

      const startedStr = m.startedAt ? new Date(m.startedAt).toLocaleString() : "—";
      const endedStr = m.endedAt ? new Date(m.endedAt).toLocaleString() : "—";

      autoTable(doc, {
        head: [["Start By", "Start At", "End At"]],
        body: [[m.startedBy || "—", startedStr, endedStr]],
        startY: 18,
        theme: "grid",
      });

      let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 28;
      doc.text("Shift Timeline", 14, y);
      const timelineRows = [];
      timelineRows.push(["Started", startedStr, m.startedBy || "—"]);
      (m.shiftChanges || []).forEach((c, i) => {
        const when = c?.at ? new Date(c.at).toLocaleString() : "—";
        timelineRows.push([`Changed #${i + 1}`, when, `${c.from || "?"} → ${c.to || "?"}`]);
      });
      timelineRows.push(["Day Ended", endedStr, m.endedBy || "—"]);
      autoTable(doc, {
        head: [["Event", "When", "Actor(s)"]],
        body: timelineRows,
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 10 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 28;
      doc.text("Orders", 14, y);
      autoTable(doc, {
        head: [["#", "Date", "Worker", "Payment", "Type", "Delivery (E£)", "Total (E£)", "Done", "Voided"]],
        body: getSortedOrders().map((o) => [
          o.orderNo,
          o.date.toLocaleString(),
          o.worker,
          o.payment,
          o.orderType || "",
          (o.deliveryFee || 0).toFixed(2),
          o.total.toFixed(2),
          o.done ? "Yes" : "No",
          o.voided ? "Yes" : "No",
        ]),
        startY: y + 4,
        styles: { fontSize: 9 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Totals (excluding voided)", 14, y);

      const totalsBody = [
        ["Revenue (Shift, excl. delivery)", totals.revenueTotal.toFixed(2)],
        ["Delivery Fees (not in revenue)", totals.deliveryFeesTotal.toFixed(2)],
        ["Expenses (Shift)", totals.expensesTotal.toFixed(2)],
        ["Margin (Revenue - Expenses)", totals.margin.toFixed(2)],
      ];
      for (const p of Object.keys(totals.byPay)) {
        totalsBody.push([`By Payment — ${p} (items only)`, (totals.byPay[p] || 0).toFixed(2)]);
      }
      for (const t of Object.keys(totals.byType)) {
        totalsBody.push([`By Order Type — ${t} (items only)`, (totals.byType[t] || 0).toFixed(2)]);
      }

      autoTable(doc, {
        head: [["Metric", "Amount (E£)"]],
        body: totalsBody,
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 10 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Items — Times Ordered", 14, y);
      autoTable(doc, {
        head: [["Item", "Times", "Revenue (E£)"]],
        body: salesStats.items.map((r) => [r.name, String(r.count), r.revenue.toFixed(2)]),
        startY: y + 4,
        theme: "grid",
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Extras — Times Ordered", 14, y);
      autoTable(doc, {
        head: [["Extra", "Times", "Revenue (E£)"]],
        body: salesStats.extras.map((r) => [r.name, String(r.count), r.revenue.toFixed(2)]),
        startY: y + 4,
        theme: "grid",
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Inventory — Start vs Now", 14, y);

      if (!inventoryReportRows.length) {
        autoTable(doc, {
          head: [["Info"]],
          body: [["No inventory snapshot yet. Lock inventory to capture start-of-day."]],
          startY: y + 4,
          theme: "grid",
        });
      } else {
        autoTable(doc, {
          head: [["Item", "Unit", "Start Qty", "Current Qty", "Used"]],
          body: inventoryReportRows.map((r) => [r.name, r.unit, String(r.start), String(r.now), String(r.used)]),
          startY: y + 4,
          theme: "grid",
        });
      }

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Expenses (Shift)", 14, y);
      autoTable(doc, {
        head: [["Name", "Unit", "Qty", "Unit Price (E£)", "Total (E£)", "Date", "Note"]],
        body: expenses.map((e) => [
          e.name,
          e.unit,
          String(e.qty),
          Number(e.unitPrice || 0).toFixed(2),
          (Number(e.qty || 0) * Number(e.unitPrice || 0)).toFixed(2),
          e.date ? new Date(e.date).toLocaleString() : "",
          e.note || "",
        ]),
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 9 },
      });

      setDayMeta((d) => ({ ...d, lastReportAt: new Date() }));
      doc.save("tux_shift_report.pdf");
      if (!silent) alert("PDF downloaded.");
    } catch (err) {
      console.error(err);
      alert("Could not generate PDF. Try again (ensure pop-ups are allowed).");
    }
  };

  // --------------------------- PDF: THERMAL TICKETS ---------------------------
  const printThermalTicket = async (order, widthMm = 58, copy = "Customer") => {
    try {
      if (order.voided) return alert("This order is voided; no tickets can be printed.");
      if (order.done && copy === "Kitchen") return alert("Order is done; kitchen ticket not available.");

      const MAX_H = 1000;
      const doc = new jsPDF({ unit: "mm", format: [widthMm, MAX_H], compress: true });

      doc.setTextColor(0, 0, 0);
      doc.setDrawColor(0, 0, 0);

      const margin = 4;
      const colRight = widthMm - margin;
      let y = margin;

      const safe = (s) => String(s ?? "").replace(/[\u2013\u2014]/g, "-");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.text(safe("TUX - Burger Truck"), margin, y); y += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`${safe(copy)} Copy`, margin, y); y += 5;

      doc.text(`Order #${order.orderNo}`, margin, y); y += 4;
      doc.text(new Date(order.date).toLocaleString(), margin, y); y += 5;

      doc.text(`Worker: ${safe(order.worker)}`, margin, y); y += 4;
      doc.text(`Payment: ${safe(order.payment)} | Type: ${safe(order.orderType)}`, margin, y); y += 5;

      if (order.orderType === "Delivery") {
        doc.text(`Delivery Fee: E£${(order.deliveryFee || 0).toFixed(2)}`, margin, y);
        y += 5;
      }

      if (order.note) {
        doc.setFont("helvetica", "normal"); doc.text("NOTE:", margin, y);
        doc.setFont("helvetica", "normal"); y += 5;
        const wrapped = doc.splitTextToSize(safe(order.note), widthMm - margin * 2);
        wrapped.forEach(line => { doc.text(line, margin, y); y += 4; });
        y += 2;
      }

      doc.setFont("helvetica", "normal"); doc.text("Items", margin, y); y += 5;
      doc.setFont("helvetica", "normal");

      order.cart.forEach((ci) => {
        const nameWrapped = doc.splitTextToSize(safe(ci.name), widthMm - margin * 2);
        nameWrapped.forEach((w, i) => {
          doc.text(w, margin, y);
          if (i === 0) doc.text(`E£${Number(ci.price || 0).toFixed(2)}`, colRight, y, { align: "right" });
          y += 4;
        });
        (ci.extras || []).forEach((ex) => {
          const exWrapped = doc.splitTextToSize(`+ ${safe(ex.name)}`, widthMm - margin * 2 - 2);
          exWrapped.forEach((w, i) => {
            doc.text(w, margin + 2, y);
            if (i === 0) doc.text(`E£${Number(ex.price || 0).toFixed(2)}`, colRight, y, { align: "right" });
            y += 4;
          });
        });
        y += 1;
      });

      doc.line(margin, y, widthMm - margin, y); y += 3;
      doc.setFont("helvetica", "normal");
      doc.text("TOTAL", margin, y);
      doc.text(`E£${Number(order.total || 0).toFixed(2)}`, widthMm - margin, y, { align: "right" });
      y += 6;

      doc.setFontSize(8);
      if (order.voided) doc.text("VOIDED / RESTOCKED", margin, y);
      else if (order.done) doc.text("DONE", margin, y);
      else doc.text("Thank you! @TUX", margin, y);
      y += 4;

      if (copy === "Customer") {
        try {
          const imgData = await loadAsDataURL("/tux-receipt.jpg");
          const im = await new Promise((resolve, reject) => {
            const _im = new Image();
            _im.onload = () => resolve(_im);
            _im.onerror = reject;
            _im.src = imgData;
          });
          const targetW = Math.min(38, widthMm - margin * 2);
          const targetH = targetW * (im.height / im.width || 1);
          doc.addImage(imgData, "JPEG", (widthMm - targetW) / 2, y, targetW, targetH);
          y += targetH + 2;
        } catch {}
      }

      doc.save(`tux_${copy.toLowerCase()}_${widthMm}mm_order_${order.orderNo}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Could not print ticket. Try again (ensure pop-ups/downloads are allowed).");
    }
  };

  const cardBorder = dark ? "#555" : "#ddd";
  const softBg = dark ? "#1e1e1e" : "#f5f5f5";
  const btnBorder = "#ccc";
  const containerStyle = {
    maxWidth: 1024,
    margin: "0 auto",
    padding: 16,
    background: dark ? "#121212" : "white",
    color: dark ? "#eee" : "black",
    minHeight: "100vh",
    transition: "background 0.2s ease, color 0.2s ease",
  };

  // Intercept clicking protected tabs
  const handleTabClick = (key) => {
    if (key === "prices" && !pricesUnlocked) {
      const entered = window.prompt("Enter Editor PIN to open Prices:", "");
      if (entered == null) return;
      if (norm(entered) !== norm(EDITOR_PIN)) {
        alert("Wrong PIN.");
        return;
      }
      setPricesUnlocked(true);
    }
    if (key === "bank" && !bankUnlocked) {
      const ok = !!promptAdminAndPin();
      if (!ok) return;
      setBankUnlocked(true);
    }
    setActiveTab(key);
  };

  // Bank balance
  const bankBalance = useMemo(() => {
    return bankTx.reduce((sum, t) => {
      const a = Number(t.amount || 0);
      if (t.type === "deposit" || t.type === "init" || t.type === "adjustUp") return sum + a;
      if (t.type === "withdraw" || t.type === "adjustDown") return sum - a;
      return sum;
    }, 0);
  }, [bankTx]);

  /* --------------------------- UI --------------------------- */
 const firebaseConfigured = !!(firebaseConfig && firebaseConfig.apiKey);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>🍔 TUX — Burger Truck POS</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <small>{nowStr}</small>

          {/* Cloud controls */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#222" : "#f3f3f3" }}>
            <span>☁</span>
            {!firebaseConfigured && <small style={{ color: "#c62828" }}>Setup Firebase config</small>}
            {firebaseConfigured && (
              <>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={cloudEnabled}
                    onChange={(e) => setCloudEnabled(e.target.checked)}
                  />
                  <small>Autosync</small>
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={realtimeOrders}
                    onChange={(e) => setRealtimeOrders(e.target.checked)}
                  />
                  <small>Realtime Orders</small>
                </label>
                <button
                  onClick={async () => {
                    try {
                      if (!stateDocRef || !fbUser) return;
                      const body = packStateForCloud({
                        menu,
                        extraList,
                        orders,
                        inventory,
                        nextOrderNo,
                        dark,
                        workers,
                        paymentMethods,
                        inventoryLocked,
                        inventorySnapshot,
                        inventoryLockedAt,
                        adminPins,
                        orderTypes,
                        defaultDeliveryFee,
                        expenses,
                        dayMeta,
                        bankTx,
                      });
                      await setDoc(stateDocRef, body, { merge: true });
                      setCloudStatus((s) => ({ ...s, lastSaveAt: new Date(), error: null }));
                      alert("Synced to cloud ✔");
                    } catch (e) {
                      setCloudStatus((s) => ({ ...s, error: String(e) }));
                      alert("Cloud sync failed: " + e);
                    }
                  }}
                  style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: "#e0f2f1", cursor: "pointer" }}
                >
                  Sync now
                </button>
                <button
                  onClick={loadFromCloud}
                  style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: "#e3f2fd", cursor: "pointer" }}
                >
                  Load from cloud
                </button>
                <small style={{ opacity: 0.7 }}>
                  {cloudStatus.lastSaveAt ? `Saved: ${cloudStatus.lastSaveAt.toLocaleTimeString()}` : ""}
                </small>
              </>
            )}
          </div>

          <button
            onClick={() => setDark((d) => !d)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: `1px solid ${btnBorder}`,
              background: dark ? "#333" : "#eee",
              color: dark ? "#fff" : "#000",
              cursor: "pointer",
            }}
          >
            {dark ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </div>

      {/* Shift Control Bar */}
      <div style={{ padding: 10, borderRadius: 6, background: softBg, marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!dayMeta.startedAt ? (
          <>
            <span><b>Shift not started.</b></span>
            <button
              onClick={startShift}
              style={{ background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
            >
              Start Shift
            </button>
            <small style={{ opacity: 0.8 }}>Select/enter worker first (Orders tab) or you'll be prompted.</small>
          </>
        ) : (
          <>
            <span>Started by <b>{dayMeta.startedBy}</b> at <b>{new Date(dayMeta.startedAt).toLocaleString()}</b></span>
            <button
              onClick={() => generatePDF()}
              style={{ background: "#7e57c2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
            >
              Download PDF Report
            </button>
            <button
              onClick={changeShift}
              style={{ background: "#37474f", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
            >
              Change Shift
            </button>
            <button
              onClick={endDay}
              style={{ background: "#e53935", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
            >
              End the Day (requires PDF)
            </button>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          ["orders", "Orders"],
          ["board", "Orders Board"],
          ["inventory", "Inventory"],
          ["expenses", "Expenses"],
          ["bank", "Bank"],
          ["reports", "Reports"],
          ["prices", "Prices"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleTabClick(key)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${btnBorder}`,
              background: activeTab === key ? "#ffd54f" : (dark ? "#333" : "#eee"),
              color: dark ? "#fff" : "#000",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ORDERS */}
      {activeTab === "orders" && (
        <div>
          <h2>Select item</h2>

          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* Vertical menu list */}
            <div style={{ flex: 1, minWidth: 300 }}>
              <h3>Burgers & Items</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {menu.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedBurger(item)}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      border: `1px solid ${btnBorder}`,
                      borderRadius: 6,
                      background: selectedBurger?.id === item.id ? "#c8e6c9" : (dark ? "#1e1e1e" : "#fafafa"),
                      color: dark ? "#eee" : "#000",
                      cursor: "pointer",
                    }}
                  >
                    {item.name} — E£{item.price}
                  </button>
                ))}
              </div>
            </div>

            {/* Vertical extras list */}
            <div style={{ flex: 1, minWidth: 300 }}>
              <h3>Extras (for selected item)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {extraList.map((ex) => {
                  const checked = !!selectedExtras.find((e) => e.id === ex.id);
                  return (
                    <label
                      key={ex.id}
                      style={{
                        padding: 10,
                        border: `1px solid ${btnBorder}`,
                        borderRadius: 6,
                        background: checked ? "#e1f5fe" : (dark ? "#1e1e1e" : "#fafafa"),
                        color: dark ? "#eee" : "#000",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExtra(ex)}
                        style={{ marginRight: 8 }}
                      />
                      {ex.name} — E£{ex.price}
                    </label>
                  );
                })}
              </div>

              <button
                onClick={addToCart}
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: "#42a5f5",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Add to cart
              </button>
            </div>
          </div>

          {/* Cart */}
          <h3 style={{ marginTop: 16 }}>Cart</h3>
          {cart.length === 0 && <p>No items yet.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {cart.map((it, idx) => (
              <li
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  border: `1px solid ${cardBorder}`,
                  borderRadius: 6,
                  padding: 8,
                  marginBottom: 6,
                  background: dark ? "#1a1a1a" : "transparent",
                }}
              >
                <div>
                  <strong>{it.name}</strong> — E£{it.price}
                  {it.extras?.length > 0 && (
                    <ul style={{ margin: "4px 0 0 16px", color: dark ? "#bbb" : "#555" }}>
                      {it.extras.map((e) => (
                        <li key={e.id}>+ {e.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  onClick={() => removeFromCart(idx)}
                  style={{
                    background: "#ef5350",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <p>
            <strong>Items Total:</strong> E£{
              cart.reduce(
                (s, b) => s + Number(b.price || 0) + (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0),
                0
              ).toFixed(2)
            }
          </p>

          {/* Order notes */}
          <div style={{ margin: "8px 0 12px" }}>
            <label>
              <strong>Order notes:</strong>{" "}
              <input
                type="text"
                value={orderNote}
                placeholder="e.g., no pickles, extra spicy"
                onChange={(e) => setOrderNote(e.target.value)}
                style={{
                  width: 420,
                  maxWidth: "90%",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: `1px solid ${btnBorder}`,
                  background: dark ? "#1e1e1e" : "white",
                  color: dark ? "#eee" : "#000",
                }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={worker} onChange={(e) => setWorker(e.target.value)}>
              <option value="">Select worker</option>
              {workers.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>

            <select value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">Select payment</option>
              {paymentMethods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <select
              value={orderType}
              onChange={(e) => {
                const v = e.target.value;
                setOrderType(v);
                setDeliveryFee(v === "Delivery" ? (deliveryFee || defaultDeliveryFee) : 0);
              }}
            >
              {orderTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            {orderType === "Delivery" && (
              <>
                <label>
                  Delivery fee:&nbsp;
                  <input
                    type="number"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(Number(e.target.value || 0))}
                    style={{ width: 120 }}
                  />
                </label>
                <small style={{ opacity: 0.75 }}>
                  (Default: E£{Number(defaultDeliveryFee || 0).toFixed(2)})
                </small>
              </>
            )}

            <button
              onClick={checkout}
              style={{
                background: "#43a047",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              Checkout
            </button>
          </div>

          <p style={{ marginTop: 8 }}>
            <strong>Order Total (incl. delivery if any):</strong>{" "}
            E£{
              (
                cart.reduce(
                  (s, b) => s + Number(b.price || 0) + (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0),
                  0
                ) + (orderType === "Delivery" ? Number(deliveryFee || 0) : 0)
              ).toFixed(2)
            }
          </p>
        </div>
      )}

      {/* ORDERS BOARD */}
      {activeTab === "board" && (
        <div>
          <h2>Orders Board {realtimeOrders ? "(Live)" : ""}</h2>
          {orders.length === 0 && <p>No orders yet.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {orders.map((o) => (
              <li
                key={`${o.cloudId || "local"}_${o.orderNo}`}
                style={{
                  border: `1px solid ${cardBorder}`,
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 8,
                  background: o.voided ? (dark ? "#4a2b2b" : "#ffebee")
                    : o.done ? (dark ? "#14331a" : "#e8f5e9")
                    : (dark ? "#333018" : "#fffde7"),
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>
                    Order #{o.orderNo} — E£{o.total.toFixed(2)} {o.cloudId ? "☁" : ""}
                  </strong>
                  <span>{o.date.toLocaleString()}</span>
                </div>
                <div style={{ color: dark ? "#ccc" : "#555", marginTop: 4 }}>
                  Worker: {o.worker} • Payment: {o.payment} • Type: {o.orderType || "-"}
                  {o.orderType === "Delivery" && <> • Delivery: E£{Number(o.deliveryFee || 0).toFixed(2)}</>}
                  {" "}• Status:{" "}
                  <strong>
                    {o.voided ? "Voided & Restocked" : o.done ? "Done" : "Not done"}
                  </strong>
                  {o.voided && o.restockedAt && (
                    <span> • Restocked at: {o.restockedAt.toLocaleString()}</span>
                  )}
                </div>

                {o.note && (
                  <div style={{ marginTop: 6, padding: 6, background: dark ? "#2a2a2a" : "#f0f7ff", borderRadius: 6 }}>
                    <strong>Note:</strong> {o.note}
                  </div>
                )}

                <ul style={{ marginTop: 8, marginBottom: 8 }}>
                  {o.cart.map((ci, idx) => (
                    <li key={idx} style={{ marginLeft: 12 }}>
                      • {ci.name} — E£{ci.price}
                      {ci.extras?.length > 0 && (
                        <ul style={{ margin: "2px 0 6px 18px", color: dark ? "#bbb" : "#555" }}>
                          {ci.extras.map((ex) => (
                            <li key={ex.id}>+ {ex.name} (E£{ex.price})</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!o.done && !o.voided && (
                    <button
                      onClick={() => markOrderDone(o.orderNo)}
                      style={{
                        background: "#43a047",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Mark DONE (locks)
                    </button>
                  )}
                  {o.done && (
                    <button
                      disabled
                      style={{
                        background: "#9e9e9e",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "not-allowed",
                      }}
                    >
                      DONE (locked)
                    </button>
                  )}

                  <button
                    onClick={() => printThermalTicket(o, 58, "Kitchen")}
                    disabled={o.done || o.voided}
                    style={{
                      background: o.done || o.voided ? "#b39ddb" : "#7e57c2",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: o.done || o.voided ? "not-allowed" : "pointer",
                    }}
                  >
                    Kitchen 58mm
                  </button>
                  <button
                    onClick={() => printThermalTicket(o, 80, "Kitchen")}
                    disabled={o.done || o.voided}
                    style={{
                      background: o.done || o.voided ? "#8e24aa88" : "#6a1b9a",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: o.done || o.voided ? "not-allowed" : "pointer",
                    }}
                  >
                    Kitchen 80mm
                  </button>
                  <button
                    onClick={() => printThermalTicket(o, 58, "Customer")}
                    disabled={o.voided}
                    style={{
                      background: o.voided ? "#26a69a88" : "#00897b",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Receipt 58mm
                  </button>
                  <button
                    onClick={() => printThermalTicket(o, 80, "Customer")}
                    disabled={o.voided}
                    style={{
                      background: o.voided ? "#00695c88" : "#00695c",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Receipt 80mm
                  </button>

                  <button
                    onClick={() => voidOrderAndRestock(o.orderNo)}
                    disabled={o.done || o.voided}
                    style={{
                      background: o.done || o.voided ? "#ef9a9a" : "#c62828",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: o.done || o.voided ? "not-allowed" : "pointer",
                    }}
                  >
                    Void & Restock
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* INVENTORY */}
      {activeTab === "inventory" && (
        <div>
          <h2>Inventory</h2>

          <div style={{ padding: 10, borderRadius: 6, background: inventoryLocked ? (dark ? "#2b3a2b" : "#e8f5e9") : (dark ? "#332d1e" : "#fffde7"), marginBottom: 10 }}>
            {inventoryLocked ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong>Locked:</strong>
                <span>
                  Start-of-day captured {inventoryLockedAt ? `at ${new Date(inventoryLockedAt).toLocaleString()}` : ""}.
                  Editing disabled until <b>End the Day</b> or admin unlock.
                </span>
                <button
                  onClick={unlockInventoryWithPin}
                  style={{ background: "#8e24aa", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                >
                  Unlock Inventory (Admin PIN)
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>Set your quantities, then:</span>
                <button
                  onClick={lockInventoryForDay}
                  style={{ background: "#2e7d32", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                >
                  Lock Inventory (start of day)
                </button>
              </div>
            )}
          </div>

          <div style={{ marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Item</th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Unit</th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Qty</th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 6 }}>{it.name}</td>
                    <td style={{ padding: 6 }}>{it.unit}</td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        value={it.qty}
                        disabled={inventoryLocked}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value || 0));
                          setInventory((inv) => inv.map((x) => (x.id === it.id ? { ...x, qty: v } : x)));
                        }}
                        style={{ width: 120 }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() => setInventory((inv) => inv.filter((x) => x.id !== it.id))}
                        disabled={inventoryLocked}
                        style={{ background: inventoryLocked ? "#ef9a9a" : "#ef5350", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: inventoryLocked ? "not-allowed" : "pointer" }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {inventory.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 6, color: dark ? "#bbb" : "#666" }}>
                      No inventory items yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, padding: 10, background: softBg, borderRadius: 6 }}>
            <strong>Add Inventory Item</strong>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input placeholder="Name (e.g., Buns)" value={newInvName} onChange={(e) => setNewInvName(e.target.value)} disabled={inventoryLocked} />
              <input placeholder="Unit (e.g., pcs/ml/g)" value={newInvUnit} onChange={(e) => setNewInvUnit(e.target.value)} disabled={inventoryLocked} />
              <input type="number" placeholder="Qty" value={newInvQty} onChange={(e) => setNewInvQty(Number(e.target.value || 0))} disabled={inventoryLocked} />
              <button
                onClick={() => {
                  const nm = newInvName.trim();
                  const un = newInvUnit.trim() || "pcs";
                  const id = nm.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 24) || `inv_${Date.now()}`;
                  if (!nm) return alert("Enter a name");
                  if (inventory.find((x) => x.id === id)) return alert("An inventory item with similar name/id exists. Try a different name.");
                  setInventory((inv) => [...inv, { id, name: nm, unit: un, qty: Math.max(0, newInvQty) }]);
                  setNewInvName(""); setNewInvUnit(""); setNewInvQty(0);
                }}
                disabled={inventoryLocked}
                style={{ background: inventoryLocked ? "#90caf9" : "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: inventoryLocked ? "not-allowed" : "pointer" }}
              >
                Add
              </button>
            </div>
            {inventoryLocked && <div style={{ marginTop: 6, fontSize: 12, color: dark ? "#bbb" : "#666" }}>Locked — add/edit is disabled until End the Day or admin unlock.</div>}
          </div>

          {inventorySnapshot.length > 0 && (
            <div style={{ marginTop: 12, padding: 10, background: softBg, borderRadius: 6 }}>
              <strong>Start-of-Day Snapshot</strong>
              <ul style={{ marginTop: 6 }}>
                {inventorySnapshot.map((s) => (
                  <li key={s.id}>
                    {s.name}: {s.qtyAtLock} {s.unit}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* EXPENSES */}
      {activeTab === "expenses" && (
        <div>
          <h2>Expenses</h2>

          <div style={{ padding: 10, background: softBg, borderRadius: 6, marginBottom: 10 }}>
            <strong>Add Expense</strong>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input placeholder="Name" value={newExpName} onChange={(e) => setNewExpName(e.target.value)} style={{ minWidth: 200 }} />
              <input placeholder="Unit (e.g., pcs/kg)" value={newExpUnit} onChange={(e) => setNewExpUnit(e.target.value)} style={{ width: 120 }} />
              <input type="number" placeholder="Qty" value={newExpQty} onChange={(e) => setNewExpQty(Number(e.target.value || 0))} style={{ width: 110 }} />
              <input type="number" placeholder="Unit Price (E£)" value={newExpUnitPrice} onChange={(e) => setNewExpUnitPrice(Number(e.target.value || 0))} style={{ width: 160 }} />
              <input placeholder="Note" value={newExpNote} onChange={(e) => setNewExpNote(e.target.value)} style={{ minWidth: 200 }} />
              <button
                onClick={() => {
                  const nm = newExpName.trim();
                  if (!nm) return alert("Enter expense name");
                  const exp = {
                    id: `exp_${Date.now()}`,
                    name: nm,
                    unit: newExpUnit.trim() || "pcs",
                    qty: Math.max(0, Number(newExpQty || 0)),
                    unitPrice: Math.max(0, Number(newExpUnitPrice || 0)),
                    date: new Date(),
                    note: newExpNote.trim(),
                  };
                  setExpenses((e) => [exp, ...e]);
                  setNewExpName(""); setNewExpUnit("pcs"); setNewExpQty(1); setNewExpUnitPrice(0); setNewExpNote("");
                }}
                style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
              >
                Add
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <strong>
              Total Expenses: E£
              {expenses.reduce((s, e) => s + (Number(e.qty || 0) * Number(e.unitPrice || 0)), 0).toFixed(2)}
            </strong>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Name</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Unit</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Qty</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Unit Price</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Total</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Date</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Note</th>
                <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: 6 }}>{e.name}</td>
                  <td style={{ padding: 6 }}>{e.unit}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{e.qty}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{Number(e.unitPrice || 0).toFixed(2)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{(Number(e.qty || 0) * Number(e.unitPrice || 0)).toFixed(2)}</td>
                  <td style={{ padding: 6 }}>{e.date ? new Date(e.date).toLocaleString() : ""}</td>
                  <td style={{ padding: 6 }}>{e.note || ""}</td>
                  <td style={{ padding: 6 }}>
                    <button
                      onClick={() => setExpenses((arr) => arr.filter((x) => x.id !== e.id))}
                      style={{ background: "#ef5350", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 6, color: dark ? "#bbb" : "#666" }}>
                    No expenses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* BANK (PIN protected) */}
      {activeTab === "bank" && (
        <div>
          <h2>Bank / Cash on Hand</h2>

          {!bankUnlocked ? (
            <div style={{ padding: 10, background: softBg, borderRadius: 6 }}>
              <p>This tab is protected. Please reopen it and pass Admin PIN.</p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <div><strong>Balance:</strong> E£{Number(bankBalance || 0).toFixed(2)}</div>
              </div>

              <div style={{ padding: 10, background: softBg, borderRadius: 6, marginBottom: 12 }}>
                <strong>Add Transaction</strong>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <select value={bankForm.type} onChange={(e) => setBankForm((f) => ({ ...f, type: e.target.value }))}>
                    <option value="deposit">Deposit</option>
                    <option value="withdraw">Withdraw</option>
                    <option value="init">Init Balance</option>
                    <option value="adjustUp">Adjust Up</option>
                    <option value="adjustDown">Adjust Down</option>
                  </select>
                  <input type="number" placeholder="Amount" value={bankForm.amount} onChange={(e) => setBankForm((f) => ({ ...f, amount: Number(e.target.value || 0) }))} style={{ width: 140 }} />
                  <input placeholder="Worker (optional)" value={bankForm.worker} onChange={(e) => setBankForm((f) => ({ ...f, worker: e.target.value }))} />
                  <input placeholder="Note" value={bankForm.note} onChange={(e) => setBankForm((f) => ({ ...f, note: e.target.value }))} style={{ minWidth: 200 }} />
                  <button
                    onClick={() => {
                      const a = Number(bankForm.amount || 0);
                      if (a <= 0) return alert("Enter amount");
                      const tx = { id: `tx_${Date.now()}`, ...bankForm, date: new Date() };
                      setBankTx((arr) => [tx, ...arr]);
                      setBankForm({ type: "deposit", amount: 0, worker: "", note: "" });
                    }}
                    style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Type</th>
                    <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Amount (E£)</th>
                    <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Worker</th>
                    <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Note</th>
                    <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Date</th>
                    <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bankTx.map((t) => (
                    <tr key={t.id}>
                      <td style={{ padding: 6 }}>{t.type}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{Number(t.amount || 0).toFixed(2)}</td>
                      <td style={{ padding: 6 }}>{t.worker || ""}</td>
                      <td style={{ padding: 6 }}>{t.note || ""}</td>
                      <td style={{ padding: 6 }}>{t.date ? new Date(t.date).toLocaleString() : ""}</td>
                      <td style={{ padding: 6 }}>
                        <button
                          onClick={() => setBankTx((arr) => arr.filter((x) => x.id !== t.id))}
                          style={{ background: "#ef5350", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {bankTx.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 6, color: dark ? "#bbb" : "#666" }}>
                        No transactions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* REPORTS */}
      {activeTab === "reports" && (
        <div>
          <h2>Reports — TUX</h2>

          <div style={{ marginBottom: 8, padding: 10, background: softBg, borderRadius: 6 }}>
            <div><strong>Shift:</strong> {dayMeta.startedAt ? `Started by ${dayMeta.startedBy} at ${new Date(dayMeta.startedAt).toLocaleString()}` : "Not started"}</div>
            {dayMeta.endedAt && <div><strong>Ended At:</strong> {new Date(dayMeta.endedAt).toLocaleString()}</div>}
            {dayMeta.shiftChanges?.length ? (
              <div style={{ marginTop: 4 }}>
                <strong>Shift Changes:</strong>{" "}
                {dayMeta.shiftChanges.map((c, i) => (
                  <span key={i} style={{ marginRight: 8 }}>
                    #{i + 1}: {c.from} → {c.to} @ {c.at ? new Date(c.at).toLocaleString() : "—"}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date-desc">Sort by Date (Newest)</option>
              <option value="date-asc">Sort by Date (Oldest)</option>
              <option value="worker">Sort by Worker</option>
              <option value="payment">Sort by Payment</option>
            </select>
            <button
              onClick={() => generatePDF()}
              style={{
                background: "#7e57c2",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Download PDF Report
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              padding: 10,
              background: softBg,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            <div><strong>Revenue (Shift):</strong> E£{totals.revenueTotal.toFixed(2)}</div>
            <div><strong>Delivery Fees:</strong> E£{totals.deliveryFeesTotal.toFixed(2)}</div>
            <div><strong>Expenses (Shift):</strong> E£{totals.expensesTotal.toFixed(2)}</div>
            <div><strong>Margin:</strong> E£{totals.margin.toFixed(2)}</div>
            {Object.keys(totals.byPay).map((k) => (
              <div key={k}><strong>{k}:</strong> E£{(totals.byPay[k] || 0).toFixed(2)}</div>
            ))}
            {Object.keys(totals.byType).map((k) => (
              <div key={k}><strong>{k}:</strong> E£{(totals.byType[k] || 0).toFixed(2)}</div>
            ))}
          </div>

          <div style={{ marginTop: 12, padding: 10, background: softBg , borderRadius: 6 }}>
            {/* Top Items & Extras */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <h3 style={{ marginTop: 0 }}>Items — Times Ordered</h3>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Item</th>
                      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Times</th>
                      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Revenue (E£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesStats.items.map((r) => (
                      <tr key={r.id}>
                        <td style={{ padding: 6 }}>{r.name}</td>
                        <td style={{ padding: 6, textAlign: "right" }}>{r.count}</td>
                        <td style={{ padding: 6, textAlign: "right" }}>{r.revenue.toFixed(2)}</td>
                      </tr>
                    ))}
                    {salesStats.items.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: 6, color: dark ? "#bbb" : "#666" }}>
                          No item sales yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ flex: 1, minWidth: 280 }}>
                <h3 style={{ marginTop: 0 }}>Extras — Times Ordered</h3>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Extra</th>
                      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Times</th>
                      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Revenue (E£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesStats.extras.map((r) => (
                      <tr key={r.id}>
                        <td style={{ padding: 6 }}>{r.name}</td>
                        <td style={{ padding: 6, textAlign: "right" }}>{r.count}</td>
                        <td style={{ padding: 6, textAlign: "right" }}>{r.revenue.toFixed(2)}</td>
                      </tr>
                    ))}
                    {salesStats.extras.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: 6, color: dark ? "#bbb" : "#666" }}>
                          No extra sales yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRICES (PIN gated by Editor PIN) */}
      {activeTab === "prices" && (
        <div>
          <h2>Prices & Settings</h2>

          {/* Menu editor */}
          <div style={{ marginBottom: 16, padding: 10, background: softBg, borderRadius: 6 }}>
            <h3 style={{ marginTop: 0 }}>Menu Items</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Name</th>
                  <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Price (E£)</th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Uses</th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {menu.map((m) => (
                  <tr key={m.id}>
                    <td style={{ padding: 6 }}>
                      <input
                        value={m.name}
                        onChange={(e) =>
                          setMenu((arr) =>
                            arr.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x))
                          )
                        }
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "right" }}>
                      <input
                        type="number"
                        value={m.price}
                        onChange={(e) =>
                          setMenu((arr) =>
                            arr.map((x) => (x.id === m.id ? { ...x, price: Number(e.target.value || 0) } : x))
                          )
                        }
                        style={{ width: 120, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() =>
                          setUsesEditOpenMenu((s) => ({ ...s, [m.id]: !s[m.id] }))
                        }
                        style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                      >
                        {usesEditOpenMenu[m.id] ? "Hide Uses" : "Edit Uses"}
                      </button>
                      {usesEditOpenMenu[m.id] && (
                        <div style={{ marginTop: 8, display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                          {inventory.map((inv) => {
                            const v = (m.uses && m.uses[inv.id]) || 0;
                            return (
                              <label key={inv.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ minWidth: 90 }}>{inv.name} ({inv.unit}):</span>
                                <input
                                  type="number"
                                  value={v}
                                  onChange={(e) => {
                                    const num = Math.max(0, Number(e.target.value || 0));
                                    setMenu((arr) =>
                                      arr.map((x) =>
                                        x.id === m.id ? { ...x, uses: { ...(x.uses || {}), [inv.id]: num } } : x
                                      )
                                    );
                                  }}
                                  style={{ width: 100 }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() => setMenu((arr) => arr.filter((x) => x.id !== m.id))}
                        style={{ background: "#ef5350", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {menu.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 6, color: dark ? "#bbb" : "#666" }}>
                      No menu items yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                placeholder="New item name"
                value={newMenuName}
                onChange={(e) => setNewMenuName(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <input
                type="number"
                placeholder="Price (E£)"
                value={newMenuPrice}
                onChange={(e) => setNewMenuPrice(Number(e.target.value || 0))}
                style={{ width: 140 }}
              />
              <button
                onClick={() => {
                  const nm = newMenuName.trim();
                  if (!nm) return alert("Enter item name");
                  const nextId = Math.max(0, ...menu.map((x) => Number(x.id) || 0), ...extraList.map((x) => Number(x.id) || 0)) + 1;
                  setMenu((arr) => [...arr, { id: nextId, name: nm, price: Math.max(0, newMenuPrice), uses: {} }]);
                  setNewMenuName("");
                  setNewMenuPrice(0);
                }}
                style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
              >
                Add Menu Item
              </button>
            </div>
          </div>

          {/* Extras editor */}
          <div style={{ marginBottom: 16, padding: 10, background: softBg, borderRadius: 6 }}>
            <h3 style={{ marginTop: 0 }}>Extras</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Name</th>
                  <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Price (E£)</th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Uses</th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {extraList.map((ex) => (
                  <tr key={ex.id}>
                    <td style={{ padding: 6 }}>
                      <input
                        value={ex.name}
                        onChange={(e) =>
                          setExtraList((arr) =>
                            arr.map((x) => (x.id === ex.id ? { ...x, name: e.target.value } : x))
                          )
                        }
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "right" }}>
                      <input
                        type="number"
                        value={ex.price}
                        onChange={(e) =>
                          setExtraList((arr) =>
                            arr.map((x) => (x.id === ex.id ? { ...x, price: Number(e.target.value || 0) } : x))
                          )
                        }
                        style={{ width: 120, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() =>
                          setUsesEditOpenExtra((s) => ({ ...s, [ex.id]: !s[ex.id] }))
                        }
                        style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                      >
                        {usesEditOpenExtra[ex.id] ? "Hide Uses" : "Edit Uses"}
                      </button>
                      {usesEditOpenExtra[ex.id] && (
                        <div style={{ marginTop: 8, display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                          {inventory.map((inv) => {
                            const v = (ex.uses && ex.uses[inv.id]) || 0;
                            return (
                              <label key={inv.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ minWidth: 90 }}>{inv.name} ({inv.unit}):</span>
                                <input
                                  type="number"
                                  value={v}
                                  onChange={(e) => {
                                    const num = Math.max(0, Number(e.target.value || 0));
                                    setExtraList((arr) =>
                                      arr.map((x) =>
                                        x.id === ex.id ? { ...x, uses: { ...(x.uses || {}), [inv.id]: num } } : x
                                      )
                                    );
                                  }}
                                  style={{ width: 100 }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() => setExtraList((arr) => arr.filter((x) => x.id !== ex.id))}
                        style={{ background: "#ef5350", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {extraList.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 6, color: dark ? "#bbb" : "#666" }}>
                      No extras yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                placeholder="New extra name"
                value={newExtraName}
                onChange={(e) => setNewExtraName(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <input
                type="number"
                placeholder="Price (E£)"
                value={newExtraPrice}
                onChange={(e) => setNewExtraPrice(Number(e.target.value || 0))}
                style={{ width: 140 }}
              />
              <button
                onClick={() => {
                  const nm = newExtraName.trim();
                  if (!nm) return alert("Enter extra name");
                  const nextId = Math.max(0, ...menu.map((x) => Number(x.id) || 0), ...extraList.map((x) => Number(x.id) || 0)) + 1;
                  setExtraList((arr) => [...arr, { id: nextId, name: nm, price: Math.max(0, newExtraPrice), uses: {} }]);
                  setNewExtraName("");
                  setNewExtraPrice(0);
                }}
                style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
              >
                Add Extra
              </button>
            </div>
          </div>

          {/* Order types & delivery fee */}
          <div style={{ marginBottom: 16, padding: 10, background: softBg, borderRadius: 6 }}>
            <h3 style={{ marginTop: 0 }}>Order Options</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              {orderTypes.map((t) => (
                <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${btnBorder}`, borderRadius: 6, padding: "4px 8px" }}>
                  {t}
                  <button
                    onClick={() => setOrderTypes((arr) => arr.filter((x) => x !== t))}
                    style={{ background: "#ef5350", color: "white", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                placeholder="Add order type"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = String(e.currentTarget.value || "").trim();
                    if (!v) return;
                    if (orderTypes.includes(v)) return alert("Type already exists.");
                    setOrderTypes((arr) => [...arr, v]);
                    e.currentTarget.value = "";
                  }
                }}
                style={{ minWidth: 180 }}
              />
            </div>
            <div>
              <label>
                Default Delivery Fee (E£):&nbsp;
                <input
                  type="number"
                  value={defaultDeliveryFee}
                  onChange={(e) => setDefaultDeliveryFee(Number(e.target.value || 0))}
                  style={{ width: 140 }}
                />
              </label>
            </div>
          </div>

          {/* Workers & payments */}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <div style={{ padding: 10, background: softBg, borderRadius: 6 }}>
              <h3 style={{ marginTop: 0 }}>Workers</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {workers.map((w) => (
                  <span key={w} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${btnBorder}`, borderRadius: 6, padding: "4px 8px" }}>
                    {w}
                    <button
                      onClick={() => setWorkers((arr) => arr.filter((x) => x !== w))}
                      style={{ background: "#ef5350", color: "white", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder="Add worker"
                  value={newWorker}
                  onChange={(e) => setNewWorker(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => {
                    const v = newWorker.trim();
                    if (!v) return;
                    if (workers.includes(v)) return alert("Worker already exists.");
                    setWorkers((arr) => [...arr, v]);
                    setNewWorker("");
                  }}
                  style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                >
                  Add
                </button>
              </div>
            </div>

            <div style={{ padding: 10, background: softBg, borderRadius: 6 }}>
              <h3 style={{ marginTop: 0 }}>Payment Methods</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {paymentMethods.map((p) => (
                  <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${btnBorder}`, borderRadius: 6, padding: "4px 8px" }}>
                    {p}
                    <button
                      onClick={() => setPaymentMethods((arr) => arr.filter((x) => x !== p))}
                      style={{ background: "#ef5350", color: "white", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder="Add payment method"
                  value={newPayment}
                  onChange={(e) => setNewPayment(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => {
                    const v = newPayment.trim();
                    if (!v) return;
                    if (paymentMethods.includes(v)) return alert("Payment method already exists.");
                    setPaymentMethods((arr) => [...arr, v]);
                    setNewPayment("");
                  }}
                  style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Admin PINs */}
          <div style={{ marginTop: 16, padding: 10, background: softBg, borderRadius: 6 }}>
            <h3 style={{ marginTop: 0 }}>Admin PINs (1–6)</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Admin #</th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>PIN</th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[1,2,3,4,5,6].map((n) => (
                  <tr key={n}>
                    <td style={{ padding: 6 }}>Admin {n}</td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="password"
                        value={adminPins[n] || ""}
                        disabled={!adminPinsEditUnlocked[n]}
                        onChange={(e) =>
                          setAdminPins((p) => ({ ...p, [n]: e.target.value }))
                        }
                        style={{ width: 180 }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      {!adminPinsEditUnlocked[n] ? (
                        <button
                          onClick={() => {
                            const ok = promptAdminAndPin();
                            if (ok === n) {
                              setAdminPinsEditUnlocked((s) => ({ ...s, [n]: true }));
                            } else if (ok) {
                              alert("You unlocked a different admin. Try again.");
                            }
                          }}
                          style={{ background: "#1976d2", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                        >
                          Unlock row
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setAdminPinsEditUnlocked((s) => ({ ...s, [n]: false }))
                          }
                          style={{ background: "#9e9e9e", color: "white", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                        >
                          Lock row
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 12, color: dark ? "#bbb" : "#666" }}>
              Tip: To unlock a row, you must enter the current correct PIN for that Admin number.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



