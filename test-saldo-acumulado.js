const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8802;
const ROOT = __dirname;
const SCREENSHOTS = path.join(ROOT, "screenshots");
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS);

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

function ds(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

const Y = 2026;

// ================================================================
// EXAMPLE 1 (simple): Inter — Jan entry R$5000, Feb expense R$500
// ================================================================
// Jan: +5000 Inter → saldo Inter Jan = 5000
// Feb (no entries yet): saldo Inter = 5000 (carried)
// Feb: -500 Inter → saldo Inter Feb = 4500
// Jan again: saldo Inter = 5000 (Feb expense not counted)

// ================================================================
// EXAMPLE 2 (complete): Nubank — Jun entry R$2000, Jul credit R$500 pending then paid
// ================================================================
// Jun: +2000 Nubank → saldo Nubank Jun = 2000
// Jul: credit purchase R$500 Nubank, status=pendente → saldo Nubank Jul = 2000 (no impact)
// Jul: mark as pago, bancoPagamento=nubank, date in Jul → saldo Nubank Jul = 1500
// Aug: nothing → saldo Nubank Aug = 1500

const entries = [
  // Example 1
  { id:'e1', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:5000,
    data:ds(Y,0,15), banco:'inter', formaPagamento:'pix', statusPagamento:'pago',
    fixo:false, descricao:'Receita Jan', criadoEm:{seconds:Date.now()/1000-2000} },
  { id:'e2', movimento:'saida', tipo:'pessoal', categoria:'alimentacao', valor:500,
    data:ds(Y,1,10), banco:'inter', formaPagamento:'debito', statusPagamento:'pago',
    fixo:false, descricao:'Despesa Fev', criadoEm:{seconds:Date.now()/1000-1500} },

  // Example 2
  { id:'e3', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:2000,
    data:ds(Y,5,15), banco:'nubank', formaPagamento:'pix', statusPagamento:'pago',
    fixo:false, descricao:'Receita Jun', criadoEm:{seconds:Date.now()/1000-1000} },
  // Credit purchase in July — PAID, bancoPagamento=nubank, date in July
  { id:'e4', movimento:'saida', tipo:'pessoal', categoria:'roupas', valor:500,
    data:ds(Y,6,20), banco:'nubank', formaPagamento:'credito', statusPagamento:'pago',
    fixo:false, descricao:'Compra crédito Jul', bancoPagamento:'nubank',
    criadoEm:{seconds:Date.now()/1000-500} },
];

function buildMocks() {
  return `
  let snapshotCount = 0;
  const entries = ${JSON.stringify(entries)};

  export function getFirestore() { return {}; }
  export function doc(...args) { if (args.length >= 3 && args[1] === "usuarios") return { __pagoDoc: true }; return {}; }
  export function getDoc() {
    return Promise.resolve({
      exists: () => true,
      data: () => ({ nome: 'Rafa Luzia', area: 'esteticista', orcamentos: {} })
    });
  }
  export function setDoc() { return Promise.resolve(); }
  export function updateDoc() { return Promise.resolve(); }
  export function collection() { return {}; }
  export function addDoc() { return Promise.resolve({ id: 'new-doc' }); }
  export function deleteDoc() { return Promise.resolve(); }
  export function onSnapshot(ref, callback) {
    if (ref && ref.__pagoDoc) { setTimeout(() => callback({ exists: () => true, data: () => ({ pago: true }) }), 5); return () => {}; }
    snapshotCount++;
    if (snapshotCount === 1) {
      setTimeout(() => callback({
        docs: entries.map(e => ({ id: e.id, data: () => { const {id,...r}=e; return r; } }))
      }), 10);
    } else {
      setTimeout(() => callback({ docs: [] }), 10);
    }
    return () => {};
  }
  export function query() { return {}; }
  export function serverTimestamp() { return { seconds: Date.now()/1000 }; }
  `;
}

function parseBRL(str) {
  if (!str || str === '—' || str === '') return 0;
  return parseFloat(str.replace(/[R$\s.]/g, '').replace(',', '.'));
}

async function run() {
  const server = await startServer();
  console.log(`Server on http://localhost:${PORT}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", err => { errors.push(err.message); console.log("PAGE ERROR:", err.message); });

  await page.route("**/firebasejs/**/firebase-app.js", r =>
    r.fulfill({ contentType: "application/javascript", body: `export function initializeApp(){return {};}` }));
  await page.route("**/firebasejs/**/firebase-auth.js", r =>
    r.fulfill({ contentType: "application/javascript", body: `
      export function getAuth(){return {};}
      export function onAuthStateChanged(a,cb){setTimeout(()=>cb({uid:'t',email:'t@t.com'}),50);return ()=>{};}
      export function signOut(){return Promise.resolve();}` }));
  await page.route("**/firebasejs/**/firebase-firestore.js", r =>
    r.fulfill({ contentType: "application/javascript", body: buildMocks() }));
  await page.route("**/js/firebase-config.js", r =>
    r.fulfill({ contentType: "application/javascript", body: `export const firebaseConfig={};` }));

  await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(800);

  let passed = 0, failed = 0;
  function check(label, actual, expected, tolerance = 0.01) {
    const ok = Math.abs(actual - expected) < tolerance;
    if (ok) { console.log(`  ✓ ${label}: ${actual} === ${expected}`); passed++; }
    else { console.log(`  ✗ ${label}: got ${actual}, expected ${expected}`); failed++; }
  }

  async function setFilter(month, year) {
    await page.evaluate(({ m, y }) => {
      const selYear = document.getElementById('filter-year');
      if (!Array.from(selYear.options).some(o => o.value === String(y))) {
        selYear.innerHTML += `<option value="${y}">${y}</option>`;
      }
      selYear.value = String(y);
      selYear.dispatchEvent(new Event('change'));
      const selVal = document.getElementById('filter-value');
      selVal.value = String(m);
      selVal.dispatchEvent(new Event('change'));
    }, { m: month, y: year });
    await page.waitForTimeout(800);
  }

  async function getBankSaldo(bankName) {
    return await page.evaluate((name) => {
      const container = document.getElementById('bank-cards-total');
      if (!container) return null;
      for (const card of container.querySelectorAll('.bank-card')) {
        if (card.querySelector('.bank-name')?.textContent?.trim() === name)
          return card.querySelector('.bank-value')?.textContent?.trim();
      }
      return null;
    }, bankName);
  }

  // Verify old period panel is gone
  const periodPanelExists = await page.evaluate(() => !!document.getElementById('bank-cards-period'));
  check("Period panel removed", periodPanelExists ? 0 : 1, 1);

  // ================================================================
  // EXAMPLE 1 — Inter: Jan R$5000 entry, Feb R$500 expense
  // ================================================================
  console.log("\n=== EXAMPLE 1: SIMPLE (Inter) ===");

  // Jan: saldo Inter = 5000
  await setFilter(0, Y);
  const jan = await getBankSaldo('Inter');
  console.log(`  Jan Inter: ${jan}`);
  check("Jan: Inter saldo", parseBRL(jan), 5000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-ex1-jan.png"), fullPage: false });

  // Feb: saldo Inter = 4500 (5000 - 500)
  await setFilter(1, Y);
  const feb = await getBankSaldo('Inter');
  console.log(`  Feb Inter: ${feb}`);
  check("Feb: Inter saldo", parseBRL(feb), 4500);
  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-ex1-feb.png"), fullPage: false });

  // Back to Jan: saldo Inter = 5000 (Feb expense NOT counted)
  await setFilter(0, Y);
  const janAgain = await getBankSaldo('Inter');
  console.log(`  Jan (again) Inter: ${janAgain}`);
  check("Jan again: Inter saldo", parseBRL(janAgain), 5000);

  // Mar: saldo Inter = 4500 (carried from Feb, nothing new)
  await setFilter(2, Y);
  const mar = await getBankSaldo('Inter');
  console.log(`  Mar Inter: ${mar}`);
  check("Mar: Inter saldo (carried)", parseBRL(mar), 4500);

  // ================================================================
  // EXAMPLE 2 — Nubank: Jun R$2000, Jul credit paid R$500
  // ================================================================
  console.log("\n=== EXAMPLE 2: COMPLETE (Nubank) ===");

  // Jun: saldo Nubank = 2000
  await setFilter(5, Y);
  const jun = await getBankSaldo('Nubank');
  console.log(`  Jun Nubank: ${jun}`);
  check("Jun: Nubank saldo", parseBRL(jun), 2000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-ex2-jun.png"), fullPage: false });

  // Jul: saldo Nubank = 1500 (2000 - 500, credit paid in Jul)
  await setFilter(6, Y);
  const jul = await getBankSaldo('Nubank');
  console.log(`  Jul Nubank: ${jul}`);
  check("Jul: Nubank saldo", parseBRL(jul), 1500);
  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-ex2-jul.png"), fullPage: false });

  // Aug: saldo Nubank = 1500 (carried, no new movement)
  await setFilter(7, Y);
  const aug = await getBankSaldo('Nubank');
  console.log(`  Aug Nubank: ${aug}`);
  check("Aug: Nubank saldo", parseBRL(aug), 1500);
  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-ex2-aug.png"), fullPage: false });

  // Jun again: saldo Nubank = 2000 (Jul payment not counted)
  await setFilter(5, Y);
  const junAgain = await getBankSaldo('Nubank');
  console.log(`  Jun (again) Nubank: ${junAgain}`);
  check("Jun again: Nubank saldo", parseBRL(junAgain), 2000);

  // ================================================================
  // CROSS-CHECK: Patrimônio Total consistency
  // ================================================================
  console.log("\n=== PATRIMÔNIO TOTAL CROSS-CHECK ===");

  async function getPatrimonio() {
    return await page.evaluate(() => document.getElementById('kpi-patrimonio')?.textContent || '');
  }

  // Jan: only e1 (+5000 Inter) → patrimônio = 5000
  await setFilter(0, Y);
  check("Jan patrimônio", parseBRL(await getPatrimonio()), 5000);

  // Feb: e1 + e2 (5000 - 500) → patrimônio = 4500
  await setFilter(1, Y);
  check("Feb patrimônio", parseBRL(await getPatrimonio()), 4500);

  // Jun: e1 + e2 + e3 (5000 - 500 + 2000) → patrimônio = 6500
  await setFilter(5, Y);
  check("Jun patrimônio", parseBRL(await getPatrimonio()), 6500);

  // Jul: e1 + e2 + e3 + e4 (5000 - 500 + 2000 - 500) → patrimônio = 6000
  await setFilter(6, Y);
  check("Jul patrimônio", parseBRL(await getPatrimonio()), 6000);

  // Aug: same as Jul (no new entries) → patrimônio = 6000
  await setFilter(7, Y);
  check("Aug patrimônio", parseBRL(await getPatrimonio()), 6000);

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (errors.length) console.log(`Page errors: ${errors.length}`);
  console.log(`${'='.repeat(50)}\n`);

  await browser.close();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("FATAL:", err); process.exit(1); });
