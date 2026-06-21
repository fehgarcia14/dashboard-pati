const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8806;
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

function buildMocks(pago) {
  return `
  let snapshotCount = 0;
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
  export function onSnapshot(ref, callback, errCb) {
    if (ref && ref.__pagoDoc) {
      setTimeout(() => callback({ exists: () => true, data: () => ({ pago: ${pago} }) }), 5);
      return () => {};
    }
    snapshotCount++;
    setTimeout(() => callback({ docs: [] }), 10);
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

  let passed = 0, failed = 0;
  function check(label, actual, expected) {
    const ok = actual === expected;
    if (ok) { console.log(`  ✓ ${label}`); passed++; }
    else { console.log(`  ✗ ${label}: got "${actual}", expected "${expected}"`); failed++; }
  }

  async function setupPage(context) {
    const page = await context.newPage();
    page.on("pageerror", err => console.log("PAGE ERROR:", err.message));
    await page.route("**/firebasejs/**/firebase-app.js", r =>
      r.fulfill({ contentType: "application/javascript", body: `export function initializeApp(){return {};}` }));
    await page.route("**/firebasejs/**/firebase-auth.js", r =>
      r.fulfill({ contentType: "application/javascript", body: `
        export function getAuth(){return {};}
        export function onAuthStateChanged(a,cb){setTimeout(()=>cb({uid:'test-user',email:'t@t.com'}),50);return ()=>{};}
        export function signOut(){return Promise.resolve();}` }));
    await page.route("**/js/firebase-config.js", r =>
      r.fulfill({ contentType: "application/javascript", body: `export const firebaseConfig={};` }));
    return page;
  }

  // ================================================================
  // MOBILE — Demo mode (pago=false)
  // ================================================================
  console.log("\n=== MOBILE 375x667: DEMO MODE ===");
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
    const page = await setupPage(context);
    await page.route("**/firebasejs/**/firebase-firestore.js", r =>
      r.fulfill({ contentType: "application/javascript", body: buildMocks(false) }));

    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1000);

    const bannerVisible = await page.evaluate(() => {
      const el = document.getElementById('demo-banner');
      return el && el.style.display !== 'none';
    });
    check("Banner visible on mobile", bannerVisible, true);

    const btnVisible = await page.evaluate(() => {
      const btn = document.getElementById('btn-comprar');
      if (!btn) return false;
      const rect = btn.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    check("Buy button visible and has size", btnVisible, true);

    const btnFits = await page.evaluate(() => {
      const btn = document.getElementById('btn-comprar');
      if (!btn) return false;
      const rect = btn.getBoundingClientRect();
      return rect.right <= window.innerWidth && rect.left >= 0;
    });
    check("Buy button fits within viewport", btnFits, true);

    const bannerFits = await page.evaluate(() => {
      const el = document.getElementById('demo-banner');
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.right <= window.innerWidth + 1;
    });
    check("Banner fits within viewport", bannerFits, true);

    await page.screenshot({ path: path.join(SCREENSHOTS, "paywall-mobile-demo.png"), fullPage: false });

    // Scroll down to see KPIs
    await page.evaluate(() => document.querySelector('.main-content')?.scrollBy(0, 300));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, "paywall-mobile-demo-scrolled.png"), fullPage: false });

    // Open entry modal and try to save — check toast
    await page.click("#fab-add");
    await page.waitForTimeout(500);
    await page.fill("#entry-valor", "100");
    await page.fill("#entry-data", "2026-06-15");
    await page.evaluate(() => {
      const cat = document.getElementById("entry-categoria");
      if (cat && cat.options.length > 0) cat.selectedIndex = 0;
      const banco = document.getElementById("entry-banco");
      if (banco && banco.options.length > 0) banco.selectedIndex = 0;
      document.getElementById("entry-form").requestSubmit();
    });
    await page.waitForTimeout(800);

    const toastText = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    check("Save blocked on mobile", toastText.includes("demonstração") || toastText.includes("Libere"), true);

    await page.screenshot({ path: path.join(SCREENSHOTS, "paywall-mobile-toast.png"), fullPage: false });

    await context.close();
  }

  // ================================================================
  // MOBILE — Paid mode (pago=true)
  // ================================================================
  console.log("\n=== MOBILE 375x667: PAID MODE ===");
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
    const page = await setupPage(context);
    await page.route("**/firebasejs/**/firebase-firestore.js", r =>
      r.fulfill({ contentType: "application/javascript", body: buildMocks(true) }));

    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1000);

    const bannerHidden = await page.evaluate(() => {
      const el = document.getElementById('demo-banner');
      return el && el.style.display === 'none';
    });
    check("Banner hidden on mobile when paid", bannerHidden, true);

    await page.screenshot({ path: path.join(SCREENSHOTS, "paywall-mobile-paid.png"), fullPage: false });

    await context.close();
  }

  // ================================================================
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  await browser.close();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("FATAL:", err); process.exit(1); });
