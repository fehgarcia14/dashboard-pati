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

// Scenario: June has R$200 net for Nubank, July adds R$1000 more, August has nothing.
// Use fixed year 2025 and months June(5), July(6), August(7).
const Y = 2025;

const entries = [
  // June: entrada R$200 Nubank
  { id:'j1', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:200, data:ds(Y,5,15),
    banco:'nubank', formaPagamento:'pix', statusPagamento:'pago', fixo:false, descricao:'Serviço Jun',
    criadoEm:{seconds:Date.now()/1000-1000} },
  // July: entrada R$1000 Nubank
  { id:'jl1', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:1000, data:ds(Y,6,10),
    banco:'nubank', formaPagamento:'pix', statusPagamento:'pago', fixo:false, descricao:'Serviço Jul',
    criadoEm:{seconds:Date.now()/1000-500} },
];

function buildMocks() {
  return `
  let snapshotCount = 0;
  const entries = ${JSON.stringify(entries)};

  export function getFirestore() { return {}; }
  export function doc() { return {}; }
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

  // Helper: set filter to a specific month (0-based) and year
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

  async function getBankTotal(bankName) {
    return await page.evaluate((name) => {
      const container = document.getElementById('bank-cards-total');
      if (!container) return null;
      const cards = container.querySelectorAll('.bank-card');
      for (const card of cards) {
        const n = card.querySelector('.bank-name')?.textContent?.trim();
        if (n === name) return card.querySelector('.bank-value')?.textContent?.trim();
      }
      return null;
    }, bankName);
  }

  async function getPatrimonio() {
    return await page.evaluate(() => document.getElementById('kpi-patrimonio')?.textContent || '');
  }

  // ================================================================
  // JUNE — Saldo Atual Nubank should be R$200 (only June entry)
  // ================================================================
  console.log("\n=== JUNE ===");
  await setFilter(5, Y); // June = month index 5

  const junNubank = await getBankTotal('Nubank');
  const junPatrimonio = await getPatrimonio();
  console.log(`  Nubank Saldo Atual: ${junNubank}`);
  console.log(`  Patrimônio Total: ${junPatrimonio}`);
  check("June: Nubank Saldo Atual", parseBRL(junNubank), 200);
  check("June: Patrimônio Total", parseBRL(junPatrimonio), 200);

  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-acum-june.png"), fullPage: false });

  // ================================================================
  // JULY — Saldo Atual Nubank should be R$1200 (200 + 1000 accumulated)
  // ================================================================
  console.log("\n=== JULY ===");
  await setFilter(6, Y); // July = month index 6

  const julNubank = await getBankTotal('Nubank');
  const julPatrimonio = await getPatrimonio();
  console.log(`  Nubank Saldo Atual: ${julNubank}`);
  console.log(`  Patrimônio Total: ${julPatrimonio}`);
  check("July: Nubank Saldo Atual", parseBRL(julNubank), 1200);
  check("July: Patrimônio Total", parseBRL(julPatrimonio), 1200);

  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-acum-july.png"), fullPage: false });

  // ================================================================
  // AUGUST — Saldo Atual Nubank should still be R$1200 (no new entries)
  // ================================================================
  console.log("\n=== AUGUST ===");
  await setFilter(7, Y); // August = month index 7

  const augNubank = await getBankTotal('Nubank');
  const augPatrimonio = await getPatrimonio();
  console.log(`  Nubank Saldo Atual: ${augNubank}`);
  console.log(`  Patrimônio Total: ${augPatrimonio}`);
  check("August: Nubank Saldo Atual", parseBRL(augNubank), 1200);
  check("August: Patrimônio Total", parseBRL(augPatrimonio), 1200);

  await page.screenshot({ path: path.join(SCREENSHOTS, "saldo-acum-august.png"), fullPage: false });

  // ================================================================
  // ALSO CHECK: "Saldo por Banco no Período" should show per-period only
  // ================================================================
  console.log("\n=== PERIOD-ONLY CHECKS ===");

  async function getBankPeriod(bankName) {
    return await page.evaluate((name) => {
      const container = document.getElementById('bank-cards-period');
      if (!container) return null;
      const cards = container.querySelectorAll('.bank-card');
      for (const card of cards) {
        const n = card.querySelector('.bank-name')?.textContent?.trim();
        if (n === name) return card.querySelector('.bank-value')?.textContent?.trim();
      }
      return null;
    }, bankName);
  }

  // Go to June — period should show R$200
  await setFilter(5, Y);
  const junPeriod = await getBankPeriod('Nubank');
  console.log(`  June period Nubank: ${junPeriod}`);
  check("June period: Nubank", parseBRL(junPeriod), 200);

  // Go to July — period should show R$1000 (only July's entries)
  await setFilter(6, Y);
  const julPeriod = await getBankPeriod('Nubank');
  console.log(`  July period Nubank: ${julPeriod}`);
  check("July period: Nubank", parseBRL(julPeriod), 1000);

  // Go to August — period should show nothing (no entries)
  await setFilter(7, Y);
  const augPeriod = await getBankPeriod('Nubank');
  console.log(`  August period Nubank: ${augPeriod}`);
  // augPeriod should be null (no card rendered since value is 0)
  check("August period: Nubank absent", augPeriod === null ? 1 : 0, 1);

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
