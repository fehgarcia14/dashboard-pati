const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8801;
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

// ================================================================
// Scenario entries — injected progressively to simulate the user's
// 7-step test plan.
// ================================================================

// Step 1: Entrada R$5000 Nubank (salário)
const e1 = { id:'s1', movimento:'entrada', tipo:'profissional', categoria:'salario', valor:5000, data:ds(Y,M,5),
  banco:'nubank', formaPagamento:'pix', statusPagamento:'pago', fixo:false, descricao:'Salário',
  criadoEm:{seconds:Date.now()/1000-1000} };

// Step 2: Saída R$1000 Inter (despesa pessoal débito)
const e2 = { id:'s2', movimento:'saida', tipo:'pessoal', categoria:'alimentacao', valor:1000, data:ds(Y,M,6),
  banco:'inter', formaPagamento:'debito', statusPagamento:'pago', fixo:false, descricao:'Supermercado',
  criadoEm:{seconds:Date.now()/1000-900} };

// Step 3: Atendimento R$300, recebido=false initially — then confirmed Nubank
// When confirmed, creates a lancamento:
const e3 = { id:'s3', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:300, data:ds(Y,M,8),
  banco:'nubank', formaPagamento:'pix', statusPagamento:'pago', fixo:false, descricao:'Ana — 1x Limpeza',
  origemAgendaId:'a1', criadoEm:{seconds:Date.now()/1000-800} };

// Step 4: Compra crédito R$600 3x Nubank — parcela 1 paga do Inter
const groupId = 'grp-test-1';
const e4a = { id:'s4a', movimento:'saida', tipo:'pessoal', categoria:'roupas', valor:200, data:ds(Y,M,10),
  banco:'nubank', formaPagamento:'credito', statusPagamento:'pago', fixo:false, descricao:'Roupas 1/3',
  grupoParcelaId:groupId, parcelaAtual:1, parcelaTotal:3, valorCompraOriginal:600,
  bancoPagamento:'inter', criadoEm:{seconds:Date.now()/1000-700} };
const e4b = { id:'s4b', movimento:'saida', tipo:'pessoal', categoria:'roupas', valor:200, data:ds(Y,M+1,10),
  banco:'nubank', formaPagamento:'credito', statusPagamento:'pendente', fixo:false, descricao:'Roupas 2/3',
  grupoParcelaId:groupId, parcelaAtual:2, parcelaTotal:3, valorCompraOriginal:600,
  bancoPagamento:null, criadoEm:{seconds:Date.now()/1000-700} };
const e4c = { id:'s4c', movimento:'saida', tipo:'pessoal', categoria:'roupas', valor:200, data:ds(Y,M+2,10),
  banco:'nubank', formaPagamento:'credito', statusPagamento:'pendente', fixo:false, descricao:'Roupas 3/3',
  grupoParcelaId:groupId, parcelaAtual:3, parcelaTotal:3, valorCompraOriginal:600,
  bancoPagamento:null, criadoEm:{seconds:Date.now()/1000-700} };

// Step 5: Aporte investimento R$200, origem Nubank, destino Nubank
const inv1 = { id:'i1', bancoOrigem:'nubank', bancoInvestimento:'nubank', banco:'nubank',
  produto:'CDB Nubank', movimento:'aporte', valor:200, data:ds(Y,M,12), observacao:'',
  criadoEm:{seconds:Date.now()/1000-600} };

// All entries after all steps
const allStepEntries = [e1, e2, e3, e4a, e4b, e4c];
const allStepInvestimentos = [inv1];

// Expected math after all steps:
//
// entrySaldoImpact for each entry:
//   e1: entrada, pix  → banco=nubank, delta=+5000
//   e2: saida, debito  → banco=inter,  delta=-1000
//   e3: entrada, pix   → banco=nubank, delta=+300
//   e4a: saida, credito, pago → banco=inter (bancoPagamento), delta=-200
//   e4b: saida, credito, pendente → banco=null, delta=0
//   e4c: saida, credito, pendente → banco=null, delta=0
//
// Bank balances from lancamentos:
//   nubank: +5000 +300 = +5300
//   inter:  -1000 -200 = -1200
//
// Investment impact on bank balances:
//   inv1 aporte from nubank: nubank -= 200
//
// TOTAL bank balances:
//   nubank: 5300 - 200 = 5100
//   inter:  -1200
//
// Investment balance: aporte 200 - retirada 0 = 200
//
// Patrimônio Total = saldo bancário total + carteira de investimentos
//   saldo bancário = lancamento deltas(+5000 -1000 +300 -200 = +4100) + inv impact(-200) = 3900
//   carteira invest = aporte(200) - retirada(0) = 200
//   Patrimônio = 3900 + 200 = 4100
//
// Bank cards TOTAL (lancamentos + investments):
//   nubank: 5300 - 200 = 5100  (lancamentos give +5300, investments give -200)
//   inter:  -1200

// Period values (current month only):
//   Receitas: 5000 + 300 = 5300
//   Despesas: 1000 + 200(e4a) + 0(e4b next month) + 0(e4c 2 months) = 1200
//     Wait — e4b is next month, e4c is 2 months. Only e4a in current month.
//     Actually despesas = e2(1000) + e4a(200) = 1200
//   Saldo periodo = 5300 - 1200 = 4100

// NEXT MONTH (future):
//   Receitas: 0
//   Despesas: e4b(200) — but it's pendente credit, so in KPI despesas it counts
//     In the period KPI, it uses totalOf(cur.filter(saida)) which sums e4b.valor=200
//   Period bank cards: e4b has delta=0 (pendente), so period bank = 0
//   TOTAL bank cards: same as current (no new confirmed movements)
//   Patrimônio: same as current

const EXPECTED = {
  currentMonth: {
    receitas: 5300,
    despesas: 1200,
    saldo: 4100,
    patrimonio: 4100,
    nubank_total: 5100,
    inter_total: -1200,
  },
  nextMonth: {
    receitas: 0,
    despesas: 200,
    saldo: -200,
    patrimonio: 4100,
    nubank_total: 5100,
    inter_total: -1200,
  }
};

function buildMocks() {
  return `
  let snapshotCount = 0;
  const entries = ${JSON.stringify(allStepEntries)};
  const investimentos = ${JSON.stringify(allStepInvestimentos)};

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
    } else if (snapshotCount === 3) {
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

  // ================================================================
  // TEST CURRENT MONTH
  // ================================================================
  console.log("\n=== CURRENT MONTH ===");

  const kpis = await page.evaluate(() => {
    const txt = id => document.getElementById(id)?.textContent || '';
    return {
      receitas: txt('kpi-receitas'),
      despesas: txt('kpi-despesas'),
      saldo: txt('kpi-saldo'),
      patrimonio: txt('kpi-patrimonio'),
    };
  });

  check("Receitas", parseBRL(kpis.receitas), EXPECTED.currentMonth.receitas);
  check("Despesas", parseBRL(kpis.despesas), EXPECTED.currentMonth.despesas);
  check("Saldo período", parseBRL(kpis.saldo), EXPECTED.currentMonth.saldo);
  check("Patrimônio Total", parseBRL(kpis.patrimonio), EXPECTED.currentMonth.patrimonio);

  // Check bank card totals
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

  console.log("\n  Bank card totals:", JSON.stringify(bankTotals));
  if (bankTotals['Nubank']) check("Nubank total", parseBRL(bankTotals['Nubank']), EXPECTED.currentMonth.nubank_total);
  if (bankTotals['Inter']) check("Inter total", parseBRL(bankTotals['Inter']), EXPECTED.currentMonth.inter_total);

  await page.screenshot({ path: path.join(SCREENSHOTS, "audit-current-month.png"), fullPage: false });

  // ================================================================
  // TEST CATEGORY SELECT IN MODAL (current month)
  // ================================================================
  console.log("\n=== MODAL CATEGORIES (current month) ===");
  await page.click("#fab-add");
  await page.waitForTimeout(200);
  await page.click('#modal-entry [data-mov="saida"]');
  await page.waitForTimeout(100);

  const catCount1 = await page.evaluate(() => document.getElementById("entry-categoria").options.length);
  check("Category options (saída pessoal)", catCount1, 8);

  await page.click('#modal-entry [data-tipo="profissional"]');
  await page.waitForTimeout(100);
  const catCount2 = await page.evaluate(() => document.getElementById("entry-categoria").options.length);
  check("Category options (saída profissional)", catCount2, 6);

  await page.click('#modal-entry .modal-close');
  await page.waitForTimeout(200);

  // ================================================================
  // TEST NEXT MONTH (FUTURE)
  // ================================================================
  console.log("\n=== NEXT MONTH (future) ===");

  const nextMonth = (M + 1) % 12;
  const nextYear = M === 11 ? Y + 1 : Y;
  // If the year changes we need to set it too
  if (nextYear !== Y) {
    // Add year to select (it may not exist)
    await page.evaluate((yr) => {
      const sel = document.getElementById('filter-year');
      if (!Array.from(sel.options).some(o => o.value === String(yr))) {
        sel.innerHTML += `<option value="${yr}">${yr}</option>`;
      }
      sel.value = String(yr);
      sel.dispatchEvent(new Event('change'));
    }, nextYear);
    await page.waitForTimeout(200);
  }

  await page.selectOption("#filter-value", String(nextMonth));
  await page.waitForTimeout(1000);

  const kpis2 = await page.evaluate(() => {
    const txt = id => document.getElementById(id)?.textContent || '';
    return {
      receitas: txt('kpi-receitas'),
      despesas: txt('kpi-despesas'),
      saldo: txt('kpi-saldo'),
      patrimonio: txt('kpi-patrimonio'),
    };
  });

  check("Future: Receitas", parseBRL(kpis2.receitas), EXPECTED.nextMonth.receitas);
  check("Future: Despesas", parseBRL(kpis2.despesas), EXPECTED.nextMonth.despesas);
  check("Future: Saldo período", parseBRL(kpis2.saldo), EXPECTED.nextMonth.saldo);
  check("Future: Patrimônio Total", parseBRL(kpis2.patrimonio), EXPECTED.nextMonth.patrimonio);

  const bankTotals2 = await page.evaluate(() => {
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

  console.log("\n  Bank card totals (future):", JSON.stringify(bankTotals2));
  if (bankTotals2['Nubank']) check("Future: Nubank total", parseBRL(bankTotals2['Nubank']), EXPECTED.nextMonth.nubank_total);
  if (bankTotals2['Inter']) check("Future: Inter total", parseBRL(bankTotals2['Inter']), EXPECTED.nextMonth.inter_total);

  // ================================================================
  // TEST MODAL CATEGORIES IN FUTURE MONTH
  // ================================================================
  console.log("\n=== MODAL CATEGORIES (future month) ===");
  await page.click("#fab-add");
  await page.waitForTimeout(200);
  await page.click('#modal-entry [data-mov="saida"]');
  await page.waitForTimeout(100);

  const catFuture = await page.evaluate(() => {
    const sel = document.getElementById("entry-categoria");
    return { count: sel.options.length, first: sel.options[0]?.text || '' };
  });
  check("Future: Category options loaded", catFuture.count, 8);
  console.log(`  First option: "${catFuture.first}"`);

  const dateFuture = await page.evaluate(() => document.getElementById("entry-data").value);
  console.log(`  Default date: ${dateFuture}`);
  // Should default to first day of the future month
  const expectedDate = ds(nextYear, nextMonth, 1);
  check("Future: Default date matches filtered month", dateFuture === expectedDate ? 1 : 0, 1);

  await page.click('#modal-entry .modal-close');
  await page.waitForTimeout(200);

  await page.screenshot({ path: path.join(SCREENSHOTS, "audit-future-month.png"), fullPage: false });

  // ================================================================
  // TEST CONSISTENCY: period panels use same data
  // ================================================================
  console.log("\n=== CONSISTENCY CHECK ===");

  // Go back to current month
  await page.selectOption("#filter-value", String(M));
  await page.waitForTimeout(1000);

  // The period despesas KPI and the sum of category chart legend should match
  const consistency = await page.evaluate(() => {
    const despKPI = document.getElementById('kpi-despesas')?.textContent || '';
    const legendRows = document.querySelectorAll('#legend-categories .legend-row .amt');
    let catSum = 0;
    legendRows.forEach(r => {
      const txt = r.textContent;
      const match = txt.match(/R\$\s*([\d.,]+)/);
      if (match) catSum += parseFloat(match[1].replace(/\./g,'').replace(',','.'));
    });
    return { despKPI, catSum, rowCount: legendRows.length };
  });

  console.log(`  Category legend rows: ${consistency.rowCount}, sum: ${consistency.catSum}`);
  const despVal = parseBRL(consistency.despKPI);
  check("Despesas KPI vs Category chart total", Math.abs(despVal - consistency.catSum) < 1 ? 1 : 0, 1);

  // ================================================================
  // REPORT
  // ================================================================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log(`Page errors: ${errors.length}`);
    errors.forEach(e => console.log(`  ${e}`));
  }
  console.log(`${"=".repeat(50)}`);

  if (failed > 0) process.exitCode = 1;

  await browser.close();
  server.close();
}

run().catch(e => { console.error(e); process.exitCode = 1; });
