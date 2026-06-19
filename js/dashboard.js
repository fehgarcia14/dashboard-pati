// ============================================================
// DASHBOARD COMPLETO — Financeiro, Cartão, Agenda, Investimentos, Metas
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================================
// CONSTANTES
// ============================================================
const CATEGORIES_RECEITA = [
  { id: "servicos",      label: "Serviços Prestados",   color: "#3E8E7E" },
  { id: "comissoes",     label: "Comissões",            color: "#5B7C99" },
  { id: "vendas",        label: "Vendas de Produtos",   color: "#C9A24B" },
  { id: "salario",       label: "Salário Fixo",         color: "#6B1F3D" },
  { id: "pix_recebido",  label: "Pix Recebido/Outros",  color: "#8B5FBF" }
];

const CATEGORIES_DESPESA = [
  { id: "moradia",      label: "Moradia",                      tipo: "pessoal",      color: "#6B1F3D" },
  { id: "contas",       label: "Luz, Água & Internet",          tipo: "pessoal",      color: "#4F6B5E" },
  { id: "alimentacao",  label: "Alimentação",                   tipo: "pessoal",      color: "#B8893E" },
  { id: "transporte",   label: "Transporte",                    tipo: "pessoal",      color: "#5B7C99" },
  { id: "lazer",        label: "Lazer",                         tipo: "pessoal",      color: "#D98E92" },
  { id: "roupas",       label: "Roupas & Acessórios",           tipo: "pessoal",      color: "#8B5FBF" },
  { id: "saude",        label: "Saúde",                         tipo: "pessoal",      color: "#3E8E7E" },
  { id: "cartao",       label: "Fatura do Cartão",              tipo: "pessoal",      color: "#A23B3B" },
  { id: "produtos",     label: "Produtos & Insumos",            tipo: "profissional", color: "#C9A24B" },
  { id: "equipamentos", label: "Equipamentos",                  tipo: "profissional", color: "#7A5C3E" },
  { id: "cursos",       label: "Cursos & Capacitação",          tipo: "profissional", color: "#4A7A96" },
  { id: "aluguel",      label: "Aluguel de Cadeira/Espaço",     tipo: "profissional", color: "#9C5B6B" },
  { id: "marketing",    label: "Marketing & Divulgação",        tipo: "profissional", color: "#5C8A6B" },
  { id: "taxas",        label: "Taxas de Cartão (maquininha)",  tipo: "profissional", color: "#B05C3E" }
];

const ALL_CATEGORIES = [...CATEGORIES_RECEITA, ...CATEGORIES_DESPESA];
const catById = (id) => ALL_CATEGORIES.find((c) => c.id === id);

const BANKS = [
  { id: "nubank",    label: "Nubank",           color: "#820AD1" },
  { id: "inter",     label: "Inter",            color: "#FF7A00" },
  { id: "itau",      label: "Itaú",             color: "#003399" },
  { id: "caixa",     label: "Caixa",            color: "#005CA9" },
  { id: "c6",        label: "C6 Bank",          color: "#2D2D2D" },
  { id: "bradesco",  label: "Bradesco",         color: "#CC092F" },
  { id: "bb",        label: "Banco do Brasil",  color: "#FCBA03" },
  { id: "dinheiro",  label: "Dinheiro",         color: "#4F6B5E" },
  { id: "outro",     label: "Outro",            color: "#888888" }
];
const bankById = (id) => BANKS.find((b) => b.id === id) || { id, label: id, color: "#888" };

const FORMAS_PAGAMENTO = {
  debito: "Débito", credito: "Crédito", pix: "Pix",
  dinheiro: "Dinheiro", transferencia: "Transferência"
};

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MESES_LONGOS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DIAS_SEMANA = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];

const fmtBRL = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseDate = (str) => new Date(str + "T00:00:00");
const todayStr = () => new Date().toISOString().slice(0, 10);

// ============================================================
// STATE
// ============================================================
let currentUser = null;
let userProfile = { nome: "", area: "", orcamentos: {} };
let allEntries = [];
let allAtendimentos = [];
let allInvestimentos = [];
let allMetas = [];
let unsubEntries = null, unsubAtend = null, unsubInvest = null, unsubMetas = null;
let editingEntryId = null, editingAtendId = null, editingInvId = null, editingMetaId = null;
let charts = { trend: null, categories: null, split: null, payment: null, patrimonio: null };
let prevKPI = {};
let entriesMovFilter = "todos";
let currentView = 'overview';
let chartDebounceTimer = null;
let skeletonRemoved = false;

const filterState = {
  type: "month",
  value: new Date().getMonth(),
  year: new Date().getFullYear()
};

// ============================================================
// AUTH
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, "usuarios", user.uid));
  if (snap.exists()) userProfile = { orcamentos: {}, ...snap.data() };

  document.getElementById("user-name").textContent = userProfile.nome || user.email;
  document.getElementById("user-area").textContent = areaLabel(userProfile.area);

  // Make app visible BEFORE setting up listeners so canvas elements have real dimensions
  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "grid";

  initTheme();
  initFilters();
  initNav();
  initMobileMenu();
  initModals();
  initTableScrollShadows();

  listenEntries();
  listenAtendimentos();
  listenInvestimentos();
  listenMetas();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  if (unsubEntries) unsubEntries();
  if (unsubAtend) unsubAtend();
  if (unsubInvest) unsubInvest();
  if (unsubMetas) unsubMetas();
  await signOut(auth);
  window.location.href = "index.html";
});

function areaLabel(a) {
  const m = { manicure:"Manicure & Pedicure", esteticista:"Esteticista", cabeleireiro:"Cabeleireiro(a)",
    maquiador:"Maquiador(a)", depilador:"Depilador(a)", barbeiro:"Barbeiro(a)",
    massoterapeuta:"Massoterapeuta", outro:"Profissional da beleza" };
  return m[a] || "Profissional da beleza";
}

// ============================================================
// THEME
// ============================================================
function initTheme() {
  const saved = localStorage.getItem("ficha-theme") || "light";
  applyTheme(saved);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("ficha-theme", next);
    renderAll();
  });
}
function applyTheme(t) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  document.getElementById("theme-label").textContent = t === "dark" ? "Modo escuro" : "Modo claro";
}

// ============================================================
// MOBILE MENU
// ============================================================
function initMobileMenu() {
  const hamburger = document.getElementById("hamburger-btn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");

  const closeSidebar = () => {
    sidebar.classList.remove("open");
    hamburger.classList.remove("active");
    overlay.classList.remove("active");
  };

  hamburger.addEventListener("click", () => {
    const isOpen = sidebar.classList.contains("open");
    if (isOpen) {
      closeSidebar();
    } else {
      sidebar.classList.add("open");
      hamburger.classList.add("active");
      overlay.classList.add("active");
    }
  });

  overlay.addEventListener("click", closeSidebar);

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      if (window.innerWidth <= 900) closeSidebar();
    });
  });
}

// ============================================================
// TABLE SCROLL SHADOWS
// ============================================================
function initTableScrollShadows() {
  const checkScroll = (wrap) => {
    if (wrap.scrollWidth > wrap.clientWidth + 2) {
      wrap.classList.add("has-scroll");
    } else {
      wrap.classList.remove("has-scroll");
    }
  };

  const observer = new MutationObserver(() => {
    document.querySelectorAll(".table-wrap").forEach(checkScroll);
  });

  observer.observe(document.querySelector(".main"), { childList: true, subtree: true });
  window.addEventListener("resize", () => {
    document.querySelectorAll(".table-wrap").forEach(checkScroll);
  });
}

// ============================================================
// NAV
// ============================================================
const VIEW_TITLES = {
  overview: ["Visão Geral", "Acompanhe receitas, despesas e investimentos"],
  entries: ["Lançamentos", "Todos os seus lançamentos financeiros"],
  "credit-card": ["Cartão de Crédito", "Acompanhe suas compras no crédito"],
  investments: ["Investimentos & Reserva", "Aportes, retiradas e saldo dos seus investimentos"],
  agenda: ["Agenda de Clientes", "Atendimentos, faturamento e ranking de clientes"],
  metas: ["Metas Financeiras", "Acompanhe o progresso das suas metas"],
  budget: ["Orçamento", "Defina limites mensais por categoria de despesa"],
  intelligence: ["Inteligência", "Análises e sugestões automáticas"]
};

function initNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      currentView = view;
      const section = document.getElementById("view-" + view);
      section.classList.add("active");
      document.getElementById("header-title").textContent = VIEW_TITLES[view][0];
      document.getElementById("header-sub").textContent = VIEW_TITLES[view][1];
      renderCurrentView();
    });
  });
}

function renderCurrentView() {
  switch (currentView) {
    case 'overview':
      renderOverviewKPIs();
      renderOverviewCharts();
      break;
    case 'entries':
      renderEntriesTable();
      break;
    case 'credit-card':
      renderCreditCard();
      break;
    case 'investments':
      renderInvestments();
      break;
    case 'agenda':
      renderAgenda();
      break;
    case 'metas':
      renderMetas();
      break;
    case 'budget':
      renderBudget();
      break;
    case 'intelligence':
      renderIntelligence();
      break;
  }
  renderLastEntry();
}

// ============================================================
// FILTERS
// ============================================================
function initFilters() {
  const typeSel = document.getElementById("filter-type");
  const yearSel = document.getElementById("filter-year");
  populateYearSelect();
  typeSel.value = filterState.type;
  yearSel.value = String(filterState.year);
  populateValueSelect();

  typeSel.addEventListener("change", () => {
    filterState.type = typeSel.value;
    filterState.value = defaultValueFor(filterState.type);
    populateValueSelect();
    renderAll();
  });
  document.getElementById("filter-value").addEventListener("change", (e) => {
    filterState.value = Number(e.target.value);
    renderAll();
  });
  yearSel.addEventListener("change", (e) => {
    filterState.year = Number(e.target.value);
    renderAll();
  });
  document.getElementById("clear-filters").addEventListener("click", () => {
    filterState.type = "month";
    filterState.value = new Date().getMonth();
    filterState.year = new Date().getFullYear();
    typeSel.value = "month";
    yearSel.value = String(filterState.year);
    populateValueSelect();
    renderAll();
  });

  document.querySelectorAll("[data-filter-mov]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter-mov]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      entriesMovFilter = btn.dataset.filterMov;
      renderEntriesTable();
    });
  });
}

function populateYearSelect() {
  const yearSel = document.getElementById("filter-year");
  const years = new Set([new Date().getFullYear()]);
  allEntries.forEach(e => years.add(parseDate(e.data).getFullYear()));
  allAtendimentos.forEach(e => years.add(parseDate(e.data).getFullYear()));
  const arr = Array.from(years).sort((a, b) => b - a);
  yearSel.innerHTML = arr.map(y => `<option value="${y}">${y}</option>`).join("");
  if (!arr.includes(filterState.year)) filterState.year = arr[0];
  yearSel.value = String(filterState.year);
}

function defaultValueFor(t) {
  const now = new Date();
  if (t === "month") return now.getMonth();
  if (t === "quarter") return Math.floor(now.getMonth() / 3) + 1;
  if (t === "semester") return now.getMonth() < 6 ? 1 : 2;
  return 1;
}

function populateValueSelect() {
  const sel = document.getElementById("filter-value");
  const t = filterState.type;
  let html = "";
  if (t === "month") html = MESES_LONGOS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  else if (t === "quarter") html = [1,2,3,4].map(q => `<option value="${q}">${q}º Trimestre</option>`).join("");
  else if (t === "semester") html = [1,2].map(s => `<option value="${s}">${s}º Semestre</option>`).join("");
  else html = `<option value="1">Ano completo</option>`;
  sel.innerHTML = html;
  sel.disabled = t === "year";
  sel.value = String(filterState.value);
  if (!sel.value) { filterState.value = defaultValueFor(t); sel.value = String(filterState.value); }
}

function getRange(type, value, year) {
  if (type === "month") return { start: new Date(year, value, 1), end: new Date(year, value + 1, 0, 23, 59, 59) };
  if (type === "quarter") { const m = (value - 1) * 3; return { start: new Date(year, m, 1), end: new Date(year, m + 3, 0, 23, 59, 59) }; }
  if (type === "semester") { const m = (value - 1) * 6; return { start: new Date(year, m, 1), end: new Date(year, m + 6, 0, 23, 59, 59) }; }
  return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59) };
}

function inRange(dateStr, range) {
  const d = parseDate(dateStr);
  return d >= range.start && d <= range.end;
}

function filteredEntries() {
  const range = getRange(filterState.type, filterState.value, filterState.year);
  return allEntries.filter(e => inRange(e.data, range));
}

// ============================================================
// FIRESTORE LISTENERS
// ============================================================
function listenEntries() {
  const ref = collection(db, "usuarios", currentUser.uid, "lancamentos");
  unsubEntries = onSnapshot(query(ref), (snap) => {
    allEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    populateYearSelect();
    removeSkeleton();
    renderAll();
  }, () => showToast("Erro ao carregar lançamentos."));
}

function listenAtendimentos() {
  const ref = collection(db, "usuarios", currentUser.uid, "atendimentos");
  unsubAtend = onSnapshot(query(ref), (snap) => {
    allAtendimentos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    populateYearSelect();
    updateClienteDatalist();
    removeSkeleton();
    renderAll();
  }, () => showToast("Erro ao carregar atendimentos."));
}

function listenInvestimentos() {
  const ref = collection(db, "usuarios", currentUser.uid, "investimentos");
  unsubInvest = onSnapshot(query(ref), (snap) => {
    allInvestimentos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateProdutoDatalist();
    removeSkeleton();
    renderAll();
  }, () => showToast("Erro ao carregar investimentos."));
}

function listenMetas() {
  const ref = collection(db, "usuarios", currentUser.uid, "metas");
  unsubMetas = onSnapshot(query(ref), (snap) => {
    allMetas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, () => showToast("Erro ao carregar metas."));
}

// ============================================================
// SKELETON LOADING
// ============================================================
function removeSkeleton() {
  if (skeletonRemoved) return;
  skeletonRemoved = true;
  document.querySelectorAll(".skeleton-text").forEach(el => {
    el.classList.remove("skeleton-text");
  });
}

// ============================================================
// UTILITY
// ============================================================
function sumBy(arr, keyFn) {
  const m = {};
  arr.forEach(e => { const k = keyFn(e); m[k] = (m[k] || 0) + Number(e.valor || e.valorTotal || 0); });
  return m;
}
const totalOf = (arr) => arr.reduce((s, e) => s + Number(e.valor || e.valorTotal || 0), 0);

function escapeHtml(str) {
  const d = document.createElement("div"); d.textContent = str; return d.innerHTML;
}

function animateValue(el, start, end, duration = 700) {
  if (Math.abs(start - end) < 0.01) { el.textContent = fmtBRL(end); return; }
  const startTime = performance.now();
  const diff = end - start;
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = fmtBRL(start + diff * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function animateKPI(id, newVal) {
  const el = document.getElementById(id);
  if (!el) return;
  const old = prevKPI[id] || 0;
  prevKPI[id] = newVal;
  animateValue(el, old, newVal);
}

function animateCount(id, newVal) {
  const el = document.getElementById(id);
  if (!el) return;
  const old = prevKPI[id] || 0;
  prevKPI[id] = newVal;
  if (old === newVal) { el.textContent = String(newVal); return; }
  const startTime = performance.now();
  const diff = newVal - old;
  function step(now) {
    const progress = Math.min((now - startTime) / 500, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = String(Math.round(old + diff * eased));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function timeAgo(ts) {
  if (!ts) return "";
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs / 24)}d`;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartBaseOptions({ stacked, legendDisplay } = {}) {
  const gridColor = cssVar("--line");
  const textColor = cssVar("--ink-soft");
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: legendDisplay !== undefined ? legendDisplay : !!stacked, position: "bottom", labels: { color: textColor, font: { family: "Work Sans" } } } },
    scales: {
      x: { stacked: !!stacked, grid: { display: false }, ticks: { color: textColor, font: { family: "IBM Plex Mono", size: 11 } } },
      y: { stacked: !!stacked, grid: { color: gridColor }, ticks: { color: textColor, font: { family: "IBM Plex Mono", size: 11 } } }
    }
  };
}

function daysBetween(dateStr, refDate) {
  const d = parseDate(dateStr);
  const r = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  return Math.ceil((d - r) / (1000 * 60 * 60 * 24));
}

function fmtDateBR(dateStr) {
  const d = parseDate(dateStr);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll() {
  renderCurrentView();
}

// ============================================================
// OVERVIEW — KPIs
// ============================================================
function renderOverviewKPIs() {
  const cur = filteredEntries();
  const receitas = totalOf(cur.filter(e => e.movimento === "entrada"));
  const despesas = totalOf(cur.filter(e => e.movimento === "saida"));
  const saldo = receitas - despesas;

  animateKPI("kpi-receitas", receitas);
  animateKPI("kpi-despesas", despesas);
  animateKPI("kpi-saldo", saldo);

  const saldoCard = document.getElementById("kpi-saldo-card");
  saldoCard.className = "kpi-ticket " + (saldo >= 0 ? "accent-sage" : "accent-danger");

  const despCur = cur.filter(e => e.movimento === "saida");
  const byCat = sumBy(despCur, e => e.categoria);
  const topCatId = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0];
  if (topCatId) {
    document.getElementById("kpi-top-desp").textContent = catById(topCatId)?.label || topCatId;
    document.getElementById("kpi-top-desp-amt").textContent = fmtBRL(byCat[topCatId]);
  } else {
    document.getElementById("kpi-top-desp").textContent = "—";
    document.getElementById("kpi-top-desp-amt").textContent = "";
  }

  const saldoAcum = totalOf(allEntries.filter(e => e.movimento === "entrada")) -
                     totalOf(allEntries.filter(e => e.movimento === "saida"));
  const totalInv = totalOf(allInvestimentos.filter(e => e.movimento === "aporte")) -
                   totalOf(allInvestimentos.filter(e => e.movimento === "retirada"));
  animateKPI("kpi-patrimonio", saldoAcum + totalInv);
}

// ============================================================
// OVERVIEW — Charts (FIXED: uses setTimeout instead of RAF)
// ============================================================
function renderOverviewCharts() {
  renderBankCards();
  renderContasVencer();

  clearTimeout(chartDebounceTimer);
  chartDebounceTimer = setTimeout(() => {
    if (currentView !== 'overview') return;
    if (typeof Chart === 'undefined') {
      console.error('Chart.js não carregado — verifique a conexão com o CDN.');
      return;
    }

    try { renderTrendChart(); } catch (e) { console.error('Erro gráfico trend:', e); }
    try { renderCategoryChart(); } catch (e) { console.error('Erro gráfico categorias:', e); }
    try { renderPaymentChart(); } catch (e) { console.error('Erro gráfico pagamento:', e); }
    try { renderSplitChart(); } catch (e) { console.error('Erro gráfico split:', e); }
    try { renderPatrimonioChart(); } catch (e) { console.error('Erro gráfico patrimônio:', e); }
  }, 80);
}

function renderTrendChart() {
  const ctx = document.getElementById("chart-trend");
  if (!ctx) return;
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));

  const recData = months.map(d => totalOf(allEntries.filter(e => {
    const ed = parseDate(e.data);
    return e.movimento === "entrada" && ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
  })));
  const despData = months.map(d => totalOf(allEntries.filter(e => {
    const ed = parseDate(e.data);
    return e.movimento === "saida" && ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
  })));

  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months.map(d => `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`),
      datasets: [
        { label: "Receita", data: recData, backgroundColor: cssVar("--sage") || "#4F6B5E", borderRadius: 4 },
        { label: "Despesa", data: despData, backgroundColor: cssVar("--danger") || "#A23B3B", borderRadius: 4 }
      ]
    },
    options: chartBaseOptions({ legendDisplay: true })
  });
  charts.trend.resize();
}

function renderCategoryChart() {
  const ctx = document.getElementById("chart-categories");
  if (!ctx) return;
  const cur = filteredEntries().filter(e => e.movimento === "saida");
  const byCat = sumBy(cur, e => e.categoria);
  const ids = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const legend = document.getElementById("legend-categories");

  if (charts.categories) charts.categories.destroy();
  if (ids.length === 0) {
    legend.innerHTML = "";
    ctx.style.display = "none";
    ctx.parentElement.querySelector(".chart-empty")?.remove();
    ctx.insertAdjacentHTML("afterend", '<div class="chart-empty"><span class="empty-icon">📊</span><span>Nenhum gasto neste período</span></div>');
    return;
  }
  ctx.style.display = "block";
  ctx.parentElement.querySelector(".chart-empty")?.remove();

  charts.categories = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ids.map(id => catById(id)?.label || id),
      datasets: [{ data: ids.map(id => byCat[id]), backgroundColor: ids.map(id => catById(id)?.color || "#999"), borderWidth: 0 }]
    },
    options: { plugins: { legend: { display: false } }, cutout: "62%", responsive: true, maintainAspectRatio: true }
  });
  charts.categories.resize();

  const total = totalOf(cur);
  legend.innerHTML = ids.map(id => `
    <div class="legend-row">
      <span class="tag"><span class="legend-dot" style="background:${catById(id)?.color || "#999"}"></span>${catById(id)?.label || id}</span>
      <span class="amt">${fmtBRL(byCat[id])} · ${Math.round((byCat[id] / total) * 100)}%</span>
    </div>
  `).join("");
}

function renderPaymentChart() {
  const ctx = document.getElementById("chart-payment");
  if (!ctx) return;
  const cur = filteredEntries().filter(e => e.movimento === "saida");
  const byPay = sumBy(cur, e => e.formaPagamento || "dinheiro");
  const keys = Object.keys(byPay).sort((a, b) => byPay[b] - byPay[a]);
  const legend = document.getElementById("legend-payment");
  const payColors = { debito: "#4A7A96", credito: "#A23B3B", pix: "#3E8E7E", dinheiro: "#4F6B5E", transferencia: "#B8893E" };

  if (charts.payment) charts.payment.destroy();
  if (keys.length === 0) {
    legend.innerHTML = "";
    ctx.style.display = "none";
    ctx.parentElement.querySelector(".chart-empty")?.remove();
    ctx.insertAdjacentHTML("afterend", '<div class="chart-empty"><span class="empty-icon">💳</span><span>Sem dados de pagamento</span></div>');
    return;
  }
  ctx.style.display = "block";
  ctx.parentElement.querySelector(".chart-empty")?.remove();

  charts.payment = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: keys.map(k => FORMAS_PAGAMENTO[k] || k),
      datasets: [{ data: keys.map(k => byPay[k]), backgroundColor: keys.map(k => payColors[k] || "#999"), borderWidth: 0 }]
    },
    options: { plugins: { legend: { display: false } }, cutout: "62%", responsive: true, maintainAspectRatio: true }
  });
  charts.payment.resize();

  const total = totalOf(cur);
  legend.innerHTML = keys.map(k => `
    <div class="legend-row">
      <span class="tag"><span class="legend-dot" style="background:${payColors[k] || "#999"}"></span>${FORMAS_PAGAMENTO[k] || k}</span>
      <span class="amt">${fmtBRL(byPay[k])} · ${total > 0 ? Math.round((byPay[k] / total) * 100) : 0}%</span>
    </div>
  `).join("");
}

function renderSplitChart() {
  const ctx = document.getElementById("chart-split");
  if (!ctx) return;
  const cur = filteredEntries().filter(e => e.movimento === "saida");
  const personal = totalOf(cur.filter(e => e.tipo === "pessoal"));
  const professional = totalOf(cur.filter(e => e.tipo === "profissional"));

  if (charts.split) charts.split.destroy();

  if (personal === 0 && professional === 0) {
    ctx.style.display = "none";
    ctx.parentElement.querySelector(".chart-empty")?.remove();
    ctx.insertAdjacentHTML("afterend", '<div class="chart-empty"><span class="empty-icon">📊</span><span>Sem despesas neste período</span></div>');
    return;
  }
  ctx.style.display = "block";
  ctx.parentElement.querySelector(".chart-empty")?.remove();

  charts.split = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Pessoal", "Profissional"],
      datasets: [{ data: [personal, professional], backgroundColor: [cssVar("--primary") || "#6B1F3D", cssVar("--gold") || "#B8893E"], borderRadius: 6 }]
    },
    options: { ...chartBaseOptions({}), indexAxis: "y" }
  });
  charts.split.resize();
}

// ============================================================
// PATRIMÔNIO EVOLUTION CHART (Parte 3.5)
// ============================================================
function renderPatrimonioChart() {
  const ctx = document.getElementById("chart-patrimonio");
  if (!ctx) return;

  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));

  const patrimonioData = months.map(d => {
    const cutoff = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    const saldoEntries = allEntries.reduce((acc, e) => {
      const ed = parseDate(e.data);
      if (ed > cutoff) return acc;
      return acc + (e.movimento === "entrada" ? Number(e.valor || 0) : -Number(e.valor || 0));
    }, 0);

    const saldoInv = allInvestimentos.reduce((acc, e) => {
      const ed = parseDate(e.data);
      if (ed > cutoff) return acc;
      return acc + (e.movimento === "aporte" ? Number(e.valor || 0) : -Number(e.valor || 0));
    }, 0);

    return saldoEntries + saldoInv;
  });

  if (charts.patrimonio) charts.patrimonio.destroy();
  charts.patrimonio = new Chart(ctx, {
    type: "line",
    data: {
      labels: months.map(d => `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`),
      datasets: [{
        label: "Patrimônio Total",
        data: patrimonioData,
        borderColor: cssVar("--primary") || "#6B1F3D",
        backgroundColor: (cssVar("--primary-soft") || "#F3DEE6") + "80",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: cssVar("--primary") || "#6B1F3D"
      }]
    },
    options: {
      ...chartBaseOptions({ legendDisplay: false }),
      plugins: { legend: { display: false } }
    }
  });
  charts.patrimonio.resize();
}

// ============================================================
// CONTAS A VENCER (Parte 3.3)
// ============================================================
function renderContasVencer() {
  const container = document.getElementById("contas-vencer-list");
  if (!container) return;

  const today = new Date();
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const in7Days = new Date(todayNorm.getTime() + 7 * 24 * 60 * 60 * 1000);

  const contas = allEntries.filter(e => {
    if (e.movimento !== "saida") return false;
    if (e.statusPagamento !== "pendente") return false;
    if (!e.fixo && e.formaPagamento !== "credito") return false;
    const d = parseDate(e.data);
    return d <= in7Days;
  }).sort((a, b) => parseDate(a.data) - parseDate(b.data));

  if (contas.length === 0) {
    container.innerHTML = '<div class="chart-empty"><span class="empty-icon">✅</span><span>Nenhuma conta pendente nos próximos dias</span></div>';
    return;
  }

  container.innerHTML = contas.map(e => {
    const dias = daysBetween(e.data, todayNorm);
    const cat = catById(e.categoria);
    const isVencida = dias < 0;
    const cssClass = isVencida ? "urgente" : "atencao";
    const prazoText = isVencida ? `Vencida há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? "s" : ""}` :
                      dias === 0 ? "Vence hoje" :
                      `Vence em ${dias} dia${dias !== 1 ? "s" : ""}`;
    return `<div class="conta-vencer-item ${cssClass}">
      <div class="cv-info">
        <strong>${cat?.label || e.categoria}</strong>
        <div class="cv-desc">${e.descricao ? escapeHtml(e.descricao) : fmtDateBR(e.data)} · ${FORMAS_PAGAMENTO[e.formaPagamento] || e.formaPagamento}</div>
      </div>
      <span class="cv-prazo">${prazoText}</span>
      <span class="cv-valor">${fmtBRL(e.valor)}</span>
    </div>`;
  }).join("");
}

function renderBankCards() {
  const periodEl = document.getElementById("bank-cards-period");
  const totalEl = document.getElementById("bank-cards-total");
  const cur = filteredEntries();

  const periodSaldo = {};
  const totalSaldo = {};
  BANKS.forEach(b => { periodSaldo[b.id] = 0; totalSaldo[b.id] = 0; });

  cur.forEach(e => {
    const bk = e.banco || "outro";
    const val = Number(e.valor || 0);
    periodSaldo[bk] = (periodSaldo[bk] || 0) + (e.movimento === "entrada" ? val : -val);
  });

  allEntries.forEach(e => {
    const bk = e.banco || "outro";
    const val = Number(e.valor || 0);
    totalSaldo[bk] = (totalSaldo[bk] || 0) + (e.movimento === "entrada" ? val : -val);
  });

  const renderCards = (obj, container) => {
    const entries = Object.entries(obj).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      container.innerHTML = '<div class="chart-empty"><span class="empty-icon">🏦</span><span>Sem movimentação</span></div>';
      return;
    }
    container.innerHTML = entries.map(([id, val]) => {
      const b = bankById(id);
      const textColor = (id === "bb" || id === "dinheiro") ? "#241A1D" : "#fff";
      return `<div class="bank-card" style="background:${b.color};color:${textColor};">
        <div class="bank-name">${b.label}</div>
        <span class="bank-value">${fmtBRL(val)}</span>
      </div>`;
    }).join("");
  };

  renderCards(periodSaldo, periodEl);
  renderCards(totalSaldo, totalEl);
}

// ============================================================
// ENTRIES TABLE
// ============================================================
function renderEntriesTable() {
  let cur = filteredEntries().slice().sort((a, b) => parseDate(b.data) - parseDate(a.data));
  if (entriesMovFilter === "entrada") cur = cur.filter(e => e.movimento === "entrada");
  else if (entriesMovFilter === "saida") cur = cur.filter(e => e.movimento === "saida");

  const tbody = document.getElementById("entries-tbody");
  document.getElementById("entries-count").textContent = `${cur.length} lançamento${cur.length === 1 ? "" : "s"} no período`;

  if (cur.length === 0) {
    tbody.innerHTML = "";
    document.getElementById("entries-empty").style.display = "block";
    return;
  }
  document.getElementById("entries-empty").style.display = "none";

  tbody.innerHTML = cur.map(e => {
    const cat = catById(e.categoria);
    const d = parseDate(e.data);
    const bank = bankById(e.banco);
    const isEntrada = e.movimento === "entrada";
    const forma = FORMAS_PAGAMENTO[e.formaPagamento] || e.formaPagamento || "—";
    const fixoBadge = (e.fixo && e.movimento === "saida") ? '<span class="fixo-badge" title="Gasto fixo">📌</span>' : "";
    return `<tr>
      <td>${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}</td>
      <td><span class="mov-pill ${e.movimento}">${isEntrada ? "Entrada" : "Saída"}</span></td>
      <td><span class="cat-pill" style="background:${cat?.color}22;color:${cat?.color}">${cat?.label || e.categoria}</span></td>
      <td><span class="cat-pill" style="background:${bank.color}22;color:${bank.color}">${bank.label}</span></td>
      <td>${forma}${fixoBadge}</td>
      <td>${e.descricao ? escapeHtml(e.descricao) : "—"}</td>
      <td class="amt-cell ${isEntrada ? "positive" : "negative"}">${isEntrada ? "+" : "−"} ${fmtBRL(e.valor)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-entry="${e.id}" title="Editar">✎</button>
          <button class="icon-btn" data-del-entry="${e.id}" title="Excluir">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-edit-entry]").forEach(btn => {
    btn.addEventListener("click", () => openEntryModal(allEntries.find(e => e.id === btn.dataset.editEntry)));
  });
  tbody.querySelectorAll("[data-del-entry]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir este lançamento?")) return;
      await deleteDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", btn.dataset.delEntry));
      showToast("Lançamento excluído.");
    });
  });
}

// ============================================================
// CREDIT CARD
// ============================================================
function renderCreditCard() {
  const cur = filteredEntries().filter(e => e.formaPagamento === "credito");
  const pago = totalOf(cur.filter(e => e.statusPagamento === "pago"));
  const pendente = totalOf(cur.filter(e => e.statusPagamento === "pendente"));
  const atrasado = totalOf(cur.filter(e => e.statusPagamento === "atrasado"));
  const total = pago + pendente + atrasado;

  animateKPI("kpi-cc-pago", pago);
  animateKPI("kpi-cc-pendente", pendente);
  animateKPI("kpi-cc-atrasado", atrasado);
  animateKPI("kpi-cc-total", total);

  document.getElementById("cc-count").textContent = `${cur.length} compra${cur.length === 1 ? "" : "s"} no período`;

  const tbody = document.getElementById("cc-tbody");
  if (cur.length === 0) {
    tbody.innerHTML = "";
    document.getElementById("cc-empty").style.display = "block";
    return;
  }
  document.getElementById("cc-empty").style.display = "none";

  const sorted = cur.slice().sort((a, b) => parseDate(b.data) - parseDate(a.data));
  tbody.innerHTML = sorted.map(e => {
    const cat = catById(e.categoria);
    const d = parseDate(e.data);
    const bank = bankById(e.banco);
    const st = e.statusPagamento || "pago";
    return `<tr>
      <td>${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}</td>
      <td><span class="cat-pill" style="background:${cat?.color}22;color:${cat?.color}">${cat?.label || e.categoria}</span></td>
      <td><span class="cat-pill" style="background:${bank.color}22;color:${bank.color}">${bank.label}</span></td>
      <td>${e.descricao ? escapeHtml(e.descricao) : "—"}</td>
      <td class="amt-cell negative">−${fmtBRL(e.valor)}</td>
      <td>
        <select class="status-select ${st}" data-cc-status="${e.id}">
          <option value="pago" ${st==="pago"?"selected":""}>Pago</option>
          <option value="pendente" ${st==="pendente"?"selected":""}>Pendente</option>
          <option value="atrasado" ${st==="atrasado"?"selected":""}>Atrasado</option>
        </select>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-cc-status]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const newSt = sel.value;
      sel.className = "status-select " + newSt;
      await updateDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", sel.dataset.ccStatus), { statusPagamento: newSt });
      showToast("Status atualizado.");
    });
  });
}

// ============================================================
// INVESTMENTS
// ============================================================
function getTotalInvestido() {
  return totalOf(allInvestimentos.filter(e => e.movimento === "aporte")) -
         totalOf(allInvestimentos.filter(e => e.movimento === "retirada"));
}

function renderInvestments() {
  const now = new Date();
  const thisMonth = allInvestimentos.filter(e => {
    const d = parseDate(e.data);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  animateKPI("kpi-inv-total", getTotalInvestido());
  animateKPI("kpi-inv-aporte", totalOf(thisMonth.filter(e => e.movimento === "aporte")));
  animateKPI("kpi-inv-retirada", totalOf(thisMonth.filter(e => e.movimento === "retirada")));

  const prodMap = {};
  allInvestimentos.forEach(e => {
    const key = `${e.banco}|||${e.produto}`;
    if (!prodMap[key]) prodMap[key] = { banco: e.banco, produto: e.produto, saldo: 0 };
    prodMap[key].saldo += e.movimento === "aporte" ? Number(e.valor) : -Number(e.valor);
  });

  const products = Object.values(prodMap).sort((a, b) => b.saldo - a.saldo);
  if (products.length > 0) {
    document.getElementById("kpi-inv-top").textContent = products[0].produto;
    document.getElementById("kpi-inv-top-amt").textContent = fmtBRL(products[0].saldo);
  } else {
    document.getElementById("kpi-inv-top").textContent = "—";
    document.getElementById("kpi-inv-top-amt").textContent = "";
  }

  const byBank = {};
  products.forEach(p => {
    if (!byBank[p.banco]) byBank[p.banco] = [];
    byBank[p.banco].push(p);
  });

  const container = document.getElementById("inv-by-bank");
  const emptyEl = document.getElementById("inv-empty");
  if (Object.keys(byBank).length === 0) {
    container.innerHTML = "";
    emptyEl.style.display = "block";
  } else {
    emptyEl.style.display = "none";
    const bankEntries = Object.entries(byBank).sort((a, b) => {
      const sumA = a[1].reduce((s, p) => s + p.saldo, 0);
      const sumB = b[1].reduce((s, p) => s + p.saldo, 0);
      return sumB - sumA;
    });
    container.innerHTML = bankEntries.map(([bId, prods]) => {
      const b = bankById(bId);
      const bankTotal = prods.reduce((s, p) => s + p.saldo, 0);
      const textColor = (bId === "bb" || bId === "dinheiro") ? "#241A1D" : "#fff";
      return `<div class="inv-bank-group">
        <div class="inv-bank-header" style="background:${b.color};color:${textColor};">
          <span>${b.label}</span>
          <span class="bank-total">${fmtBRL(bankTotal)}</span>
        </div>
        ${prods.sort((a, b) => b.saldo - a.saldo).map(p => `
          <div class="inv-product-row">
            <span class="prod-name">${escapeHtml(p.produto)}</span>
            <span class="prod-value">${fmtBRL(p.saldo)}</span>
          </div>
        `).join("")}
      </div>`;
    }).join("");
  }

  const sorted = allInvestimentos.slice().sort((a, b) => parseDate(b.data) - parseDate(a.data));
  document.getElementById("inv-hist-count").textContent = `${sorted.length} movimento${sorted.length === 1 ? "" : "s"}`;
  const tbody = document.getElementById("inv-tbody");
  tbody.innerHTML = sorted.map(e => {
    const b = bankById(e.banco);
    const d = parseDate(e.data);
    const isAporte = e.movimento === "aporte";
    return `<tr>
      <td>${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}</td>
      <td><span class="cat-pill" style="background:${b.color}22;color:${b.color}">${b.label}</span></td>
      <td>${escapeHtml(e.produto)}</td>
      <td><span class="mov-pill ${isAporte ? "entrada" : "saida"}">${isAporte ? "Aporte" : "Retirada"}</span></td>
      <td class="amt-cell ${isAporte ? "positive" : "negative"}">${isAporte ? "+" : "−"} ${fmtBRL(e.valor)}</td>
      <td>${e.observacao ? escapeHtml(e.observacao) : "—"}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-inv="${e.id}" title="Editar">✎</button>
          <button class="icon-btn" data-del-inv="${e.id}" title="Excluir">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-edit-inv]").forEach(btn => {
    btn.addEventListener("click", () => openInvModal(allInvestimentos.find(e => e.id === btn.dataset.editInv)));
  });
  tbody.querySelectorAll("[data-del-inv]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir este movimento?")) return;
      await deleteDoc(doc(db, "usuarios", currentUser.uid, "investimentos", btn.dataset.delInv));
      showToast("Movimento excluído.");
    });
  });
}

// ============================================================
// AGENDA (Parte 3.2 — com status agendado/realizado/cancelado)
// ============================================================
function renderAgenda() {
  const now = new Date();
  const today = todayStr();

  const realizados = allAtendimentos.filter(a => (a.status || "realizado") === "realizado");

  const todayRealizados = realizados.filter(a => a.data === today);
  const monthRealizados = realizados.filter(a => {
    const d = parseDate(a.data);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const yearRealizados = realizados.filter(a => parseDate(a.data).getFullYear() === now.getFullYear());

  animateCount("kpi-ag-hoje-qtd", allAtendimentos.filter(a => a.data === today).length);
  animateKPI("kpi-ag-hoje-fat", totalOf(todayRealizados));
  animateKPI("kpi-ag-mes", totalOf(monthRealizados));
  animateKPI("kpi-ag-ano", totalOf(yearRealizados));

  renderProximosAtendimentos();

  const byDay = {};
  allAtendimentos.forEach(a => {
    if (!byDay[a.data]) byDay[a.data] = [];
    byDay[a.data].push(a);
  });
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  const container = document.getElementById("agenda-list");
  const emptyEl = document.getElementById("agenda-empty");

  if (days.length === 0) {
    container.innerHTML = "";
    emptyEl.style.display = "block";
  } else {
    emptyEl.style.display = "none";
    container.innerHTML = days.map(day => {
      const d = parseDate(day);
      const dayLabel = `${DIAS_SEMANA[d.getDay()]}, ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
      const items = byDay[day].sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));
      const dayRealizados = items.filter(a => (a.status || "realizado") === "realizado");
      const dayTotal = totalOf(dayRealizados);
      return `<div class="agenda-day-group">
        <div class="agenda-day-header">
          <span class="day-label">${dayLabel}</span>
          <span class="day-total">${fmtBRL(dayTotal)}</span>
        </div>
        ${items.map(a => {
          const st = a.status || "realizado";
          return `
          <div class="agenda-item">
            <div class="atend-info">
              <strong>${escapeHtml(a.cliente)}</strong>
              <span class="status-badge ${st}" style="margin-left:8px;">${st.charAt(0).toUpperCase() + st.slice(1)}</span>
              <div class="atend-details">${a.quantidade || 1}x ${escapeHtml(a.servico)} · ${FORMAS_PAGAMENTO[a.formaPagamento] || a.formaPagamento}${a.observacao ? " · " + escapeHtml(a.observacao) : ""}</div>
            </div>
            <span class="atend-valor">${fmtBRL(a.valorTotal)}</span>
            <div class="row-actions">
              ${st === "agendado" ? `<button class="btn-sm btn-sage" data-realize-atend="${a.id}" title="Marcar como realizado">✓ Realizado</button>` : ""}
              ${st === "agendado" ? `<button class="btn-sm" data-cancel-atend="${a.id}" title="Cancelar">✗ Cancelar</button>` : ""}
              <button class="icon-btn" data-edit-atend="${a.id}" title="Editar">✎</button>
              <button class="icon-btn" data-del-atend="${a.id}" title="Excluir">🗑</button>
            </div>
          </div>`;
        }).join("")}
      </div>`;
    }).join("");

    container.querySelectorAll("[data-edit-atend]").forEach(btn => {
      btn.addEventListener("click", () => openAtendModal(allAtendimentos.find(a => a.id === btn.dataset.editAtend)));
    });
    container.querySelectorAll("[data-del-atend]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir este atendimento? O lançamento financeiro vinculado também será excluído.")) return;
        const atend = allAtendimentos.find(a => a.id === btn.dataset.delAtend);
        if (atend?.lancamentoId) {
          await deleteDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", atend.lancamentoId)).catch(() => {});
        }
        await deleteDoc(doc(db, "usuarios", currentUser.uid, "atendimentos", btn.dataset.delAtend));
        showToast("Atendimento excluído.");
      });
    });
    container.querySelectorAll("[data-realize-atend]").forEach(btn => {
      btn.addEventListener("click", () => handleAtendStatusChange(btn.dataset.realizeAtend, "realizado"));
    });
    container.querySelectorAll("[data-cancel-atend]").forEach(btn => {
      btn.addEventListener("click", () => handleAtendStatusChange(btn.dataset.cancelAtend, "cancelado"));
    });
  }

  // Ranking de clientes (only realized)
  const clientMap = {};
  realizados.forEach(a => {
    const name = (a.cliente || "").trim().toLowerCase();
    if (!name) return;
    if (!clientMap[name]) clientMap[name] = { nome: a.cliente, visitas: 0, total: 0 };
    clientMap[name].visitas++;
    clientMap[name].total += Number(a.valorTotal || 0);
  });

  const ranking = Object.values(clientMap).sort((a, b) => b.total - a.total);
  const rankTbody = document.getElementById("ranking-tbody");
  const rankEmpty = document.getElementById("ranking-empty");

  if (ranking.length === 0) {
    rankTbody.innerHTML = "";
    rankEmpty.style.display = "block";
  } else {
    rankEmpty.style.display = "none";
    rankTbody.innerHTML = ranking.map(c => `<tr>
      <td>${escapeHtml(c.nome)}</td>
      <td>${c.visitas}</td>
      <td class="amt-cell positive">${fmtBRL(c.total)}</td>
      <td class="mono">${fmtBRL(c.total / c.visitas)}</td>
    </tr>`).join("");
  }
}

// ============================================================
// PRÓXIMOS ATENDIMENTOS (Parte 3.2)
// ============================================================
function renderProximosAtendimentos() {
  const container = document.getElementById("proximos-list");
  const emptyEl = document.getElementById("proximos-empty");
  if (!container) return;

  const today = new Date();
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const in7Days = new Date(todayNorm.getTime() + 7 * 24 * 60 * 60 * 1000);

  const proximos = allAtendimentos.filter(a => {
    if ((a.status || "realizado") !== "agendado") return false;
    const d = parseDate(a.data);
    return d >= todayNorm && d <= in7Days;
  }).sort((a, b) => parseDate(a.data) - parseDate(b.data));

  if (proximos.length === 0) {
    container.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  container.innerHTML = proximos.map(a => {
    const dias = daysBetween(a.data, todayNorm);
    const diaText = dias === 0 ? "Hoje" : dias === 1 ? "Amanhã" : `Em ${dias} dias`;
    const d = parseDate(a.data);
    const dayName = DIAS_SEMANA[d.getDay()];
    return `<div class="proximo-item">
      <div class="proximo-info">
        <strong>${escapeHtml(a.cliente)}</strong>
        <div style="font-size:0.78rem;color:var(--ink-soft);margin-top:2px;">${a.quantidade || 1}x ${escapeHtml(a.servico)}</div>
      </div>
      <span class="proximo-date">${diaText} · ${dayName}</span>
      <span class="proximo-valor">${fmtBRL(a.valorTotal)}</span>
      <button class="btn-sm btn-sage" data-realize-proximo="${a.id}">✓ Realizado</button>
    </div>`;
  }).join("");

  container.querySelectorAll("[data-realize-proximo]").forEach(btn => {
    btn.addEventListener("click", () => handleAtendStatusChange(btn.dataset.realizeProximo, "realizado"));
  });
}

async function handleAtendStatusChange(atendId, newStatus) {
  const atend = allAtendimentos.find(a => a.id === atendId);
  if (!atend) return;

  const oldStatus = atend.status || "realizado";
  if (oldStatus === newStatus) return;

  try {
    if (newStatus === "realizado" && oldStatus !== "realizado") {
      const lancPayload = {
        movimento: "entrada",
        tipo: "profissional",
        categoria: "servicos",
        valor: atend.valorTotal,
        data: atend.data,
        banco: atend.banco,
        formaPagamento: atend.formaPagamento,
        statusPagamento: atend.formaPagamento === "credito" ? "pendente" : "pago",
        fixo: false,
        descricao: `${atend.cliente} — ${atend.quantidade || 1}x ${atend.servico}`,
        origemAgendaId: atendId,
        criadoEm: serverTimestamp()
      };
      const lancRef = await addDoc(collection(db, "usuarios", currentUser.uid, "lancamentos"), lancPayload);
      await updateDoc(doc(db, "usuarios", currentUser.uid, "atendimentos", atendId), {
        status: newStatus,
        lancamentoId: lancRef.id
      });
      showToast("Atendimento realizado e lançamento criado.");
    } else if (newStatus === "cancelado" && oldStatus === "realizado") {
      if (atend.lancamentoId) {
        await deleteDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", atend.lancamentoId)).catch(() => {});
      }
      await updateDoc(doc(db, "usuarios", currentUser.uid, "atendimentos", atendId), {
        status: newStatus,
        lancamentoId: null
      });
      showToast("Atendimento cancelado e lançamento removido.");
    } else if (newStatus === "agendado" && oldStatus === "realizado") {
      if (atend.lancamentoId) {
        await deleteDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", atend.lancamentoId)).catch(() => {});
      }
      await updateDoc(doc(db, "usuarios", currentUser.uid, "atendimentos", atendId), {
        status: newStatus,
        lancamentoId: null
      });
      showToast("Atendimento reagendado.");
    } else {
      await updateDoc(doc(db, "usuarios", currentUser.uid, "atendimentos", atendId), { status: newStatus });
      showToast("Status atualizado.");
    }
  } catch (err) {
    console.error("Erro ao atualizar status:", err);
    showToast("Erro ao atualizar status.");
  }
}

// ============================================================
// METAS FINANCEIRAS (Parte 3.1)
// ============================================================
function renderMetas() {
  const now = new Date();
  const ativas = allMetas.filter(m => (m.valorAtual || 0) < m.valorObjetivo);
  const concluidas = allMetas.filter(m => (m.valorAtual || 0) >= m.valorObjetivo);
  const totalInvestido = allMetas.reduce((s, m) => s + (m.valorAtual || 0), 0);

  animateCount("kpi-metas-ativas", ativas.length);
  animateCount("kpi-metas-concluidas", concluidas.length);
  animateKPI("kpi-metas-investido", totalInvestido);

  const container = document.getElementById("metas-list");
  const emptyEl = document.getElementById("metas-empty");

  if (allMetas.length === 0) {
    container.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  const sorted = [...concluidas, ...ativas.sort((a, b) => {
    const da = parseDate(a.dataLimite);
    const db2 = parseDate(b.dataLimite);
    return da - db2;
  })];

  container.innerHTML = `<div class="metas-grid">${sorted.map(m => {
    const atual = m.valorAtual || 0;
    const pct = Math.min(100, (atual / m.valorObjetivo) * 100);
    const restante = Math.max(0, m.valorObjetivo - atual);
    const isConcluida = atual >= m.valorObjetivo;
    const dias = daysBetween(m.dataLimite, now);
    const deadlineClass = dias < 0 && !isConcluida ? "vencida" : "";
    const deadlineText = isConcluida ? "Concluída!" :
                         dias < 0 ? `Vencida há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? "s" : ""}` :
                         dias === 0 ? "Vence hoje" :
                         `${dias} dia${dias !== 1 ? "s" : ""} restante${dias !== 1 ? "s" : ""}`;

    return `<div class="meta-card ${isConcluida ? "concluida" : ""}">
      <div class="meta-nome">${escapeHtml(m.nome)}</div>
      <div class="meta-progress-track"><div class="meta-progress-fill" style="width:${pct}%"></div></div>
      <div class="meta-stats">
        <span><span class="mono">${fmtBRL(atual)}</span> de ${fmtBRL(m.valorObjetivo)}</span>
        <span class="mono">${Math.round(pct)}%</span>
      </div>
      <div class="meta-stats">
        <span>Falta: <span class="mono">${fmtBRL(restante)}</span></span>
      </div>
      <div class="meta-footer">
        <span class="meta-deadline ${deadlineClass}">${deadlineText}</span>
        <div class="meta-actions">
          ${!isConcluida ? `<button class="btn-sm btn-sage" data-aporte-meta="${m.id}">+ Aporte</button>` : ""}
          <button class="icon-btn" data-edit-meta="${m.id}" title="Editar">✎</button>
          <button class="icon-btn" data-del-meta="${m.id}" title="Excluir">🗑</button>
        </div>
      </div>
    </div>`;
  }).join("")}</div>`;

  container.querySelectorAll("[data-aporte-meta]").forEach(btn => {
    btn.addEventListener("click", () => openAporteModal(btn.dataset.aporteMeta));
  });
  container.querySelectorAll("[data-edit-meta]").forEach(btn => {
    btn.addEventListener("click", () => openMetaModal(allMetas.find(m => m.id === btn.dataset.editMeta)));
  });
  container.querySelectorAll("[data-del-meta]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir esta meta?")) return;
      await deleteDoc(doc(db, "usuarios", currentUser.uid, "metas", btn.dataset.delMeta));
      showToast("Meta excluída.");
    });
  });
}

// ============================================================
// BUDGET
// ============================================================
function renderBudget() {
  const now = new Date();
  const monthEntries = allEntries.filter(e => {
    if (e.movimento !== "saida") return false;
    const d = parseDate(e.data);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const spentByCat = sumBy(monthEntries, e => e.categoria);
  const list = document.getElementById("budget-list");

  list.innerHTML = CATEGORIES_DESPESA.map(cat => {
    const orcado = Number(userProfile.orcamentos?.[cat.id] || 0);
    const gasto = spentByCat[cat.id] || 0;
    const pct = orcado > 0 ? Math.min(100, (gasto / orcado) * 100) : 0;
    const over = orcado > 0 && gasto > orcado;
    return `<div class="budget-row">
      <div class="top-line">
        <span class="tag" style="display:flex;align-items:center;gap:8px;">
          <span class="legend-dot" style="background:${cat.color}"></span>${cat.label}
        </span>
        <span class="mono" style="font-size:0.82rem;">
          ${fmtBRL(gasto)} de
          <input type="number" min="0" step="10" value="${orcado || ""}" placeholder="0" data-budget="${cat.id}" />
        </span>
      </div>
      <div class="budget-bar-track"><div class="budget-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-budget]").forEach(input => {
    input.addEventListener("change", async () => {
      userProfile.orcamentos = userProfile.orcamentos || {};
      userProfile.orcamentos[input.dataset.budget] = Number(input.value || 0);
      await setDoc(doc(db, "usuarios", currentUser.uid), { orcamentos: userProfile.orcamentos }, { merge: true });
      showToast("Orçamento atualizado.");
      renderBudget();
    });
  });
}

// ============================================================
// INTELLIGENCE (Parte 3.4 — comparativo ano a ano)
// ============================================================
function renderIntelligence() {
  const items = [];
  const now = new Date();

  const last3Months = [];
  for (let i = 0; i < 3; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const range = getRange("month", m.getMonth(), m.getFullYear());
    const monthEntries = allEntries.filter(e => inRange(e.data, range));
    const rec = totalOf(monthEntries.filter(e => e.movimento === "entrada"));
    const desp = totalOf(monthEntries.filter(e => e.movimento === "saida"));
    const saldo = rec - desp;
    if (saldo > 0) last3Months.push(saldo);
  }

  if (last3Months.length > 0) {
    const avg = last3Months.reduce((a, b) => a + b, 0) / last3Months.length;
    const suggestion = avg * 0.2;
    items.push({ icon: "💰", text: `Sugestão de quanto guardar por mês: ${fmtBRL(suggestion)} (20% da média do saldo positivo dos últimos ${last3Months.length} meses com saldo positivo).` });

    for (let i = 0; i < 3; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthInv = allInvestimentos.filter(e => {
        const d = parseDate(e.data);
        return e.movimento === "aporte" && d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();
      });
      const aportado = totalOf(monthInv);
      const mesNome = MESES_LONGOS[m.getMonth()];
      if (aportado >= suggestion) {
        items.push({ icon: "✅", text: `${mesNome}: você aportou ${fmtBRL(aportado)} — bateu a meta sugerida de ${fmtBRL(suggestion)}.` });
      } else if (aportado > 0) {
        items.push({ icon: "⚠️", text: `${mesNome}: você aportou ${fmtBRL(aportado)}, abaixo da meta sugerida de ${fmtBRL(suggestion)}.` });
      } else {
        items.push({ icon: "❌", text: `${mesNome}: nenhum aporte registrado. Meta sugerida: ${fmtBRL(suggestion)}.` });
      }
    }
  }

  const cur = filteredEntries().filter(e => e.movimento === "saida" && !e.fixo);
  const byVarCat = sumBy(cur, e => e.categoria);
  const topVarCat = Object.keys(byVarCat).sort((a, b) => byVarCat[b] - byVarCat[a])[0];
  if (topVarCat) {
    const cat = catById(topVarCat);
    const hints = {
      alimentacao: "Tente planejar refeições da semana e evitar delivery excessivo.",
      lazer: "Defina um teto mensal para entretenimento e monitore.",
      roupas: "Avalie se todas as compras são realmente necessárias.",
      transporte: "Considere alternativas como transporte público ou caronas.",
      produtos: "Compre insumos em quantidade maior para obter descontos.",
      marketing: "Reavalie o retorno dos investimentos em publicidade."
    };
    items.push({ icon: "✂️", text: `Sugestão de corte: "${cat?.label}" é sua maior despesa variável no período (${fmtBRL(byVarCat[topVarCat])}). ${hints[topVarCat] || "Avalie se há como reduzir."}` });
  }

  const allDesp = filteredEntries().filter(e => e.movimento === "saida");
  const fixo = totalOf(allDesp.filter(e => e.fixo));
  const variavel = totalOf(allDesp.filter(e => !e.fixo));
  const totalDesp = fixo + variavel;
  if (totalDesp > 0) {
    const pctFixo = Math.round((fixo / totalDesp) * 100);
    items.push({ icon: "📊", text: `Despesas fixas: ${pctFixo}% (${fmtBRL(fixo)}) — Despesas variáveis: ${100 - pctFixo}% (${fmtBRL(variavel)}).` });
  }

  const orcamentosDefinidos = Object.keys(userProfile.orcamentos || {});
  const byCat = sumBy(allDesp, e => e.categoria);
  const estourados = orcamentosDefinidos.filter(id => {
    const orcado = Number(userProfile.orcamentos[id] || 0);
    return orcado > 0 && (byCat[id] || 0) > orcado;
  });
  if (estourados.length > 0) {
    items.push({ icon: "🚨", text: `Atenção: ${estourados.map(id => catById(id)?.label).join(", ")} já passou do orçamento definido.` });
  }

  const list = document.getElementById("intelligence-list");
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">💡</span><span class="display">Ainda sem dados suficientes</span>Lance receitas e despesas para ver análises aqui.</div>`;
  } else {
    list.innerHTML = items.map(i => `<div class="insight-card"><span class="ic">${i.icon}</span><span>${i.text}</span></div>`).join("");
  }

  renderYearComparison();

  const intelYearSel = document.getElementById("intel-year");
  const years = new Set([now.getFullYear()]);
  allEntries.forEach(e => years.add(parseDate(e.data).getFullYear()));
  const yArr = Array.from(years).sort((a, b) => b - a);
  intelYearSel.innerHTML = yArr.map(y => `<option value="${y}">${y}</option>`).join("");
  if (!intelYearSel.dataset.bound) {
    intelYearSel.dataset.bound = "1";
    intelYearSel.addEventListener("change", () => renderIntelMonthly(Number(intelYearSel.value)));
  }
  renderIntelMonthly(Number(intelYearSel.value) || now.getFullYear());
}

// ============================================================
// YEAR-OVER-YEAR COMPARISON (Parte 3.4)
// ============================================================
function renderYearComparison() {
  const container = document.getElementById("year-comparison-content");
  const hint = document.getElementById("year-comparison-hint");
  if (!container) return;

  const year = filterState.year;
  const prevYear = year - 1;
  hint.textContent = `${prevYear} vs ${year}`;

  const yearRange = getRange("year", 1, year);
  const prevRange = getRange("year", 1, prevYear);

  const yearEntries = allEntries.filter(e => inRange(e.data, yearRange));
  const prevEntries = allEntries.filter(e => inRange(e.data, prevRange));

  const recYear = totalOf(yearEntries.filter(e => e.movimento === "entrada"));
  const despYear = totalOf(yearEntries.filter(e => e.movimento === "saida"));
  const saldoYear = recYear - despYear;

  const recPrev = totalOf(prevEntries.filter(e => e.movimento === "entrada"));
  const despPrev = totalOf(prevEntries.filter(e => e.movimento === "saida"));
  const saldoPrev = recPrev - despPrev;

  const pctChange = (cur, prev) => {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / Math.abs(prev)) * 100);
  };

  const recDelta = pctChange(recYear, recPrev);
  const despDelta = pctChange(despYear, despPrev);
  const saldoDelta = pctChange(saldoYear, saldoPrev);

  const deltaHtml = (val, label, invertColors) => {
    if (val === 0) return `<span class="yc-delta neutral">Sem variação</span>`;
    const isUp = val > 0;
    const isPositive = invertColors ? !isUp : isUp;
    return `<span class="yc-delta ${isPositive ? "positive" : "negative"}">${isUp ? "↑" : "↓"} ${Math.abs(val)}% vs ${label}</span>`;
  };

  if (recPrev === 0 && despPrev === 0) {
    container.innerHTML = '<div class="chart-empty"><span class="empty-icon">📅</span><span>Sem dados do ano anterior para comparar</span></div>';
    return;
  }

  container.innerHTML = `<div class="year-comp-grid">
    <div class="year-comp-card">
      <div class="yc-label">Receita Total</div>
      <span class="yc-value" style="color:var(--sage)">${fmtBRL(recYear)}</span>
      ${deltaHtml(recDelta, prevYear, false)}
    </div>
    <div class="year-comp-card">
      <div class="yc-label">Despesa Total</div>
      <span class="yc-value" style="color:var(--danger)">${fmtBRL(despYear)}</span>
      ${deltaHtml(despDelta, prevYear, true)}
    </div>
    <div class="year-comp-card">
      <div class="yc-label">Saldo</div>
      <span class="yc-value" style="color:${saldoYear >= 0 ? "var(--sage)" : "var(--danger)"}">${fmtBRL(saldoYear)}</span>
      ${deltaHtml(saldoDelta, prevYear, false)}
    </div>
  </div>`;
}

function renderIntelMonthly(year) {
  const tbody = document.getElementById("intel-monthly-tbody");
  tbody.innerHTML = MESES_LONGOS.map((mes, i) => {
    const range = getRange("month", i, year);
    const monthEntries = allEntries.filter(e => inRange(e.data, range));
    const rec = totalOf(monthEntries.filter(e => e.movimento === "entrada"));
    const desp = totalOf(monthEntries.filter(e => e.movimento === "saida"));
    const saldo = rec - desp;
    let status, statusClass;
    if (saldo > 0) { status = "Positivo"; statusClass = "positivo"; }
    else if (saldo < 0) { status = "Negativo"; statusClass = "negativo"; }
    else { status = "Zerado"; statusClass = "zerado"; }
    return `<tr>
      <td>${mes}</td>
      <td class="amt-cell positive">${fmtBRL(rec)}</td>
      <td class="amt-cell negative">${fmtBRL(desp)}</td>
      <td class="amt-cell ${saldo >= 0 ? "positive" : "negative"}">${fmtBRL(saldo)}</td>
      <td><span class="status-badge ${statusClass}">${status}</span></td>
    </tr>`;
  }).join("");
}

// ============================================================
// SIDEBAR — Last entry
// ============================================================
function renderLastEntry() {
  const el = document.getElementById("last-entry-info");

  let latest = null;
  let latestText = "";

  allEntries.forEach(e => {
    if (e.criadoEm && (!latest || (e.criadoEm.seconds || 0) > (latest.seconds || 0))) {
      latest = e.criadoEm;
      const cat = catById(e.categoria);
      latestText = `${fmtBRL(e.valor)} em ${cat?.label || e.categoria}`;
    }
  });

  allAtendimentos.forEach(a => {
    if (a.criadoEm && (!latest || (a.criadoEm.seconds || 0) > (latest.seconds || 0))) {
      latest = a.criadoEm;
      latestText = `${fmtBRL(a.valorTotal)} — ${a.cliente}`;
    }
  });

  allInvestimentos.forEach(inv => {
    if (inv.criadoEm && (!latest || (inv.criadoEm.seconds || 0) > (latest.seconds || 0))) {
      latest = inv.criadoEm;
      latestText = `${fmtBRL(inv.valor)} em ${inv.produto}`;
    }
  });

  if (latest) {
    el.textContent = `Último lançamento: ${latestText} · ${timeAgo(latest)}`;
  } else {
    el.textContent = "";
  }
}

// ============================================================
// DATALISTS (autocomplete)
// ============================================================
function updateClienteDatalist() {
  const dl = document.getElementById("clientes-list");
  const names = [...new Set(allAtendimentos.map(a => a.cliente).filter(Boolean))];
  dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join("");
}

function updateProdutoDatalist() {
  const dl = document.getElementById("produtos-list");
  const prods = [...new Set(allInvestimentos.map(e => e.produto).filter(Boolean))];
  dl.innerHTML = prods.map(p => `<option value="${escapeHtml(p)}">`).join("");
}

// ============================================================
// MODALS — init
// ============================================================
function initModals() {
  document.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  document.getElementById("fab-add").addEventListener("click", () => {
    const view = document.querySelector(".nav-item.active")?.dataset.view;
    if (view === "investments") openInvModal(null);
    else if (view === "agenda") openAtendModal(null);
    else if (view === "metas") openMetaModal(null);
    else openEntryModal(null);
  });

  initEntryModal();
  initAtendModal();
  initInvModal();
  initMetaModal();
  initAporteModal();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("active");
}

function populateBankSelect(selId) {
  const sel = document.getElementById(selId);
  sel.innerHTML = BANKS.map(b => `<option value="${b.id}">${b.label}</option>`).join("");
}

// ============================================================
// ENTRY MODAL
// ============================================================
function initEntryModal() {
  populateBankSelect("entry-banco");

  document.querySelectorAll("#modal-entry [data-mov]").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#modal-entry [data-mov]").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      const mov = pill.dataset.mov;
      document.getElementById("entry-tipo-group").style.display = mov === "saida" ? "flex" : "none";
      document.getElementById("entry-fixo-group").style.display = mov === "saida" ? "block" : "none";
      populateEntryCategories();
    });
  });

  document.querySelectorAll("#modal-entry [data-tipo]").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#modal-entry [data-tipo]").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      populateEntryCategories();
    });
  });

  document.getElementById("entry-forma").addEventListener("change", (e) => {
    document.getElementById("entry-status-group").style.display = e.target.value === "credito" ? "block" : "none";
  });

  document.getElementById("entry-form").addEventListener("submit", handleEntrySubmit);
}

function populateEntryCategories() {
  const mov = document.querySelector("#modal-entry [data-mov].active")?.dataset.mov || "entrada";
  const tipo = document.querySelector("#modal-entry [data-tipo].active")?.dataset.tipo || "pessoal";
  const sel = document.getElementById("entry-categoria");

  if (mov === "entrada") {
    sel.innerHTML = CATEGORIES_RECEITA.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  } else {
    sel.innerHTML = CATEGORIES_DESPESA.filter(c => c.tipo === tipo).map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  }
}

function openEntryModal(entry) {
  editingEntryId = entry ? entry.id : null;
  document.getElementById("modal-entry-title").textContent = entry ? "Editar lançamento" : "Novo lançamento";
  document.getElementById("entry-error").textContent = "";
  document.getElementById("entry-submit").textContent = entry ? "Salvar alterações" : "Salvar lançamento";

  const mov = entry?.movimento || "entrada";
  document.querySelectorAll("#modal-entry [data-mov]").forEach(p => p.classList.toggle("active", p.dataset.mov === mov));
  document.getElementById("entry-tipo-group").style.display = mov === "saida" ? "flex" : "none";
  document.getElementById("entry-fixo-group").style.display = mov === "saida" ? "block" : "none";

  const tipo = entry?.tipo || "pessoal";
  document.querySelectorAll("#modal-entry [data-tipo]").forEach(p => p.classList.toggle("active", p.dataset.tipo === tipo));

  populateEntryCategories();

  document.getElementById("entry-valor").value = entry?.valor || "";
  document.getElementById("entry-data").value = entry?.data || todayStr();
  document.getElementById("entry-categoria").value = entry?.categoria || "";
  document.getElementById("entry-banco").value = entry?.banco || "outro";
  document.getElementById("entry-forma").value = entry?.formaPagamento || "pix";
  document.getElementById("entry-status").value = entry?.statusPagamento || "pago";
  document.getElementById("entry-fixo").checked = entry?.fixo || false;
  document.getElementById("entry-descricao").value = entry?.descricao || "";

  const showStatus = (entry?.formaPagamento || "pix") === "credito";
  document.getElementById("entry-status-group").style.display = showStatus ? "block" : "none";

  document.getElementById("modal-entry").classList.add("active");
}

async function handleEntrySubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("entry-error");
  const btn = document.getElementById("entry-submit");
  const mov = document.querySelector("#modal-entry [data-mov].active")?.dataset.mov || "entrada";
  const tipo = mov === "saida" ? (document.querySelector("#modal-entry [data-tipo].active")?.dataset.tipo || "pessoal") : "profissional";
  const valor = Number(document.getElementById("entry-valor").value);
  const data = document.getElementById("entry-data").value;
  const categoria = document.getElementById("entry-categoria").value;
  const banco = document.getElementById("entry-banco").value;
  const formaPagamento = document.getElementById("entry-forma").value;
  const statusPagamento = formaPagamento === "credito" ? document.getElementById("entry-status").value : "pago";
  const fixo = mov === "saida" ? document.getElementById("entry-fixo").checked : false;
  const descricao = document.getElementById("entry-descricao").value.trim();

  if (!valor || valor <= 0) { errEl.textContent = "Informe um valor válido."; return; }
  if (!categoria) { errEl.textContent = "Selecione uma categoria."; return; }

  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    const payload = { movimento: mov, tipo, valor, data, categoria, banco, formaPagamento, statusPagamento, fixo, descricao, origemAgendaId: null };
    if (editingEntryId) {
      await updateDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", editingEntryId), payload);
      showToast("Lançamento atualizado.");
    } else {
      payload.criadoEm = serverTimestamp();
      await addDoc(collection(db, "usuarios", currentUser.uid, "lancamentos"), payload);
      showToast("Lançamento adicionado.");
    }
    closeModal("modal-entry");
    document.getElementById("entry-form").reset();
    editingEntryId = null;
  } catch (err) {
    console.error(err);
    errEl.textContent = "Não foi possível salvar.";
  } finally {
    btn.disabled = false;
    btn.textContent = editingEntryId ? "Salvar alterações" : "Salvar lançamento";
  }
}

// ============================================================
// ATENDIMENTO MODAL (Parte 3.2 — com status)
// ============================================================
function initAtendModal() {
  populateBankSelect("atend-banco");

  const qtdEl = document.getElementById("atend-qtd");
  const unitEl = document.getElementById("atend-valor-unit");
  const totalEl = document.getElementById("atend-valor-total");

  const calc = () => {
    const q = Number(qtdEl.value) || 1;
    const u = Number(unitEl.value) || 0;
    totalEl.value = (q * u).toFixed(2);
  };
  qtdEl.addEventListener("input", calc);
  unitEl.addEventListener("input", calc);

  document.getElementById("atend-form").addEventListener("submit", handleAtendSubmit);
}

function openAtendModal(atend) {
  editingAtendId = atend ? atend.id : null;
  document.getElementById("modal-atend-title").textContent = atend ? "Editar atendimento" : "Novo atendimento";
  document.getElementById("atend-error").textContent = "";
  document.getElementById("atend-submit").textContent = atend ? "Salvar alterações" : "Salvar atendimento";

  document.getElementById("atend-cliente").value = atend?.cliente || "";
  document.getElementById("atend-servico").value = atend?.servico || "Limpeza de Pele";
  document.getElementById("atend-qtd").value = atend?.quantidade || 1;
  document.getElementById("atend-valor-unit").value = atend?.valorUnitario || "";
  document.getElementById("atend-valor-total").value = atend?.valorTotal || "";
  document.getElementById("atend-data").value = atend?.data || todayStr();
  document.getElementById("atend-forma").value = atend?.formaPagamento || "pix";
  document.getElementById("atend-banco").value = atend?.banco || "outro";
  document.getElementById("atend-status").value = atend?.status || "realizado";
  document.getElementById("atend-obs").value = atend?.observacao || "";

  document.getElementById("modal-atendimento").classList.add("active");
}

async function handleAtendSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("atend-error");
  const btn = document.getElementById("atend-submit");
  const cliente = document.getElementById("atend-cliente").value.trim();
  const servico = document.getElementById("atend-servico").value;
  const quantidade = Number(document.getElementById("atend-qtd").value) || 1;
  const valorUnitario = Number(document.getElementById("atend-valor-unit").value);
  const valorTotal = Number(document.getElementById("atend-valor-total").value);
  const data = document.getElementById("atend-data").value;
  const formaPagamento = document.getElementById("atend-forma").value;
  const banco = document.getElementById("atend-banco").value;
  const status = document.getElementById("atend-status").value;
  const observacao = document.getElementById("atend-obs").value.trim();

  if (!cliente) { errEl.textContent = "Informe o nome do cliente."; return; }
  if (!valorTotal || valorTotal <= 0) { errEl.textContent = "Informe um valor válido."; return; }

  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    const lancPayload = {
      movimento: "entrada",
      tipo: "profissional",
      categoria: "servicos",
      valor: valorTotal,
      data,
      banco,
      formaPagamento,
      statusPagamento: formaPagamento === "credito" ? "pendente" : "pago",
      fixo: false,
      descricao: `${cliente} — ${quantidade}x ${servico}`,
      origemAgendaId: null,
      criadoEm: serverTimestamp()
    };

    if (editingAtendId) {
      const atend = allAtendimentos.find(a => a.id === editingAtendId);
      const oldStatus = atend?.status || "realizado";

      if (status === "realizado" && oldStatus === "realizado" && atend?.lancamentoId) {
        await updateDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", atend.lancamentoId), lancPayload);
      } else if (status === "realizado" && oldStatus !== "realizado") {
        const lancRef = await addDoc(collection(db, "usuarios", currentUser.uid, "lancamentos"), lancPayload);
        await updateDoc(doc(db, "usuarios", currentUser.uid, "atendimentos", editingAtendId), {
          cliente, servico, quantidade, valorUnitario, valorTotal, data, formaPagamento, banco, observacao, status,
          lancamentoId: lancRef.id
        });
        showToast("Atendimento atualizado e lançamento criado.");
        closeModal("modal-atendimento");
        document.getElementById("atend-form").reset();
        editingAtendId = null;
        btn.disabled = false;
        btn.textContent = "Salvar atendimento";
        return;
      } else if (status !== "realizado" && oldStatus === "realizado" && atend?.lancamentoId) {
        await deleteDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", atend.lancamentoId)).catch(() => {});
      }

      await updateDoc(doc(db, "usuarios", currentUser.uid, "atendimentos", editingAtendId), {
        cliente, servico, quantidade, valorUnitario, valorTotal, data, formaPagamento, banco, observacao, status,
        lancamentoId: status === "realizado" ? (atend?.lancamentoId || null) : null
      });
      showToast("Atendimento atualizado.");
    } else {
      if (status === "realizado") {
        const lancRef = await addDoc(collection(db, "usuarios", currentUser.uid, "lancamentos"), lancPayload);
        const atendPayload = {
          cliente, servico, quantidade, valorUnitario, valorTotal, data, formaPagamento, banco, observacao, status,
          lancamentoId: lancRef.id,
          criadoEm: serverTimestamp()
        };
        const atendRef = await addDoc(collection(db, "usuarios", currentUser.uid, "atendimentos"), atendPayload);
        await updateDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", lancRef.id), { origemAgendaId: atendRef.id });
        showToast("Atendimento salvo e lançamento criado.");
      } else {
        const atendPayload = {
          cliente, servico, quantidade, valorUnitario, valorTotal, data, formaPagamento, banco, observacao, status,
          lancamentoId: null,
          criadoEm: serverTimestamp()
        };
        await addDoc(collection(db, "usuarios", currentUser.uid, "atendimentos"), atendPayload);
        showToast("Atendimento agendado.");
      }
    }

    closeModal("modal-atendimento");
    document.getElementById("atend-form").reset();
    editingAtendId = null;
  } catch (err) {
    console.error(err);
    errEl.textContent = "Não foi possível salvar.";
  } finally {
    btn.disabled = false;
    btn.textContent = editingAtendId ? "Salvar alterações" : "Salvar atendimento";
  }
}

// ============================================================
// INVESTIMENTO MODAL
// ============================================================
function initInvModal() {
  populateBankSelect("inv-banco");

  document.querySelectorAll("#modal-investimento [data-inv-mov]").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#modal-investimento [data-inv-mov]").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
    });
  });

  document.getElementById("inv-form").addEventListener("submit", handleInvSubmit);
}

function openInvModal(inv) {
  editingInvId = inv ? inv.id : null;
  document.getElementById("modal-inv-title").textContent = inv ? "Editar movimento" : "Novo movimento";
  document.getElementById("inv-error").textContent = "";
  document.getElementById("inv-submit").textContent = inv ? "Salvar alterações" : "Salvar movimento";

  document.getElementById("inv-banco").value = inv?.banco || "nubank";
  document.getElementById("inv-produto").value = inv?.produto || "";
  document.getElementById("inv-valor").value = inv?.valor || "";
  document.getElementById("inv-data").value = inv?.data || todayStr();
  document.getElementById("inv-obs").value = inv?.observacao || "";

  const mov = inv?.movimento || "aporte";
  document.querySelectorAll("#modal-investimento [data-inv-mov]").forEach(p => p.classList.toggle("active", p.dataset.invMov === mov));

  document.getElementById("modal-investimento").classList.add("active");
}

async function handleInvSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("inv-error");
  const btn = document.getElementById("inv-submit");
  const banco = document.getElementById("inv-banco").value;
  const produto = document.getElementById("inv-produto").value.trim();
  const movimento = document.querySelector("#modal-investimento [data-inv-mov].active")?.dataset.invMov || "aporte";
  const valor = Number(document.getElementById("inv-valor").value);
  const data = document.getElementById("inv-data").value;
  const observacao = document.getElementById("inv-obs").value.trim();

  if (!produto) { errEl.textContent = "Informe o produto."; return; }
  if (!valor || valor <= 0) { errEl.textContent = "Informe um valor válido."; return; }

  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    const payload = { banco, produto, movimento, valor, data, observacao };
    if (editingInvId) {
      await updateDoc(doc(db, "usuarios", currentUser.uid, "investimentos", editingInvId), payload);
      showToast("Movimento atualizado.");
    } else {
      payload.criadoEm = serverTimestamp();
      await addDoc(collection(db, "usuarios", currentUser.uid, "investimentos"), payload);
      showToast("Movimento registrado.");
    }
    closeModal("modal-investimento");
    document.getElementById("inv-form").reset();
    editingInvId = null;
  } catch (err) {
    console.error(err);
    errEl.textContent = "Não foi possível salvar.";
  } finally {
    btn.disabled = false;
    btn.textContent = editingInvId ? "Salvar alterações" : "Salvar movimento";
  }
}

// ============================================================
// META MODAL (Parte 3.1)
// ============================================================
function initMetaModal() {
  document.getElementById("meta-form").addEventListener("submit", handleMetaSubmit);
}

function openMetaModal(meta) {
  editingMetaId = meta ? meta.id : null;
  document.getElementById("modal-meta-title").textContent = meta ? "Editar meta" : "Nova meta";
  document.getElementById("meta-error").textContent = "";
  document.getElementById("meta-submit").textContent = meta ? "Salvar alterações" : "Salvar meta";

  document.getElementById("meta-nome").value = meta?.nome || "";
  document.getElementById("meta-valor-objetivo").value = meta?.valorObjetivo || "";
  document.getElementById("meta-data-limite").value = meta?.dataLimite || "";

  document.getElementById("modal-meta").classList.add("active");
}

async function handleMetaSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("meta-error");
  const btn = document.getElementById("meta-submit");
  const nome = document.getElementById("meta-nome").value.trim();
  const valorObjetivo = Number(document.getElementById("meta-valor-objetivo").value);
  const dataLimite = document.getElementById("meta-data-limite").value;

  if (!nome) { errEl.textContent = "Informe o nome da meta."; return; }
  if (!valorObjetivo || valorObjetivo <= 0) { errEl.textContent = "Informe um valor válido."; return; }
  if (!dataLimite) { errEl.textContent = "Informe a data limite."; return; }

  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    if (editingMetaId) {
      await updateDoc(doc(db, "usuarios", currentUser.uid, "metas", editingMetaId), { nome, valorObjetivo, dataLimite });
      showToast("Meta atualizada.");
    } else {
      await addDoc(collection(db, "usuarios", currentUser.uid, "metas"), {
        nome, valorObjetivo, dataLimite, valorAtual: 0, criadoEm: serverTimestamp()
      });
      showToast("Meta criada.");
    }
    closeModal("modal-meta");
    document.getElementById("meta-form").reset();
    editingMetaId = null;
  } catch (err) {
    console.error(err);
    errEl.textContent = "Não foi possível salvar.";
  } finally {
    btn.disabled = false;
    btn.textContent = editingMetaId ? "Salvar alterações" : "Salvar meta";
  }
}

// ============================================================
// APORTE MODAL (Parte 3.1)
// ============================================================
function initAporteModal() {
  document.getElementById("aporte-form").addEventListener("submit", handleAporteSubmit);
}

function openAporteModal(metaId) {
  document.getElementById("aporte-meta-id").value = metaId;
  document.getElementById("aporte-valor").value = "";
  document.getElementById("aporte-error").textContent = "";
  document.getElementById("modal-aporte").classList.add("active");
}

async function handleAporteSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("aporte-error");
  const btn = document.getElementById("aporte-submit");
  const metaId = document.getElementById("aporte-meta-id").value;
  const valor = Number(document.getElementById("aporte-valor").value);

  if (!valor || valor <= 0) { errEl.textContent = "Informe um valor válido."; return; }

  const meta = allMetas.find(m => m.id === metaId);
  if (!meta) { errEl.textContent = "Meta não encontrada."; return; }

  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    const novoValor = (meta.valorAtual || 0) + valor;
    await updateDoc(doc(db, "usuarios", currentUser.uid, "metas", metaId), { valorAtual: novoValor });
    showToast(`Aporte de ${fmtBRL(valor)} registrado.`);
    closeModal("modal-aporte");
    document.getElementById("aporte-form").reset();
  } catch (err) {
    console.error(err);
    errEl.textContent = "Não foi possível registrar o aporte.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Registrar aporte";
  }
}

// ============================================================
// TOAST
// ============================================================
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
