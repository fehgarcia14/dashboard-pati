const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8799;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".png": "image/png", ".json": "application/json",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
      const ext = path.extname(filePath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

const FIREBASE_APP_MOCK = `
  export function initializeApp() { return {}; }
`;

const FIREBASE_AUTH_MOCK = `
  export function getAuth() { return {}; }
  export function onAuthStateChanged(auth, callback) {
    setTimeout(() => callback({ uid: 'test-user', email: 'test@test.com' }), 50);
    return () => {};
  }
  export function signOut() { return Promise.resolve(); }
`;

const FIREBASE_FIRESTORE_MOCK = `
  let snapshotCount = 0;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  function dateStr(year, month, day) {
    return year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
  }

  const mockEntries = [
    { id: 'e1', movimento: 'entrada', tipo: 'profissional', categoria: 'servicos', valor: 350, data: dateStr(y, m, 5), banco: 'nubank', formaPagamento: 'pix', statusPagamento: 'pago', fixo: false, descricao: 'Cliente A', criadoEm: { seconds: Date.now()/1000 - 86400 } },
    { id: 'e2', movimento: 'saida', tipo: 'pessoal', categoria: 'alimentacao', valor: 120, data: dateStr(y, m, 3), banco: 'nubank', formaPagamento: 'debito', statusPagamento: 'pago', fixo: false, descricao: 'Supermercado', criadoEm: { seconds: Date.now()/1000 - 172800 } },
    { id: 'e3', movimento: 'saida', tipo: 'pessoal', categoria: 'moradia', valor: 1200, data: dateStr(y, m, 1), banco: 'itau', formaPagamento: 'debito', statusPagamento: 'pago', fixo: true, descricao: 'Aluguel', criadoEm: { seconds: Date.now()/1000 - 259200 } },
    { id: 'e4', movimento: 'saida', tipo: 'profissional', categoria: 'produtos', valor: 80, data: dateStr(y, m, 10), banco: 'nubank', formaPagamento: 'credito', statusPagamento: 'pendente', fixo: false, descricao: 'Esmaltes', criadoEm: { seconds: Date.now()/1000 - 50000 } },
  ];

  export function getFirestore() { return {}; }
  export function doc(...args) { if (args.length >= 3 && args[1] === "users") return { __pagoDoc: true }; return {}; }
  export function getDoc() {
    return Promise.resolve({
      exists: () => true,
      data: () => ({ nome: 'Rafa Luzia', area: 'esteticista', orcamentos: { alimentacao: 500, moradia: 1500 } })
    });
  }
  export function setDoc() { return Promise.resolve(); }
  export function updateDoc() { return Promise.resolve(); }
  export function collection() { return {}; }
  export function addDoc() { return Promise.resolve({ id: 'new-doc' }); }
  export function deleteDoc() { return Promise.resolve(); }
  export function onSnapshot(ref, callback, errorCallback) {
    if (ref && ref.__pagoDoc) { setTimeout(() => callback({ exists: () => true, data: () => ({ pago: true }) }), 5); return () => {}; }
    snapshotCount++;
    if (snapshotCount === 1) {
      setTimeout(() => callback({
        docs: mockEntries.map(e => ({ id: e.id, data: () => { const {id, ...rest} = e; return rest; } }))
      }), 10);
    } else {
      setTimeout(() => callback({ docs: [] }), 10);
    }
    return () => {};
  }
  export function query() { return {}; }
  export function serverTimestamp() { return { seconds: Date.now() / 1000 }; }
`;

const FIREBASE_CONFIG_MOCK = `export const firebaseConfig = {};`;

async function run() {
  const server = await startServer();
  console.log(`Server on http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", err => errors.push(err.message));

  await page.route("**/firebasejs/**/firebase-app.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_APP_MOCK }));
  await page.route("**/firebasejs/**/firebase-auth.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_AUTH_MOCK }));
  await page.route("**/firebasejs/**/firebase-firestore.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_FIRESTORE_MOCK }));
  await page.route("**/js/firebase-config.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_CONFIG_MOCK }));

  await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(500);

  // Set filter to 2 months in the future
  const futureMonth = (new Date().getMonth() + 2) % 12;
  console.log(`Setting filter to month index: ${futureMonth}`);
  await page.selectOption("#filter-value", String(futureMonth));
  await page.waitForTimeout(300);

  // Open modal
  await page.click("#fab-add");
  await page.waitForTimeout(200);

  // Click "Saída"
  await page.click('#modal-entry [data-mov="saida"]');
  await page.waitForTimeout(100);

  // Check categories and date
  const result = await page.evaluate(() => {
    const sel = document.getElementById("entry-categoria");
    return {
      optionCount: sel.options.length,
      options: Array.from(sel.options).map(o => ({ value: o.value, label: o.text })),
      selectedValue: sel.value,
      date: document.getElementById("entry-data").value
    };
  });

  console.log(`\nCategories: ${result.optionCount} options`);
  result.options.forEach(o => console.log(`  - ${o.label} (${o.value})`));
  console.log(`Default date: ${result.date}`);

  const screenshotsDir = path.join(ROOT, "screenshots");
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
  await page.screenshot({ path: path.join(screenshotsDir, "fix-verified-future-month.png"), fullPage: false });

  if (result.optionCount === 0) {
    console.log("\nFAIL: Categories are empty!");
    process.exitCode = 1;
  } else {
    console.log("\nPASS: Categories populated correctly.");
  }

  if (errors.length > 0) {
    console.log(`\nPage errors: ${errors.join("; ")}`);
  }

  await browser.close();
  server.close();
}

run().catch(console.error);
