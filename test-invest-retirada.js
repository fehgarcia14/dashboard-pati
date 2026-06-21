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

const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth();
function ds(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

// Scenario:
// 1. Aporte R$1000 to "Caixinha Reserva", product bank = Nubank, origin = Nubank
// 2. Retirada R$100 from "Caixinha Reserva", product bank = Nubank, money goes to Inter
//
// Expected:
//   Carteira: ONE "Caixinha Reserva" under Nubank, saldo = R$900
//   Bank card total: Inter gets +100, Nubank gets -1000+0 = -1000 (only the aporte debits Nubank)
//     Wait — actually for bank cards:
//       inv1 aporte: bancoOrigem=nubank → nubank -1000
//       inv2 retirada: bancoOrigem=inter → inter +100
//     But the money goes TO inter, so bancoOrigem for retirada = inter (the destination bank)
//     Actually let me re-read the label: for retirada, inv-banco-origem is labeled "Banco destino (pra onde volta)"
//     So bancoOrigem = "inter" for the retirada (where the money returns to)
//     And in renderBankCards: retirada → totalSaldo[bancoOrigem] += val → inter += 100 ✓
//     And nubank: only the aporte → nubank -= 1000

const invAporte = {
  id: 'inv-a', bancoOrigem: 'nubank', bancoInvestimento: 'nubank', banco: 'nubank',
  produto: 'Caixinha Reserva', movimento: 'aporte', valor: 1000, data: ds(Y, M, 5),
  observacao: '', criadoEm: { seconds: Date.now()/1000 - 1000 }
};
const invRetirada = {
  id: 'inv-r', bancoOrigem: 'inter', bancoInvestimento: 'nubank', banco: 'nubank',
  produto: 'Caixinha Reserva', movimento: 'retirada', valor: 100, data: ds(Y, M, 15),
  observacao: '', criadoEm: { seconds: Date.now()/1000 - 500 }
};

const allInv = [invAporte, invRetirada];

const MOCK_FIRESTORE = `
  let snapshotCount = 0;
  const investimentos = ${JSON.stringify(allInv)};

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
    if (snapshotCount === 3) {
      // 3rd listener = investimentos
      setTimeout(() => callback({
        docs: investimentos.map(e => ({ id: e.id, data: () => { const {id,...r}=e; return r; } }))
      }), 10);
    } else {
      setTimeout(() => callback({ docs: [] }), 10);
    }
    return () => {};
  }
  export function query() { return {}; }
  export function serverTimestamp() { return { seconds: Date.now()/1000 }; }
`;

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
    r.fulfill({ contentType: "application/javascript", body: MOCK_FIRESTORE }));
  await page.route("**/js/firebase-config.js", r =>
    r.fulfill({ contentType: "application/javascript", body: `export const firebaseConfig={};` }));

  await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(800);

  // Navigate to Investments view
  await page.click('.nav-item[data-view="investments"]');
  await page.waitForTimeout(1000);

  let passed = 0, failed = 0;
  function check(label, actual, expected, tolerance = 0.01) {
    const ok = Math.abs(actual - expected) < tolerance;
    if (ok) { console.log(`  ✓ ${label}: ${actual} === ${expected}`); passed++; }
    else { console.log(`  ✗ ${label}: got ${actual}, expected ${expected}`); failed++; }
  }

  // ================================================================
  // CHECK: Total Investido KPI
  // ================================================================
  console.log("\n=== INVESTMENT KPIs ===");
  const invTotal = await page.evaluate(() =>
    document.getElementById('kpi-inv-total')?.textContent || ''
  );
  check("Total Investido", parseBRL(invTotal), 900);

  // ================================================================
  // CHECK: Carteira por banco — product grouping
  // ================================================================
  console.log("\n=== CARTEIRA POR BANCO ===");
  const carteira = await page.evaluate(() => {
    const groups = document.querySelectorAll('#inv-by-bank .inv-bank-group');
    const result = [];
    groups.forEach(g => {
      const bankName = g.querySelector('.inv-bank-header span:first-child')?.textContent?.trim() || '';
      const bankTotal = g.querySelector('.bank-total')?.textContent?.trim() || '';
      const products = [];
      g.querySelectorAll('.inv-product-row').forEach(row => {
        products.push({
          name: row.querySelector('.prod-name')?.textContent?.trim() || '',
          value: row.querySelector('.prod-value')?.textContent?.trim() || ''
        });
      });
      result.push({ bankName, bankTotal, products });
    });
    return result;
  });

  console.log("  Carteira structure:");
  carteira.forEach(g => {
    console.log(`    ${g.bankName}: ${g.bankTotal}`);
    g.products.forEach(p => console.log(`      - ${p.name}: ${p.value}`));
  });

  // Should be exactly ONE bank group (Nubank) with ONE product (Caixinha Reserva) = R$900
  check("Number of bank groups", carteira.length, 1);
  if (carteira.length >= 1) {
    check("Bank group is Nubank", carteira[0].bankName === "Nubank" ? 1 : 0, 1);
    check("Bank group total", parseBRL(carteira[0].bankTotal), 900);
    check("Number of products in group", carteira[0].products.length, 1);
    if (carteira[0].products.length >= 1) {
      check("Product name", carteira[0].products[0].name === "Caixinha Reserva" ? 1 : 0, 1);
      check("Product saldo", parseBRL(carteira[0].products[0].value), 900);
    }
  }

  // ================================================================
  // CHECK: Bank card totals (from overview)
  // ================================================================
  console.log("\n=== BANK CARD TOTALS (overview) ===");
  await page.click('.nav-item[data-view="overview"]');
  await page.waitForTimeout(1000);

  const bankTotals = await page.evaluate(() => {
    const container = document.getElementById('bank-cards-total');
    if (!container) return {};
    const cards = {};
    container.querySelectorAll('.bank-card').forEach(card => {
      const name = card.querySelector('.bank-name')?.textContent?.trim() || '';
      const value = card.querySelector('.bank-value')?.textContent?.trim() || '';
      cards[name] = value;
    });
    return cards;
  });

  console.log("  Bank card totals:", JSON.stringify(bankTotals));
  // Nubank: aporte -1000 (money left the account)
  if (bankTotals['Nubank']) check("Nubank bank total", parseBRL(bankTotals['Nubank']), -1000);
  // Inter: retirada +100 (money returned to this account)
  if (bankTotals['Inter']) check("Inter bank total", parseBRL(bankTotals['Inter']), 100);

  // ================================================================
  // CHECK: Patrimônio Total = bank balances + investment balance
  // ================================================================
  console.log("\n=== PATRIMÔNIO ===");
  const patrimonio = await page.evaluate(() =>
    document.getElementById('kpi-patrimonio')?.textContent || ''
  );
  // Bank deltas: nubank -1000, inter +100 → sum = -900
  // Investment balance: 1000 - 100 = 900
  // Patrimônio = -900 + 900 = 0
  check("Patrimônio Total", parseBRL(patrimonio), 0);

  // Take screenshot of investments view
  await page.click('.nav-item[data-view="investments"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS, "invest-retirada-fix.png"), fullPage: false });

  // ================================================================
  // CHECK: Modal auto-fill for retirada
  // ================================================================
  console.log("\n=== MODAL RETIRADA AUTO-FILL ===");
  await page.click("#fab-add");
  await page.waitForTimeout(300);

  // Switch to Retirada
  await page.click('#modal-investimento [data-inv-mov="retirada"]');
  await page.waitForTimeout(100);

  // Type product name that matches existing
  await page.fill('#inv-produto', 'Caixinha Reserva');
  await page.waitForTimeout(200);

  // The bancoInvestimento should auto-fill to nubank (where the product lives)
  const autoFilledBank = await page.evaluate(() =>
    document.getElementById('inv-banco-investimento').value
  );
  check("Auto-fill banco investimento for known product", autoFilledBank === "nubank" ? 1 : 0, 1);

  // Now change banco-origem (destino for retirada) — should NOT overwrite bancoInvestimento
  await page.selectOption('#inv-banco-origem', 'inter');
  await page.waitForTimeout(100);
  const afterChangeBank = await page.evaluate(() =>
    document.getElementById('inv-banco-investimento').value
  );
  check("bancoInvestimento preserved after changing destino", afterChangeBank === "nubank" ? 1 : 0, 1);

  await page.click('#modal-investimento .modal-close');

  // ================================================================
  // REPORT
  // ================================================================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) console.log(`Page errors: ${errors.join("; ")}`);
  console.log(`${"=".repeat(50)}`);

  if (failed > 0) process.exitCode = 1;

  await browser.close();
  server.close();
}

run().catch(e => { console.error(e); process.exitCode = 1; });
