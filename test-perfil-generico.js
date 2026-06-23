const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8807;
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
  const perfilValue = perfil === "geral" ? "geral" : "salao";
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
      data: () => ({ nome: 'Teste Perfil', area: '${perfil === "geral" ? "Advogado" : "esteticista"}', perfilNegocio: '${perfilValue}', orcamentos: {} })
    });
  }
  export function setDoc() { return Promise.resolve(); }
  export function updateDoc() { return Promise.resolve(); }
  export function collection() { return {}; }
  export function addDoc() { return Promise.resolve({ id: 'new-doc' }); }
  export function deleteDoc() { return Promise.resolve(); }
  export function onSnapshot(ref, callback, errCb) {
    if (ref && ref.__pagoDoc) {
      const pagoValue = true;
      docSnapshotCb = callback;
      setTimeout(() => callback({
        exists: () => true,
        data: () => ({ pago: pagoValue, perfilNegocio: '${perfilValue}' })
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

const FIREBASE_APP_MOCK = `
  export function initializeApp() { return {}; }
`;

const FIREBASE_AUTH_MOCK = `
  const fakeUser = { uid: "test-uid-perfil", email: "teste@perfil.com", displayName: "Teste Perfil" };
  export function getAuth() { return {}; }
  export function onAuthStateChanged(auth, cb) { setTimeout(() => cb(fakeUser), 50); }
  export function signOut() { return Promise.resolve(); }
`;

async function runTest(perfil) {
  const label = perfil === "geral" ? "GERAL" : "SALÃO";
  console.log(`\n====== TESTE PERFIL ${label} ======`);

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  await context.route("**/firebasejs/**/firebase-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: FIREBASE_APP_MOCK })
  );
  await context.route("**/firebasejs/**/firebase-auth.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: FIREBASE_AUTH_MOCK })
  );
  await context.route("**/firebasejs/**/firebase-firestore.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: buildMocks(perfil) })
  );
  await context.route("**/firebase-config.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `export const firebaseConfig = {};` })
  );

  const page = await context.newPage();
  let passed = 0, failed = 0;

  function assert(condition, msg) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.log(`  ❌ ${msg}`); failed++; }
  }

  // ---- Test dashboard.html directly (mocks bypass auth redirect) ----
  await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Check sidebar nav items
  const agendaBtn = await page.$('button[data-view="agenda"]');
  const agendaVisible = agendaBtn ? await agendaBtn.isVisible() : false;

  if (perfil === "geral") {
    assert(!agendaVisible, "Agenda NÃO aparece no menu lateral");
  } else {
    assert(agendaVisible, "Agenda aparece no menu lateral");
  }

  // Check "Calcular preço" button
  const calcBtn = await page.$("#btn-calc-preco");
  const calcVisible = calcBtn ? await calcBtn.isVisible() : false;

  if (perfil === "geral") {
    assert(!calcVisible, "Botão 'Calcular preço' NÃO aparece na Visão Geral");
  } else {
    assert(calcVisible, "Botão 'Calcular preço' aparece na Visão Geral");
  }

  // Check data-perfil attribute on <html>
  const perfilAttr = await page.getAttribute("html", "data-perfil");
  assert(perfilAttr === perfil, `Atributo data-perfil="${perfil}" presente no HTML`);

  // Check that common features still exist
  const lancamentosBtn = await page.$('button[data-view="entries"]');
  assert(lancamentosBtn && await lancamentosBtn.isVisible(), "Lançamentos aparece no menu");

  const ccBtn = await page.$('button[data-view="credit-card"]');
  assert(ccBtn && await ccBtn.isVisible(), "Cartão de Crédito aparece no menu");

  const invBtn = await page.$('button[data-view="investments"]');
  assert(invBtn && await invBtn.isVisible(), "Investimentos aparece no menu");

  const metasBtn = await page.$('button[data-view="metas"]');
  assert(metasBtn && await metasBtn.isVisible(), "Metas aparece no menu");

  const budgetBtn = await page.$('button[data-view="budget"]');
  assert(budgetBtn && await budgetBtn.isVisible(), "Orçamento aparece no menu");

  const intelBtn = await page.$('button[data-view="intelligence"]');
  assert(intelBtn && await intelBtn.isVisible(), "Inteligência aparece no menu");

  // Check sidebar color for perfil geral
  if (perfil === "geral") {
    const sidebarBg = await page.$eval(".sidebar", el => getComputedStyle(el).backgroundColor);
    assert(sidebarBg.includes("30, 58, 95") || sidebarBg.includes("30,58,95"), `Sidebar usa cor azul-marinho (${sidebarBg})`);
  }

  // Screenshot desktop
  await page.screenshot({ path: path.join(SCREENSHOTS, `perfil-${perfil}-desktop.png`), fullPage: true });
  console.log(`  📸 Screenshot desktop salvo: screenshots/perfil-${perfil}-desktop.png`);

  // Screenshot mobile
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENSHOTS, `perfil-${perfil}-mobile.png`), fullPage: true });
  console.log(`  📸 Screenshot mobile salvo: screenshots/perfil-${perfil}-mobile.png`);

  // Navigate to other views to confirm they work
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);

  if (lancamentosBtn) {
    await lancamentosBtn.click();
    await page.waitForTimeout(300);
    const entriesView = await page.$("#view-entries");
    const entriesActive = entriesView ? await entriesView.evaluate(el => el.classList.contains("active")) : false;
    assert(entriesActive, "Navegação para Lançamentos funciona");
  }

  if (metasBtn) {
    await metasBtn.click();
    await page.waitForTimeout(300);
    const metasView = await page.$("#view-metas");
    const metasActive = metasView ? await metasView.evaluate(el => el.classList.contains("active")) : false;
    assert(metasActive, "Navegação para Metas funciona");
  }

  console.log(`\n  Resultado: ${passed} passaram, ${failed} falharam`);

  await browser.close();
  server.close();
  return { passed, failed };
}

// ---- Test signup page profile selector ----
async function testSignupSelector() {
  console.log("\n====== TESTE SELETOR DE PERFIL (CADASTRO) ======");

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let passed = 0, failed = 0;

  function assert(condition, msg) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.log(`  ❌ ${msg}`); failed++; }
  }

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "domcontentloaded" });

  // Click "Criar conta" tab
  await page.click('[data-target="signup-form-wrap"]');
  await page.waitForTimeout(300);

  // Check perfil cards exist
  const cards = await page.$$(".perfil-card");
  assert(cards.length === 2, "Dois cards de perfil presentes no cadastro");

  // Default should be salao
  const perfilValue = await page.$eval("#signup-perfil", el => el.value);
  assert(perfilValue === "salao", "Perfil padrão é 'salao'");

  // Area select should be visible for salao
  const areaFieldVisible = await page.$eval("#field-area", el => el.style.display !== "none");
  assert(areaFieldVisible, "Campo 'Área de atuação' visível para perfil salão");

  // Click "Outra profissão"
  await page.click('[data-perfil="geral"]');
  await page.waitForTimeout(200);

  const perfilValueAfter = await page.$eval("#signup-perfil", el => el.value);
  assert(perfilValueAfter === "geral", "Perfil muda para 'geral' ao clicar");

  const areaFieldHidden = await page.$eval("#field-area", el => el.style.display === "none");
  assert(areaFieldHidden, "Campo 'Área de atuação' escondido para perfil geral");

  const geralFieldVisible = await page.$eval("#field-area-geral", el => el.style.display !== "none");
  assert(geralFieldVisible, "Campo 'Profissão' visível para perfil geral");

  // Switch back to salao
  await page.click('[data-perfil="salao"]');
  await page.waitForTimeout(200);
  const backToSalao = await page.$eval("#signup-perfil", el => el.value);
  assert(backToSalao === "salao", "Perfil volta para 'salao' ao clicar de volta");

  // Screenshot
  await page.click('[data-perfil="geral"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SCREENSHOTS, "signup-perfil-geral.png"), fullPage: true });
  console.log("  📸 Screenshot signup perfil geral salvo");

  await page.click('[data-perfil="salao"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SCREENSHOTS, "signup-perfil-salao.png"), fullPage: true });
  console.log("  📸 Screenshot signup perfil salão salvo");

  console.log(`\n  Resultado: ${passed} passaram, ${failed} falharam`);

  await browser.close();
  server.close();
  return { passed, failed };
}

(async () => {
  console.log("=== TESTES: Perfil Genérico (Salão vs Geral) ===\n");

  const r1 = await testSignupSelector();
  const r2 = await runTest("geral");
  const r3 = await runTest("salao");

  const totalPassed = r1.passed + r2.passed + r3.passed;
  const totalFailed = r1.failed + r2.failed + r3.failed;

  console.log("\n========================================");
  console.log(`TOTAL: ${totalPassed} passaram, ${totalFailed} falharam`);
  if (totalFailed > 0) process.exit(1);
  console.log("========================================\n");
})();
