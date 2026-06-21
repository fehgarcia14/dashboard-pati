const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8804;
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
// FULL INTEGRATION SCENARIO
// ================================================================
// a. Jan: Entrada salário R$5000, Inter
// b. Feb: Despesa R$500, Inter, débito
// c. Mar: Atendimento R$300, confirmado como recebido no Nubank
//    (simulated as an entry since we can't create atendimentos via mock)
// d. Mar: Compra parcelada R$600 em 3x crédito Nubank
//    - Parcela 1 (Mar): pago, bancoPagamento=nubank
//    - Parcela 2 (Apr): pendente
//    - Parcela 3 (May): pendente
// e. Apr: Aporte investimento R$200, origem Nubank, produto "Reserva" banco Nubank
// f. May: Retirada R$50 da "Reserva", devolve para Inter

const entries = [
  // a. Jan salary
  { id:'ig1', movimento:'entrada', tipo:'profissional', categoria:'salario', valor:5000,
    data:ds(Y,0,5), banco:'inter', formaPagamento:'pix', statusPagamento:'pago',
    fixo:false, descricao:'Salário Janeiro', criadoEm:{seconds:1} },

  // b. Feb expense
  { id:'ig2', movimento:'saida', tipo:'pessoal', categoria:'alimentacao', valor:500,
    data:ds(Y,1,10), banco:'inter', formaPagamento:'debito', statusPagamento:'pago',
    fixo:false, descricao:'Supermercado', criadoEm:{seconds:2} },

  // c. Mar: atendimento confirmado → entry
  { id:'ig3', movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:300,
    data:ds(Y,2,15), banco:'nubank', formaPagamento:'pix', statusPagamento:'pago',
    fixo:false, descricao:'Atendimento Cliente', origemAgendaId:'atend1', criadoEm:{seconds:3} },

  // d. Mar: parcela 1/3 R$200, crédito Nubank, PAGO, bancoPagamento=nubank
  { id:'ig4a', movimento:'saida', tipo:'pessoal', categoria:'roupas', valor:200,
    data:ds(Y,2,20), banco:'nubank', formaPagamento:'credito', statusPagamento:'pago',
    fixo:false, descricao:'Roupas 1/3', grupoParcelaId:'grp-int-1',
    parcelaAtual:1, parcelaTotal:3, valorCompraOriginal:600,
    bancoPagamento:'nubank', criadoEm:{seconds:4} },

  // d. Apr: parcela 2/3 R$200, crédito Nubank, PENDENTE
  { id:'ig4b', movimento:'saida', tipo:'pessoal', categoria:'roupas', valor:200,
    data:ds(Y,3,20), banco:'nubank', formaPagamento:'credito', statusPagamento:'pendente',
    fixo:false, descricao:'Roupas 2/3', grupoParcelaId:'grp-int-1',
    parcelaAtual:2, parcelaTotal:3, valorCompraOriginal:600,
    bancoPagamento:null, criadoEm:{seconds:5} },

  // d. May: parcela 3/3 R$200, crédito Nubank, PENDENTE
  { id:'ig4c', movimento:'saida', tipo:'pessoal', categoria:'roupas', valor:200,
    data:ds(Y,4,20), banco:'nubank', formaPagamento:'credito', statusPagamento:'pendente',
    fixo:false, descricao:'Roupas 3/3', grupoParcelaId:'grp-int-1',
    parcelaAtual:3, parcelaTotal:3, valorCompraOriginal:600,
    bancoPagamento:null, criadoEm:{seconds:6} },
];

const investimentos = [
  // e. Apr: aporte R$200, origem Nubank, produto "Reserva" banco Nubank
  { id:'inv1', bancoOrigem:'nubank', bancoInvestimento:'nubank', banco:'nubank',
    produto:'Reserva', movimento:'aporte', valor:200, data:ds(Y,3,10),
    observacao:'', criadoEm:{seconds:7} },

  // f. May: retirada R$50, devolve para Inter
  { id:'inv2', bancoOrigem:'inter', bancoInvestimento:'nubank', banco:'nubank',
    produto:'Reserva', movimento:'retirada', valor:50, data:ds(Y,4,15),
    observacao:'', criadoEm:{seconds:8} },
];

// ================================================================
// EXPECTED VALUES PER MONTH
// ================================================================
// entrySaldoImpact rules:
//   credito+pendente → delta=0, banco=null
//   credito+pago → delta=-val, banco=bancoPagamento
//   other → delta=±val, banco=e.banco
//
// Entry impacts:
//   ig1: Jan, entrada, pix → inter +5000
//   ig2: Feb, saida, debito → inter -500
//   ig3: Mar, entrada, pix → nubank +300
//   ig4a: Mar, saida, credito, pago → nubank -200 (bancoPagamento=nubank)
//   ig4b: Apr, saida, credito, pendente → delta=0
//   ig4c: May, saida, credito, pendente → delta=0
//
// Investment impacts on banks:
//   inv1: Apr, aporte, origin=nubank → nubank -200
//   inv2: May, retirada, origin=inter → inter +50
//
// Investment portfolio:
//   inv1: aporte +200
//   inv2: retirada -50
//   Portfolio = 150
//
// Cumulative bank saldos (entries + investment bank impact):
//   Jan: inter=5000, nubank=0 → banks total=5000
//   Feb: inter=4500, nubank=0 → banks total=4500
//   Mar: inter=4500, nubank=100 (300-200) → banks total=4600
//   Apr: inter=4500, nubank=-100 (100-200 aporte) → banks total=4400
//   May: inter=4550 (4500+50 retirada), nubank=-100 → banks total=4450
//   Jun+: same as May (no new entries)
//
// Patrimônio = banks total + portfolio
//   Jan: 5000 + 0 = 5000
//   Feb: 4500 + 0 = 4500
//   Mar: 4600 + 0 = 4600
//   Apr: 4400 + 200 = 4600
//   May: 4450 + 150 = 4600
//   Jun: same = 4600

const EXPECTED = {
  jan:  { inter: 5000, nubank: null, patrimonio: 5000 },
  feb:  { inter: 4500, nubank: null, patrimonio: 4500 },
  mar:  { inter: 4500, nubank: 100,  patrimonio: 4600 },
  apr:  { inter: 4500, nubank: -100, patrimonio: 4600 },
  may:  { inter: 4550, nubank: -100, patrimonio: 4600 },
  jun:  { inter: 4550, nubank: -100, patrimonio: 4600 },
};

function buildMocks() {
  return `
  let snapshotCount = 0;
  const entries = ${JSON.stringify(entries)};
  const investimentos = ${JSON.stringify(investimentos)};

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

  async function getPatrimonio() {
    return await page.evaluate(() => document.getElementById('kpi-patrimonio')?.textContent || '');
  }

  const monthNames = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO'];
  const monthKeys = ['jan','feb','mar','apr','may','jun'];

  // ================================================================
  // FORWARD PASS: Jan → Jun
  // ================================================================
  console.log("\n========== FORWARD PASS ==========");
  for (let mi = 0; mi < 6; mi++) {
    const key = monthKeys[mi];
    const exp = EXPECTED[key];
    console.log(`\n--- ${monthNames[mi]} ---`);
    await setFilter(mi, Y);

    const interVal = await getBankSaldo('Inter');
    const nubankVal = await getBankSaldo('Nubank');
    const patrimonioVal = await getPatrimonio();

    console.log(`  Inter: ${interVal}, Nubank: ${nubankVal}, Patrimônio: ${patrimonioVal}`);

    if (exp.inter !== null) check(`${monthNames[mi]}: Inter`, parseBRL(interVal), exp.inter);
    else check(`${monthNames[mi]}: Inter absent`, interVal === null ? 1 : 0, 1);

    if (exp.nubank !== null) check(`${monthNames[mi]}: Nubank`, parseBRL(nubankVal), exp.nubank);
    else check(`${monthNames[mi]}: Nubank absent`, nubankVal === null ? 1 : 0, 1);

    check(`${monthNames[mi]}: Patrimônio`, parseBRL(patrimonioVal), exp.patrimonio);

    await page.screenshot({ path: path.join(SCREENSHOTS, `integration-${key}.png`), fullPage: false });
  }

  // ================================================================
  // BACKWARD PASS: Jun → Jan (verify recalculation when going back)
  // ================================================================
  console.log("\n========== BACKWARD PASS ==========");
  for (let mi = 5; mi >= 0; mi--) {
    const key = monthKeys[mi];
    const exp = EXPECTED[key];
    console.log(`\n--- ${monthNames[mi]} (back) ---`);
    await setFilter(mi, Y);

    const interVal = await getBankSaldo('Inter');
    const nubankVal = await getBankSaldo('Nubank');
    const patrimonioVal = await getPatrimonio();

    if (exp.inter !== null) check(`${monthNames[mi]} back: Inter`, parseBRL(interVal), exp.inter);
    else check(`${monthNames[mi]} back: Inter absent`, interVal === null ? 1 : 0, 1);

    if (exp.nubank !== null) check(`${monthNames[mi]} back: Nubank`, parseBRL(nubankVal), exp.nubank);
    else check(`${monthNames[mi]} back: Nubank absent`, nubankVal === null ? 1 : 0, 1);

    check(`${monthNames[mi]} back: Patrimônio`, parseBRL(patrimonioVal), exp.patrimonio);
  }

  // ================================================================
  // TAB CHECKS: verify other tabs don't crash
  // ================================================================
  console.log("\n========== TAB CHECKS ==========");
  const tabs = ['entries','credit-card','investments','agenda','metas','budget','intelligence'];
  const tabNames = ['Lançamentos','Cartão de Crédito','Investimentos','Agenda','Metas','Orçamento','Inteligência'];

  for (let i = 0; i < tabs.length; i++) {
    await page.click(`.nav-item[data-view="${tabs[i]}"]`);
    await page.waitForTimeout(500);
    const hasError = errors.length;
    const viewVisible = await page.evaluate((v) => {
      const el = document.getElementById(`view-${v}`);
      return el && el.style.display !== 'none';
    }, tabs[i]);
    console.log(`  ${tabNames[i]}: ${viewVisible ? 'OK' : 'HIDDEN'} ${errors.length > hasError ? '(JS errors!)' : ''}`);
    check(`Tab ${tabNames[i]} visible`, viewVisible ? 1 : 0, 1);
  }

  // Go back to overview
  await page.click('.nav-item[data-view="overview"]');
  await page.waitForTimeout(300);

  // ================================================================
  // INVESTMENT TAB: verify carteira shows Reserva with correct value
  // ================================================================
  console.log("\n========== INVESTMENT CARTEIRA ==========");
  await page.click('.nav-item[data-view="investments"]');
  await page.waitForTimeout(800);

  const invTotal = await page.evaluate(() =>
    document.getElementById('kpi-inv-total')?.textContent || ''
  );
  console.log(`  Total Investido: ${invTotal}`);
  check("Investment: Total Investido", parseBRL(invTotal), 150);

  await page.screenshot({ path: path.join(SCREENSHOTS, "integration-investments.png"), fullPage: false });

  // ================================================================
  // CREDIT CARD TAB: verify parcelamento shows
  // ================================================================
  console.log("\n========== CREDIT CARD ==========");
  await page.click('.nav-item[data-view="credit-card"]');
  await page.waitForTimeout(800);

  const parcelCount = await page.evaluate(() =>
    document.getElementById('parcel-count')?.textContent || ''
  );
  console.log(`  Parcelamentos: ${parcelCount}`);
  check("CreditCard: has active parcelamento", parcelCount.includes('1') ? 1 : 0, 1);

  await page.screenshot({ path: path.join(SCREENSHOTS, "integration-creditcard.png"), fullPage: false });

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (errors.length) console.log(`Page errors encountered: ${errors.length}`);
  console.log(`${'='.repeat(50)}\n`);

  await browser.close();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("FATAL:", err); process.exit(1); });
