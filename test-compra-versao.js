const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8808;
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

let lastUpdateDocCall = null;

function buildMocks(perfilInicial) {
  return `
  let snapshotCount = 0;
  let docSnapshotCb = null;

  export function getFirestore() { return {}; }
  export function doc(...args) {
    if (args.length >= 3 && args[1] === "usuarios") return { __pagoDoc: true, uid: args[2] };
    return {};
  }
  export function getDoc() {
    return Promise.resolve({
      exists: () => true,
      data: () => ({ nome: 'Teste Compra', area: '${perfilInicial === "geral" ? "Advogado" : "esteticista"}', perfilNegocio: '${perfilInicial}', orcamentos: {} })
    });
  }
  export function setDoc() { return Promise.resolve(); }
  export function updateDoc(ref, data) {
    window.__lastUpdateDoc = JSON.stringify(data);
    return Promise.resolve();
  }
  export function collection() { return {}; }
  export function addDoc() { return Promise.resolve({ id: 'new-doc' }); }
  export function deleteDoc() { return Promise.resolve(); }
  export function onSnapshot(ref, callback, errCb) {
    if (ref && ref.__pagoDoc) {
      docSnapshotCb = callback;
      setTimeout(() => callback({
        exists: () => true,
        data: () => ({ pago: false, perfilNegocio: '${perfilInicial}' })
      }), 50);
      return () => {};
    }
    snapshotCount++;
    setTimeout(() => callback({ docs: [] }), 50);
    return () => {};
  }
  export function query(ref) { return ref; }
  export function serverTimestamp() { return new Date().toISOString(); }
  `;
}

const FIREBASE_APP_MOCK = `export function initializeApp() { return {}; }`;
const FIREBASE_AUTH_MOCK = `
  const fakeUser = { uid: "test-uid-compra", email: "teste@compra.com", displayName: "Teste Compra" };
  export function getAuth() { return {}; }
  export function onAuthStateChanged(auth, cb) { setTimeout(() => cb(fakeUser), 50); }
  export function signOut() { return Promise.resolve(); }
`;

(async () => {
  console.log("=== TESTES: Escolha de versão na compra ===\n");
  let totalPassed = 0, totalFailed = 0;

  // ---- TEST 1: Banner shows both buttons, geral user picks salao ----
  {
    console.log("====== TESTE 1: Usuário 'geral' vê banner e troca para 'salao' ======");
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let passed = 0, failed = 0;

    function assert(cond, msg) {
      if (cond) { console.log(`  ✅ ${msg}`); passed++; }
      else { console.log(`  ❌ ${msg}`); failed++; }
    }

    await context.route("**/firebasejs/**/firebase-app.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_APP_MOCK }));
    await context.route("**/firebasejs/**/firebase-auth.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_AUTH_MOCK }));
    await context.route("**/firebasejs/**/firebase-firestore.js", r => r.fulfill({ contentType: "application/javascript", body: buildMocks("geral") }));
    await context.route("**/firebase-config.js", r => r.fulfill({ contentType: "application/javascript", body: `export const firebaseConfig = {};` }));
    await context.route("**/api/create-preference", async r => {
      await new Promise(ok => setTimeout(ok, 2000));
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ init_point: "https://example.com/checkout" })
      });
    });

    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Both buttons should exist
    const btnSalao = await page.$("#btn-comprar-salao");
    const btnGeral = await page.$("#btn-comprar-geral");
    assert(!!btnSalao, "Botão 'Comprar versão Salão' existe");
    assert(!!btnGeral, "Botão 'Comprar versão Geral' existe");

    // Geral should be pre-selected (user's current profile)
    const geralSelected = await page.$eval("#btn-comprar-geral", el => el.classList.contains("selected"));
    assert(geralSelected, "Botão 'Geral' está pré-selecionado (perfil do usuário)");

    const salaoNotSelected = await page.$eval("#btn-comprar-salao", el => !el.classList.contains("selected"));
    assert(salaoNotSelected, "Botão 'Salão' NÃO está pré-selecionado");

    // Screenshot desktop with banner
    await page.screenshot({ path: path.join(SCREENSHOTS, "banner-compra-geral-desktop.png"), fullPage: false });
    console.log("  📸 Screenshot desktop (perfil geral) salvo");

    // Mobile screenshot
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, "banner-compra-geral-mobile.png"), fullPage: false });
    console.log("  📸 Screenshot mobile (perfil geral) salvo");

    // Click "Comprar versão Salão" — updateDoc is called before the fetch
    // The fetch route has a 2s delay so we can read __lastUpdateDoc before navigation
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);

    await page.click("#btn-comprar-salao");
    // updateDoc resolves instantly (mock), then fetch starts (2s delay before response)
    await page.waitForTimeout(500);

    const updateData = await page.evaluate(() => window.__lastUpdateDoc);
    const parsed = updateData ? JSON.parse(updateData) : null;
    assert(parsed && parsed.perfilNegocio === "salao", `updateDoc chamado com perfilNegocio: "salao" (recebido: ${updateData})`);

    console.log(`\n  Resultado: ${passed} passaram, ${failed} falharam`);
    totalPassed += passed; totalFailed += failed;
    await browser.close();
    server.close();
  }

  // ---- TEST 2: Banner with salao profile ----
  {
    console.log("\n====== TESTE 2: Usuário 'salao' vê banner ======");
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let passed = 0, failed = 0;

    function assert(cond, msg) {
      if (cond) { console.log(`  ✅ ${msg}`); passed++; }
      else { console.log(`  ❌ ${msg}`); failed++; }
    }

    await context.route("**/firebasejs/**/firebase-app.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_APP_MOCK }));
    await context.route("**/firebasejs/**/firebase-auth.js", r => r.fulfill({ contentType: "application/javascript", body: FIREBASE_AUTH_MOCK }));
    await context.route("**/firebasejs/**/firebase-firestore.js", r => r.fulfill({ contentType: "application/javascript", body: buildMocks("salao") }));
    await context.route("**/firebase-config.js", r => r.fulfill({ contentType: "application/javascript", body: `export const firebaseConfig = {};` }));

    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const salaoSelected = await page.$eval("#btn-comprar-salao", el => el.classList.contains("selected"));
    assert(salaoSelected, "Botão 'Salão' está pré-selecionado (perfil do usuário)");

    const geralNotSelected = await page.$eval("#btn-comprar-geral", el => !el.classList.contains("selected"));
    assert(geralNotSelected, "Botão 'Geral' NÃO está pré-selecionado");

    // Screenshot desktop
    await page.screenshot({ path: path.join(SCREENSHOTS, "banner-compra-salao-desktop.png"), fullPage: false });
    console.log("  📸 Screenshot desktop (perfil salão) salvo");

    // Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, "banner-compra-salao-mobile.png"), fullPage: false });
    console.log("  📸 Screenshot mobile (perfil salão) salvo");

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
