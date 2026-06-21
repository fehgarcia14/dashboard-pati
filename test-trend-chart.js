const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8803;
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

const entries = [
  // June: receita R$3000
  { id:'t1', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:3000,
    data:ds(Y,5,15), banco:'nubank', formaPagamento:'pix', statusPagamento:'pago',
    fixo:false, descricao:'Receita Jun', criadoEm:{seconds:Date.now()/1000-1000} },
  // June: despesa R$800
  { id:'t2', movimento:'saida', tipo:'pessoal', categoria:'alimentacao', valor:800,
    data:ds(Y,5,20), banco:'nubank', formaPagamento:'debito', statusPagamento:'pago',
    fixo:false, descricao:'Despesa Jun', criadoEm:{seconds:Date.now()/1000-900} },
  // July: receita R$2000
  { id:'t3', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:2000,
    data:ds(Y,6,10), banco:'nubank', formaPagamento:'pix', statusPagamento:'pago',
    fixo:false, descricao:'Receita Jul', criadoEm:{seconds:Date.now()/1000-500} },
  // July: despesa R$5500
  { id:'t4', movimento:'saida', tipo:'pessoal', categoria:'moradia', valor:5500,
    data:ds(Y,6,15), banco:'nubank', formaPagamento:'debito', statusPagamento:'pago',
    fixo:false, descricao:'Despesa Jul', criadoEm:{seconds:Date.now()/1000-400} },
  // August: receita R$1000
  { id:'t5', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:1000,
    data:ds(Y,7,5), banco:'inter', formaPagamento:'pix', statusPagamento:'pago',
    fixo:false, descricao:'Receita Ago', criadoEm:{seconds:Date.now()/1000-200} },
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
  function check(label, actual, expected) {
    const ok = actual === expected;
    if (ok) { console.log(`  ✓ ${label}: "${actual}" === "${expected}"`); passed++; }
    else { console.log(`  ✗ ${label}: got "${actual}", expected "${expected}"`); failed++; }
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

  async function getTrendLabels() {
    return await page.evaluate(() => {
      const chart = Chart.instances ? Object.values(Chart.instances).find(c => c.canvas.id === 'chart-trend') : null;
      if (!chart) return [];
      return chart.data.labels;
    });
  }

  async function getTrendData() {
    return await page.evaluate(() => {
      const chart = Object.values(Chart.instances).find(c => c.canvas.id === 'chart-trend');
      if (!chart) return { receita: [], despesa: [] };
      return {
        receita: chart.data.datasets[0].data,
        despesa: chart.data.datasets[1].data,
      };
    });
  }

  // ================================================================
  // FILTER: JUNE 2026
  // ================================================================
  console.log("\n=== FILTER: JUNE 2026 ===");
  await setFilter(5, Y);

  const junLabels = await getTrendLabels();
  const junData = await getTrendData();
  console.log(`  Labels: ${junLabels.join(', ')}`);
  console.log(`  Last label: ${junLabels[junLabels.length - 1]}`);
  check("Jun filter: last label is Jun/26", junLabels[junLabels.length - 1], "Jun/26");
  check("Jun filter: 12 labels", String(junLabels.length), "12");

  // Jun receita=3000, despesa=800
  const junRec = junData.receita[junData.receita.length - 1];
  const junDesp = junData.despesa[junData.despesa.length - 1];
  console.log(`  Jun bar — Receita: ${junRec}, Despesa: ${junDesp}`);
  check("Jun filter: Jun receita = 3000", String(junRec), "3000");
  check("Jun filter: Jun despesa = 800", String(junDesp), "800");

  await page.screenshot({ path: path.join(SCREENSHOTS, "trend-filter-jun.png"), fullPage: false });

  // ================================================================
  // FILTER: JULY 2026
  // ================================================================
  console.log("\n=== FILTER: JULY 2026 ===");
  await setFilter(6, Y);

  const julLabels = await getTrendLabels();
  const julData = await getTrendData();
  console.log(`  Labels: ${julLabels.join(', ')}`);
  console.log(`  Last label: ${julLabels[julLabels.length - 1]}`);
  check("Jul filter: last label is Jul/26", julLabels[julLabels.length - 1], "Jul/26");
  check("Jul filter: 12 labels", String(julLabels.length), "12");

  // Jul (last bar): receita=2000, despesa=5500
  const julRec = julData.receita[julData.receita.length - 1];
  const julDesp = julData.despesa[julData.despesa.length - 1];
  console.log(`  Jul bar — Receita: ${julRec}, Despesa: ${julDesp}`);
  check("Jul filter: Jul receita = 2000", String(julRec), "2000");
  check("Jul filter: Jul despesa = 5500", String(julDesp), "5500");

  // Jun (second-to-last bar): receita=3000, despesa=800
  const julJunRec = julData.receita[julData.receita.length - 2];
  const julJunDesp = julData.despesa[julData.despesa.length - 2];
  console.log(`  Jun bar (in Jul view) — Receita: ${julJunRec}, Despesa: ${julJunDesp}`);
  check("Jul filter: Jun receita = 3000", String(julJunRec), "3000");
  check("Jul filter: Jun despesa = 800", String(julJunDesp), "800");

  await page.screenshot({ path: path.join(SCREENSHOTS, "trend-filter-jul.png"), fullPage: false });

  // ================================================================
  // FILTER: AUGUST 2026
  // ================================================================
  console.log("\n=== FILTER: AUGUST 2026 ===");
  await setFilter(7, Y);

  const augLabels = await getTrendLabels();
  const augData = await getTrendData();
  console.log(`  Labels: ${augLabels.join(', ')}`);
  console.log(`  Last label: ${augLabels[augLabels.length - 1]}`);
  check("Aug filter: last label is Ago/26", augLabels[augLabels.length - 1], "Ago/26");
  check("Aug filter: 12 labels", String(augLabels.length), "12");

  // Aug (last bar): receita=1000, despesa=0
  const augRec = augData.receita[augData.receita.length - 1];
  const augDesp = augData.despesa[augData.despesa.length - 1];
  console.log(`  Aug bar — Receita: ${augRec}, Despesa: ${augDesp}`);
  check("Aug filter: Aug receita = 1000", String(augRec), "1000");
  check("Aug filter: Aug despesa = 0", String(augDesp), "0");

  await page.screenshot({ path: path.join(SCREENSHOTS, "trend-filter-aug.png"), fullPage: false });

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
