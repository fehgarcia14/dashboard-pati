const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8809;
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

function buildMocks(perfilInicial) {
  return `
  let snapshotCount = 0;
  let docSnapshotCb = null;
  window.__updateDocCalls = [];

  export function getFirestore() { return {}; }
  export function doc(...args) {
    if (args.length >= 3 && args[1] === "usuarios") return { __pagoDoc: true, uid: args[2] };
    return {};
  }
  export function getDoc() {
    return Promise.resolve({
      exists: () => true,
      data: () => ({ nome: 'Teste Preview', area: '${perfilInicial === "geral" ? "Advogado" : "esteticista"}', perfilNegocio: '${perfilInicial}', orcamentos: {} })
    });
  }
  export function setDoc() { return Promise.resolve(); }
  export function updateDoc(ref, data) {
    window.__updateDocCalls.push(JSON.stringify(data));
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
  const fakeUser = { uid: "test-uid-preview", email: "teste@preview.com", displayName: "Teste Preview" };
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

(async () => {
  console.log("=== TESTES: Pré-visualização no modo demo ===\n");
  let totalPassed = 0, totalFailed = 0;

  // ---- TEST 1: User starts as "salao", previews "geral", then back ----
  {
    console.log("====== TESTE 1: Salão → preview Geral → volta Salão ======");
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

    // Toggle exists
    const previewBtns = await page.$$(".preview-btn");
    assert(previewBtns.length === 2, "Toggle de pré-visualização tem 2 botões");

    // Initial state: "Salão" is active
    const salaoActive = await page.$eval('[data-preview="salao"]', el => el.classList.contains("active"));
    assert(salaoActive, "Botão 'Salão' está ativo inicialmente");

    // Agenda visible, Calcular preço visible
    const agendaVisible = await page.$eval('[data-view="agenda"]', el => el.style.display !== "none");
    assert(agendaVisible, "Agenda visível no perfil salão");
    const calcVisible = await page.$eval("#btn-calc-preco", el => el.style.display !== "none");
    assert(calcVisible, "Calcular preço visível no perfil salão");

    // Sidebar color is the rosa/vinho
    const sidebarBgBefore = await page.$eval(".sidebar", el => getComputedStyle(el).backgroundColor);

    // Screenshot initial state
    await page.screenshot({ path: path.join(SCREENSHOTS, "preview-salao-desktop.png"), fullPage: false });
    console.log("  📸 Screenshot desktop Salão (estado inicial)");

    // Click "Geral" preview
    await page.click('[data-preview="geral"]');
    await page.waitForTimeout(500);

    // Now "Geral" should be active in toggle
    const geralActive = await page.$eval('[data-preview="geral"]', el => el.classList.contains("active"));
    assert(geralActive, "Botão 'Geral' fica ativo após clique");
    const salaoInactive = await page.$eval('[data-preview="salao"]', el => !el.classList.contains("active"));
    assert(salaoInactive, "Botão 'Salão' fica inativo após trocar");

    // Agenda hidden, Calcular preço hidden
    const agendaHidden = await page.$eval('[data-view="agenda"]', el => el.style.display === "none");
    assert(agendaHidden, "Agenda escondida no preview geral");
    const calcHidden = await page.$eval("#btn-calc-preco", el => el.style.display === "none");
    assert(calcHidden, "Calcular preço escondido no preview geral");

    // data-perfil should be "geral"
    const perfilAttr = await page.getAttribute("html", "data-perfil");
    assert(perfilAttr === "geral", 'data-perfil="geral" no HTML');

    // Sidebar color changed to blue
    const sidebarBgAfter = await page.$eval(".sidebar", el => getComputedStyle(el).backgroundColor);
    assert(sidebarBgAfter.includes("30, 58, 95") || sidebarBgAfter.includes("30,58,95"), `Sidebar azul-marinho (${sidebarBgAfter})`);

    // Purchase button "Geral" should be highlighted
    const btnGeralSelected = await page.$eval("#btn-comprar-geral", el => el.classList.contains("selected"));
    assert(btnGeralSelected, "Botão comprar 'Geral' destacado ao previsar geral");

    // NO updateDoc calls should have happened (preview is local only)
    const updateCalls = await page.evaluate(() => window.__updateDocCalls.length);
    assert(updateCalls === 0, `Nenhum updateDoc chamado (preview é local) — chamadas: ${updateCalls}`);

    // Screenshot geral preview
    await page.screenshot({ path: path.join(SCREENSHOTS, "preview-geral-desktop.png"), fullPage: false });
    console.log("  📸 Screenshot desktop Geral (preview)");

    // Mobile screenshot
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, "preview-geral-mobile.png"), fullPage: false });
    console.log("  📸 Screenshot mobile Geral (preview)");

    // Switch back to "Salão"
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    await page.click('[data-preview="salao"]');
    await page.waitForTimeout(500);

    // Agenda visible again
    const agendaBack = await page.$eval('[data-view="agenda"]', el => el.style.display !== "none");
    assert(agendaBack, "Agenda visível de volta ao clicar Salão");

    const calcBack = await page.$eval("#btn-calc-preco", el => el.style.display !== "none");
    assert(calcBack, "Calcular preço visível de volta");

    const perfilBack = await page.getAttribute("html", "data-perfil");
    assert(perfilBack === "salao", 'data-perfil="salao" restaurado');

    // Still no Firestore writes
    const updateCalls2 = await page.evaluate(() => window.__updateDocCalls.length);
    assert(updateCalls2 === 0, `Ainda nenhum updateDoc após voltar — chamadas: ${updateCalls2}`);

    // Screenshot back to salao
    await page.screenshot({ path: path.join(SCREENSHOTS, "preview-volta-salao-desktop.png"), fullPage: false });
    console.log("  📸 Screenshot desktop Salão (volta)");

    console.log(`\n  Resultado: ${passed} passaram, ${failed} falharam`);
    totalPassed += passed; totalFailed += failed;
    await browser.close();
    server.close();
  }

  // ---- TEST 2: User starts as "geral", previews "salao" ----
  {
    console.log("\n====== TESTE 2: Geral → preview Salão ======");
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let passed = 0, failed = 0;

    function assert(cond, msg) {
      if (cond) { console.log(`  ✅ ${msg}`); passed++; }
      else { console.log(`  ❌ ${msg}`); failed++; }
    }

    await setupPage(context, "geral");
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Initial: geral active, agenda hidden
    const geralInit = await page.$eval('[data-preview="geral"]', el => el.classList.contains("active"));
    assert(geralInit, "Botão 'Geral' ativo inicialmente (perfil do usuário)");
    const agendaInit = await page.$eval('[data-view="agenda"]', el => el.style.display === "none");
    assert(agendaInit, "Agenda escondida inicialmente (perfil geral)");

    // Click "Salão" preview
    await page.click('[data-preview="salao"]');
    await page.waitForTimeout(500);

    // Agenda visible, calc visible
    const agendaNow = await page.$eval('[data-view="agenda"]', el => el.style.display !== "none");
    assert(agendaNow, "Agenda visível após preview Salão");
    const calcNow = await page.$eval("#btn-calc-preco", el => el.style.display !== "none");
    assert(calcNow, "Calcular preço visível após preview Salão");

    // No Firestore writes
    const calls = await page.evaluate(() => window.__updateDocCalls.length);
    assert(calls === 0, `Nenhum updateDoc chamado — chamadas: ${calls}`);

    // Screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS, "preview-salao-from-geral-desktop.png"), fullPage: false });
    console.log("  📸 Screenshot desktop Salão (preview a partir de perfil geral)");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, "preview-salao-from-geral-mobile.png"), fullPage: false });
    console.log("  📸 Screenshot mobile Salão (preview a partir de perfil geral)");

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
