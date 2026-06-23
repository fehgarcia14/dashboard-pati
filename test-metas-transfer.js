const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8811;
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

function buildMocks(perfil) {
  const today = new Date().toISOString().slice(0, 10);
  return `
  let metaDocs = {};
  let transferDocs = {};
  let docCounter = 0;
  let snapshotCallbacks = {};
  let docSnapshotCb = null;

  export function getFirestore() { return {}; }
  export function doc(...args) {
    if (args.length >= 3 && args[1] === "usuarios" && args.length === 3)
      return { __pagoDoc: true, uid: args[2] };
    if (args.length >= 5)
      return { __col: args[3], __id: args[4] };
    return {};
  }
  export function getDoc() {
    return Promise.resolve({
      exists: () => true,
      data: () => ({ nome: 'Teste Metas', area: 'esteticista', perfilNegocio: '${perfil}', orcamentos: {} })
    });
  }
  export function setDoc() { return Promise.resolve(); }
  export function updateDoc(ref, data) {
    if (ref.__col === "metas" && ref.__id && metaDocs[ref.__id]) {
      Object.assign(metaDocs[ref.__id], data);
      fireMetasSnapshot();
    }
    return Promise.resolve();
  }
  export function collection(db, ...pathSegments) {
    const col = pathSegments[pathSegments.length - 1];
    return { __col: col };
  }
  export function addDoc(colRef, data) {
    docCounter++;
    const id = 'doc-' + docCounter;
    if (colRef.__col === "metas") {
      metaDocs[id] = { ...data };
      fireMetasSnapshot();
    } else if (colRef.__col === "transferencias") {
      transferDocs[id] = { ...data };
      fireTransferSnapshot();
    }
    return Promise.resolve({ id });
  }
  export function deleteDoc(ref) {
    if (ref.__col === "metas") { delete metaDocs[ref.__id]; fireMetasSnapshot(); }
    if (ref.__col === "transferencias") { delete transferDocs[ref.__id]; fireTransferSnapshot(); }
    return Promise.resolve();
  }

  function fireMetasSnapshot() {
    if (snapshotCallbacks["metas"]) {
      snapshotCallbacks["metas"]({
        docs: Object.entries(metaDocs).map(([id, d]) => ({ id, data: () => ({...d}) }))
      });
    }
  }
  function fireTransferSnapshot() {
    if (snapshotCallbacks["transferencias"]) {
      snapshotCallbacks["transferencias"]({
        docs: Object.entries(transferDocs).map(([id, d]) => ({ id, data: () => ({...d}) }))
      });
    }
  }

  export function onSnapshot(ref, callback, errCb) {
    if (ref && ref.__pagoDoc) {
      docSnapshotCb = callback;
      setTimeout(() => callback({
        exists: () => true,
        data: () => ({ pago: true, perfilNegocio: '${perfil}' })
      }), 50);
      return () => {};
    }
    const col = ref?.__col || "unknown";
    snapshotCallbacks[col] = callback;
    // Fire initial empty snapshots for collections
    setTimeout(() => {
      // Entries with bank balances for testing
      if (col === "lancamentos") {
        callback({ docs: [
          { id: 'e1', data: () => ({ movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:3000, data:'${today}', banco:'inter', formaPagamento:'pix', statusPagamento:'pago', descricao:'Receita Inter' }) },
          { id: 'e2', data: () => ({ movimento:'entrada', tipo:'profissional', categoria:'servicos', valor:500, data:'${today}', banco:'nubank', formaPagamento:'pix', statusPagamento:'pago', descricao:'Receita Nubank' }) },
        ]});
      } else {
        callback({ docs: [] });
      }
    }, 50);
    return () => {};
  }
  export function query(ref) { return ref; }
  export function serverTimestamp() { return new Date().toISOString(); }
  `;
}

const FIREBASE_APP_MOCK = `export function initializeApp() { return {}; }`;
const FIREBASE_AUTH_MOCK = `
  const fakeUser = { uid: "test-uid-metas", email: "teste@metas.com", displayName: "Teste Metas" };
  export function getAuth() { return {}; }
  export function onAuthStateChanged(auth, cb) { setTimeout(() => cb(fakeUser), 50); }
  export function signOut() { return Promise.resolve(); }
`;

async function setupPage(context, perfil) {
  await context.route("**/firebasejs/**/firebase-app.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_APP_MOCK }));
  await context.route("**/firebasejs/**/firebase-auth.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_AUTH_MOCK }));
  await context.route("**/firebasejs/**/firebase-firestore.js", r => r.fulfill({ contentType: "application/javascript", body: buildMocks(perfil) }));
  await context.route("**/firebase-config.js", r => r.fulfill({ contentType: "application/javascript", body: `export const firebaseConfig = {};` }));
}

function getBankValue(text) {
  const match = text.match(/R\$\s*[\d.,]+/);
  if (!match) return 0;
  return parseFloat(match[0].replace("R$", "").replace(/\./g, "").replace(",", ".").trim());
}

(async () => {
  console.log("=== TESTES: Metas com banco + Transferências ===\n");
  let totalPassed = 0, totalFailed = 0;

  // ---- TEST 1: Meta lifecycle (create, aporte, lock, resgate) ----
  {
    console.log("====== TESTE 1: Ciclo completo de Meta com banco ======");
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let passed = 0, failed = 0;

    function assert(cond, msg) {
      if (cond) { console.log(`  ✅ ${msg}`); passed++; }
      else { console.log(`  ❌ ${msg}`); failed++; }
    }

    await setupPage(context, "salao");
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Navigate to Metas
    await page.click('[data-view="metas"]');
    await page.waitForTimeout(300);

    // Create a meta
    await page.click(".fab");
    await page.waitForTimeout(300);

    const metaModal = await page.$("#modal-meta");
    const metaActive = metaModal ? await metaModal.evaluate(el => el.classList.contains("active")) : false;
    assert(metaActive, "Modal de meta abre ao clicar + na aba Metas");

    // Check banco field exists
    const bancoSelect = await page.$("#meta-banco");
    assert(!!bancoSelect, "Campo 'Banco' presente no modal de meta");

    // Fill meta form
    await page.fill("#meta-nome", "Viagem");
    await page.fill("#meta-valor-objetivo", "1000");
    await page.fill("#meta-data-limite", "2027-12-31");
    await page.selectOption("#meta-banco", "inter");
    await page.click("#meta-submit");
    await page.waitForTimeout(500);

    // Meta should be visible
    const metaCard = await page.$(".meta-card");
    assert(!!metaCard, "Meta 'Viagem' aparece na lista");

    // Check banco tag
    const bancoTag = await page.$(".meta-banco-tag");
    const bancoText = bancoTag ? await bancoTag.textContent() : "";
    assert(bancoText.includes("Inter"), `Tag do banco mostra 'Inter' (${bancoText})`);

    // Check initial bank balances (Inter: 3000, Nubank: 500)
    await page.click('[data-view="overview"]');
    await page.waitForTimeout(500);
    const bankCardsHtml = await page.$eval("#bank-cards-total", el => el.innerHTML);
    assert(bankCardsHtml.includes("Inter") && bankCardsHtml.includes("3.000"), "Saldo Inter inicial R$ 3.000");

    // Do first aporte (R$ 600)
    await page.click('[data-view="metas"]');
    await page.waitForTimeout(300);
    await page.click("[data-aporte-meta]");
    await page.waitForTimeout(300);
    await page.fill("#aporte-valor", "600");
    await page.click("#aporte-submit");
    await page.waitForTimeout(500);

    // Check meta progress
    let metaCardText = await page.$eval(".meta-card", el => el.textContent);
    assert(metaCardText.includes("600") || metaCardText.includes("60%"), "Meta mostra R$ 600 / 60% após primeiro aporte");

    // Check bank balance: Inter should be 3000 - 600 = 2400
    await page.click('[data-view="overview"]');
    await page.waitForTimeout(500);
    const bankCards2 = await page.$eval("#bank-cards-total", el => el.textContent);
    assert(bankCards2.includes("2.400"), `Inter = R$ 2.400 após aporte (${bankCards2})`);

    // Do second aporte (R$ 400) to complete the meta
    await page.click('[data-view="metas"]');
    await page.waitForTimeout(300);
    await page.click("[data-aporte-meta]");
    await page.waitForTimeout(300);
    await page.fill("#aporte-valor", "400");
    await page.click("#aporte-submit");
    await page.waitForTimeout(500);

    // Meta should be concluida
    metaCardText = await page.$eval(".meta-card", el => el.textContent);
    assert(metaCardText.includes("Meta atingida") || metaCardText.includes("100%"), "Meta mostra 'Meta atingida' / 100%");

    // Aporte button should NOT exist
    const aporteBtn = await page.$("[data-aporte-meta]");
    assert(!aporteBtn, "Botão de aporte NÃO aparece na meta concluída");

    // Resgate button should exist
    const resgateBtn = await page.$("[data-resgate-meta]");
    assert(!!resgateBtn, "Botão 'Resgatar' aparece na meta concluída");

    // Check bank: Inter = 3000 - 600 - 400 = 2000
    await page.click('[data-view="overview"]');
    await page.waitForTimeout(500);
    const bankCards3 = await page.$eval("#bank-cards-total", el => el.textContent);
    assert(bankCards3.includes("2.000"), `Inter = R$ 2.000 após meta completa (${bankCards3})`);

    // Resgate: move to Nubank
    await page.click('[data-view="metas"]');
    await page.waitForTimeout(300);
    await page.click("[data-resgate-meta]");
    await page.waitForTimeout(300);
    await page.selectOption("#resgate-banco", "nubank");
    await page.click("#resgate-submit");
    await page.waitForTimeout(500);

    // Meta should be resgatada
    metaCardText = await page.$eval(".meta-card", el => el.textContent);
    assert(metaCardText.includes("Resgatada"), "Meta mostra 'Resgatada'");

    // Check bank: Nubank = 500 + 1000 = 1500
    await page.click('[data-view="overview"]');
    await page.waitForTimeout(500);
    const bankCards4 = await page.$eval("#bank-cards-total", el => el.textContent);
    assert(bankCards4.includes("1.500"), `Nubank = R$ 1.500 após resgate (${bankCards4})`);

    // Screenshot
    await page.click('[data-view="metas"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, "metas-resgatada.png"), fullPage: false });
    console.log("  📸 Screenshot meta resgatada");

    console.log(`\n  Resultado: ${passed} passaram, ${failed} falharam`);
    totalPassed += passed; totalFailed += failed;
    await browser.close();
    server.close();
  }

  // ---- TEST 2: Transfer between banks ----
  {
    console.log("\n====== TESTE 2: Transferência entre bancos ======");
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let passed = 0, failed = 0;

    function assert(cond, msg) {
      if (cond) { console.log(`  ✅ ${msg}`); passed++; }
      else { console.log(`  ❌ ${msg}`); failed++; }
    }

    await setupPage(context, "salao");
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Transfer button exists
    const transferBtn = await page.$("#btn-transfer");
    assert(!!transferBtn, "Botão 'Transferir entre bancos' existe na Visão Geral");

    // Initial balances: Inter 3000, Nubank 500
    const banksBefore = await page.$eval("#bank-cards-total", el => el.textContent);
    assert(banksBefore.includes("3.000"), "Inter começa com R$ 3.000");
    assert(banksBefore.includes("500"), "Nubank começa com R$ 500");

    // Open transfer modal
    await page.click("#btn-transfer");
    await page.waitForTimeout(300);
    const modalActive = await page.$eval("#modal-transfer", el => el.classList.contains("active"));
    assert(modalActive, "Modal de transferência abre");

    // Transfer R$ 1000 from Inter to Nubank
    await page.selectOption("#transfer-origem", "inter");
    await page.selectOption("#transfer-destino", "nubank");
    await page.fill("#transfer-valor", "1000");
    await page.click("#transfer-submit");
    await page.waitForTimeout(500);

    // Check balances: Inter = 3000 - 1000 = 2000, Nubank = 500 + 1000 = 1500
    const banksAfter = await page.$eval("#bank-cards-total", el => el.textContent);
    assert(banksAfter.includes("2.000"), `Inter = R$ 2.000 após transferência (${banksAfter})`);
    assert(banksAfter.includes("1.500"), `Nubank = R$ 1.500 após transferência (${banksAfter})`);

    // Total should be the same (3500 before, 3500 after)
    // No new entries in Lançamentos
    await page.click('[data-view="entries"]');
    await page.waitForTimeout(300);
    const entriesText = await page.$eval("#entries-tbody", el => el.textContent);
    assert(!entriesText.includes("Transferência"), "Nenhum lançamento de transferência na lista");

    // Screenshot
    await page.click('[data-view="overview"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, "transfer-result.png"), fullPage: false });
    console.log("  📸 Screenshot saldo após transferência");

    console.log(`\n  Resultado: ${passed} passaram, ${failed} falharam`);
    totalPassed += passed; totalFailed += failed;
    await browser.close();
    server.close();
  }

  // ---- TEST 3: Features visible in both profiles ----
  for (const perfil of ["salao", "geral"]) {
    console.log(`\n====== TESTE 3${perfil === "geral" ? "b" : "a"}: Features visíveis no perfil '${perfil}' ======`);
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let passed = 0, failed = 0;

    function assert(cond, msg) {
      if (cond) { console.log(`  ✅ ${msg}`); passed++; }
      else { console.log(`  ❌ ${msg}`); failed++; }
    }

    await setupPage(context, perfil);
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Metas nav visible
    const metasBtn = await page.$('[data-view="metas"]');
    assert(metasBtn && await metasBtn.isVisible(), `Metas visível no perfil ${perfil}`);

    // Transfer button visible
    const transferBtn = await page.$("#btn-transfer");
    assert(transferBtn && await transferBtn.isVisible(), `Transferir entre bancos visível no perfil ${perfil}`);

    // Navigate to Metas, fab opens meta modal
    await page.click('[data-view="metas"]');
    await page.waitForTimeout(300);
    await page.click(".fab");
    await page.waitForTimeout(300);
    const bancoField = await page.$("#meta-banco");
    assert(!!bancoField, `Campo banco na meta funciona no perfil ${perfil}`);
    await page.click('[data-close="modal-meta"]');

    // Screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS, `metas-${perfil}-profile.png`), fullPage: false });
    console.log(`  📸 Screenshot perfil ${perfil}`);

    console.log(`\n  Resultado: ${passed} passaram, ${failed} falharam`);
    totalPassed += passed; totalFailed += failed;
    await browser.close();
    server.close();
  }

  console.log("\n========================================");
  console.log(`TOTAL: ${totalPassed} passaram, ${totalFailed} falharam`);
  if (totalFailed > 0) process.exit(1);
  console.log("========================================\n");
})();
