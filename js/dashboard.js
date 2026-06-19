// ============================================================
// DASHBOARD — dashboard.html
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, deleteDoc, onSnapshot, query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ------------------------------------------------------------
// Categorias (id, rótulo, tipo, cor usada nos gráficos)
// ------------------------------------------------------------
const CATEGORIES = [
  { id: "moradia",      label: "Moradia",                       tipo: "pessoal",      color: "#6B1F3D" },
  { id: "contas",       label: "Luz, Água & Internet",           tipo: "pessoal",      color: "#4F6B5E" },
  { id: "alimentacao",  label: "Alimentação",                    tipo: "pessoal",      color: "#B8893E" },
  { id: "transporte",   label: "Transporte",                     tipo: "pessoal",      color: "#5B7C99" },
  { id: "lazer",        label: "Lazer",                          tipo: "pessoal",      color: "#D98E92" },
  { id: "roupas",       label: "Roupas & Acessórios",            tipo: "pessoal",      color: "#8B5FBF" },
  { id: "saude",        label: "Saúde",                          tipo: "pessoal",      color: "#3E8E7E" },
  { id: "cartao",       label: "Cartão de Crédito",              tipo: "pessoal",      color: "#A23B3B" },
  { id: "produtos",     label: "Produtos & Insumos",             tipo: "profissional", color: "#C9A24B" },
  { id: "equipamentos", label: "Equipamentos",                   tipo: "profissional", color: "#7A5C3E" },
  { id: "cursos",       label: "Cursos & Capacitação",           tipo: "profissional", color: "#4A7A96" },
  { id: "aluguel",      label: "Aluguel de Cadeira/Espaço",      tipo: "profissional", color: "#9C5B6B" },
  { id: "marketing",    label: "Marketing & Divulgação",         tipo: "profissional", color: "#5C8A6B" },
  { id: "taxas",        label: "Taxas de Cartão (maquininha)",   tipo: "profissional", color: "#B05C3E" }
];
const catById = (id) => CATEGORIES.find((c) => c.id === id);

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MESES_LONGOS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DIAS_SEMANA = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];

const fmtBRL = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseDate = (str) => new Date(str + "T00:00:00");

let currentUser = null;
let userProfile = { nome: "", area: "", orcamentos: {} };
let allEntries = [];
let unsubscribeEntries = null;
let editingId = null;
let charts = { trend: null, categories: null, split: null };

const filterState = {
  type: "month",
  value: new Date().getMonth(),
  year: new Date().getFullYear()
};

// ------------------------------------------------------------
// AUTENTICAÇÃO / GUARDA DE ROTA
// ------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;

  const profileSnap = await getDoc(doc(db, "usuarios", user.uid));
  if (profileSnap.exists()) {
    userProfile = { orcamentos: {}, ...profileSnap.data() };
  }

  document.getElementById("user-name").textContent = userProfile.nome || user.email;
  document.getElementById("user-area").textContent = areaLabel(userProfile.area);

  initTheme();
  initFilters();
  initNav();
  initModal();
  listenEntries();

  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "grid";
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  if (unsubscribeEntries) unsubscribeEntries();
  await signOut(auth);
  window.location.href = "index.html";
});

function areaLabel(area) {
  const mapa = {
    manicure: "Manicure & Pedicure", esteticista: "Esteticista", cabeleireiro: "Cabeleireiro(a)",
    maquiador: "Maquiador(a)", depilador: "Depilador(a)", barbeiro: "Barbeiro(a)",
    massoterapeuta: "Massoterapeuta", outro: "Profissional da beleza"
  };
  return mapa[area] || "Profissional da beleza";
}

// ------------------------------------------------------------
// TEMA (claro/escuro)
// ------------------------------------------------------------
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
function applyTheme(theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  document.getElementById("theme-label").textContent = theme === "dark" ? "Modo escuro" : "Modo claro";
}

// ------------------------------------------------------------
// NAVEGAÇÃO ENTRE VIEWS
// ------------------------------------------------------------
const VIEW_TITLES = {
  overview: ["Visão Geral", "Acompanhe seus gastos pessoais e profissionais"],
  entries: ["Lançamentos", "Todos os seus gastos, lançados por você"],
  budget: ["Orçamento", "Defina limites mensais por categoria"],
  insights: ["Insights", "Leituras automáticas sobre seus números"]
};

function initNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById("view-" + view).classList.add("active");
      document.getElementById("header-title").textContent = VIEW_TITLES[view][0];
      document.getElementById("header-sub").textContent = VIEW_TITLES[view][1];
      if (view === "budget") renderBudget();
      if (view === "insights") renderInsights();
    });
  });
}

// ------------------------------------------------------------
// FILTROS (mês / trimestre / semestre / ano)
// ------------------------------------------------------------
function initFilters() {
  const typeSel = document.getElementById("filter-type");
  const yearSel = document.getElementById("filter-year");

  const years = new Set([new Date().getFullYear()]);
  allEntries.forEach((e) => years.add(parseDate(e.data).getFullYear()));
  populateYearSelect(years);

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
}

function populateYearSelect(yearsSet) {
  const yearSel = document.getElementById("filter-year");
  const years = Array.from(yearsSet).sort((a, b) => b - a);
  yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  if (!years.includes(filterState.year)) filterState.year = years[0];
  yearSel.value = String(filterState.year);
}

function defaultValueFor(type) {
  const now = new Date();
  if (type === "month") return now.getMonth();
  if (type === "quarter") return Math.floor(now.getMonth() / 3) + 1;
  if (type === "semester") return now.getMonth() < 6 ? 1 : 2;
  return 1;
}

function populateValueSelect() {
  const valueSel = document.getElementById("filter-value");
  const type = filterState.type;
  let html = "";
  if (type === "month") {
    html = MESES_LONGOS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  } else if (type === "quarter") {
    html = [1, 2, 3, 4].map((q) => `<option value="${q}">${q}º Trimestre</option>`).join("");
  } else if (type === "semester") {
    html = [1, 2].map((s) => `<option value="${s}">${s}º Semestre</option>`).join("");
  } else {
    html = `<option value="1">Ano completo</option>`;
  }
  valueSel.innerHTML = html;
  valueSel.disabled = type === "year";
  valueSel.value = String(filterState.value);
  if (valueSel.value === "" ) { filterState.value = defaultValueFor(type); valueSel.value = String(filterState.value); }
}

function getRange(type, value, year) {
  if (type === "month") {
    return { start: new Date(year, value, 1), end: new Date(year, value + 1, 0, 23, 59, 59) };
  }
  if (type === "quarter") {
    const m = (value - 1) * 3;
    return { start: new Date(year, m, 1), end: new Date(year, m + 3, 0, 23, 59, 59) };
  }
  if (type === "semester") {
    const m = (value - 1) * 6;
    return { start: new Date(year, m, 1), end: new Date(year, m + 6, 0, 23, 59, 59) };
  }
  return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59) };
}

function getPreviousRange(type, value, year) {
  if (type === "month") {
    return value === 0 ? getRange("month", 11, year - 1) : getRange("month", value - 1, year);
  }
  if (type === "quarter") {
    return value === 1 ? getRange("quarter", 4, year - 1) : getRange("quarter", value - 1, year);
  }
  if (type === "semester") {
    return value === 1 ? getRange("semester", 2, year - 1) : getRange("semester", value - 1, year);
  }
  return getRange("year", 1, year - 1);
}

function inRange(dateStr, range) {
  const d = parseDate(dateStr);
  return d >= range.start && d <= range.end;
}

function filteredEntries() {
  const range = getRange(filterState.type, filterState.value, filterState.year);
  return allEntries.filter((e) => inRange(e.data, range));
}

// ------------------------------------------------------------
// FIRESTORE — escuta lançamentos em tempo real
// ------------------------------------------------------------
function listenEntries() {
  const ref = collection(db, "usuarios", currentUser.uid, "lancamentos");
  unsubscribeEntries = onSnapshot(query(ref), (snap) => {
    allEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const years = new Set([new Date().getFullYear()]);
    allEntries.forEach((e) => years.add(parseDate(e.data).getFullYear()));
    populateYearSelect(years);
    renderAll();
  }, (err) => {
    console.error(err);
    showToast("Erro ao carregar seus dados. Verifique sua conexão.");
  });
}

// ------------------------------------------------------------
// RENDERIZAÇÃO GERAL
// ------------------------------------------------------------
function renderAll() {
  renderKPIs();
  renderCharts();
  renderEntriesTable();
  const activeView = document.querySelector(".nav-item.active")?.dataset.view;
  if (activeView === "budget") renderBudget();
  if (activeView === "insights") renderInsights();
}

function sumBy(entries, keyFn) {
  const map = {};
  entries.forEach((e) => {
    const k = keyFn(e);
    map[k] = (map[k] || 0) + Number(e.valor || 0);
  });
  return map;
}
const totalOf = (entries) => entries.reduce((s, e) => s + Number(e.valor || 0), 0);

// ---------- KPIs ----------
function renderKPIs() {
  const cur = filteredEntries();
  const prevRange = getPreviousRange(filterState.type, filterState.value, filterState.year);
  const prev = allEntries.filter((e) => inRange(e.data, prevRange));

  const total = totalOf(cur);
  const prevTotal = totalOf(prev);
  const personal = totalOf(cur.filter((e) => e.tipo === "pessoal"));
  const professional = totalOf(cur.filter((e) => e.tipo === "profissional"));

  document.getElementById("kpi-total").textContent = fmtBRL(total);
  document.getElementById("kpi-personal").textContent = fmtBRL(personal);
  document.getElementById("kpi-professional").textContent = fmtBRL(professional);

  setDelta("kpi-total-delta", total, prevTotal, "vs. período anterior");

  document.getElementById("kpi-personal-pct").textContent =
    total > 0 ? `${Math.round((personal / total) * 100)}% do total` : "—";
  document.getElementById("kpi-personal-pct").className = "delta";
  document.getElementById("kpi-professional-pct").textContent =
    total > 0 ? `${Math.round((professional / total) * 100)}% do total` : "—";
  document.getElementById("kpi-professional-pct").className = "delta";

  const byCat = sumBy(cur, (e) => e.categoria);
  const topCatId = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0];
  if (topCatId) {
    document.getElementById("kpi-top-category").textContent = catById(topCatId)?.label || topCatId;
    document.getElementById("kpi-top-category-amt").textContent = fmtBRL(byCat[topCatId]);
    document.getElementById("kpi-top-category-amt").className = "delta";
  } else {
    document.getElementById("kpi-top-category").textContent = "—";
    document.getElementById("kpi-top-category-amt").textContent = "";
  }
}

function setDelta(elId, cur, prev, suffix) {
  const el = document.getElementById(elId);
  if (prev === 0 && cur === 0) { el.textContent = ""; return; }
  if (prev === 0) { el.textContent = `Novo gasto · ${suffix}`; el.className = "delta up"; return; }
  const pct = ((cur - prev) / prev) * 100;
  const arrow = pct >= 0 ? "▲" : "▼";
  el.textContent = `${arrow} ${Math.abs(pct).toFixed(0)}% ${suffix}`;
  el.className = "delta " + (pct >= 0 ? "up" : "down");
}

// ---------- Gráficos ----------
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderCharts() {
  renderTrendChart();
  renderCategoryChart();
  renderSplitChart();
}

function renderTrendChart() {
  const ctx = document.getElementById("chart-trend");
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }
  const personalData = months.map((d) => totalOf(allEntries.filter((e) => {
    const ed = parseDate(e.data);
    return e.tipo === "pessoal" && ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
  })));
  const professionalData = months.map((d) => totalOf(allEntries.filter((e) => {
    const ed = parseDate(e.data);
    return e.tipo === "profissional" && ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
  })));

  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months.map((d) => `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`),
      datasets: [
        { label: "Pessoal", data: personalData, backgroundColor: cssVar("--primary"), borderRadius: 4, stack: "s" },
        { label: "Profissional", data: professionalData, backgroundColor: cssVar("--gold"), borderRadius: 4, stack: "s" }
      ]
    },
    options: chartBaseOptions({ stacked: true })
  });
}

function renderCategoryChart() {
  const ctx = document.getElementById("chart-categories");
  const cur = filteredEntries();
  const byCat = sumBy(cur, (e) => e.categoria);
  const ids = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);

  if (charts.categories) charts.categories.destroy();

  const legend = document.getElementById("legend-categories");
  if (ids.length === 0) {
    legend.innerHTML = `<div class="empty-state" style="padding:12px 0;">Sem lançamentos no período.</div>`;
    ctx.style.display = "none";
    return;
  }
  ctx.style.display = "block";

  charts.categories = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ids.map((id) => catById(id)?.label || id),
      datasets: [{ data: ids.map((id) => byCat[id]), backgroundColor: ids.map((id) => catById(id)?.color || "#999"), borderWidth: 0 }]
    },
    options: { plugins: { legend: { display: false } }, cutout: "62%" }
  });

  const total = totalOf(cur);
  legend.innerHTML = ids.map((id) => `
    <div class="legend-row">
      <span class="tag"><span class="legend-dot" style="background:${catById(id)?.color || "#999"}"></span>${catById(id)?.label || id}</span>
      <span class="amt">${fmtBRL(byCat[id])} · ${Math.round((byCat[id] / total) * 100)}%</span>
    </div>
  `).join("");
}

function renderSplitChart() {
  const ctx = document.getElementById("chart-split");
  const cur = filteredEntries();
  const personal = totalOf(cur.filter((e) => e.tipo === "pessoal"));
  const professional = totalOf(cur.filter((e) => e.tipo === "profissional"));

  if (charts.split) charts.split.destroy();
  charts.split = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Pessoal", "Profissional"],
      datasets: [{ data: [personal, professional], backgroundColor: [cssVar("--primary"), cssVar("--gold")], borderRadius: 6 }]
    },
    options: { ...chartBaseOptions({}), indexAxis: "y" }
  });
}

function chartBaseOptions({ stacked }) {
  const gridColor = cssVar("--line");
  const textColor = cssVar("--ink-soft");
  return {
    responsive: true,
    plugins: { legend: { display: stacked, position: "bottom", labels: { color: textColor, font: { family: "Work Sans" } } } },
    scales: {
      x: { stacked: !!stacked, grid: { display: false }, ticks: { color: textColor, font: { family: "IBM Plex Mono", size: 11 } } },
      y: { stacked: !!stacked, grid: { color: gridColor }, ticks: { color: textColor, font: { family: "IBM Plex Mono", size: 11 } } }
    }
  };
}

// ---------- Tabela de lançamentos ----------
function renderEntriesTable() {
  const cur = filteredEntries().slice().sort((a, b) => parseDate(b.data) - parseDate(a.data));
  const tbody = document.getElementById("entries-tbody");
  document.getElementById("entries-count").textContent = `${cur.length} lançamento${cur.length === 1 ? "" : "s"} no período`;

  if (cur.length === 0) {
    tbody.innerHTML = "";
    document.getElementById("entries-empty").style.display = "block";
    return;
  }
  document.getElementById("entries-empty").style.display = "none";

  tbody.innerHTML = cur.map((e) => {
    const cat = catById(e.categoria);
    const d = parseDate(e.data);
    return `
      <tr>
        <td>${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}</td>
        <td><span class="cat-pill" style="background:${cat?.color}22; color:${cat?.color}">${cat?.label || e.categoria}</span></td>
        <td><span class="type-pill ${e.tipo}">${e.tipo === "pessoal" ? "Pessoal" : "Profissional"}</span></td>
        <td>${e.descricao ? escapeHtml(e.descricao) : "—"}</td>
        <td class="amt-cell">${fmtBRL(e.valor)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-edit="${e.id}" title="Editar">✎</button>
            <button class="icon-btn" data-delete="${e.id}" title="Excluir">🗑</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allEntries.find((e) => e.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir esse lançamento?")) return;
      await deleteDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", btn.dataset.delete));
      showToast("Lançamento excluído.");
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Orçamento ----------
function renderBudget() {
  const now = new Date();
  const monthEntries = allEntries.filter((e) => {
    const d = parseDate(e.data);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const spentByCat = sumBy(monthEntries, (e) => e.categoria);
  const list = document.getElementById("budget-list");

  list.innerHTML = CATEGORIES.map((cat) => {
    const orcado = Number(userProfile.orcamentos?.[cat.id] || 0);
    const gasto = spentByCat[cat.id] || 0;
    const pct = orcado > 0 ? Math.min(100, (gasto / orcado) * 100) : 0;
    const over = orcado > 0 && gasto > orcado;
    return `
      <div class="budget-row">
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
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-budget]").forEach((input) => {
    input.addEventListener("change", async () => {
      const value = Number(input.value || 0);
      userProfile.orcamentos = userProfile.orcamentos || {};
      userProfile.orcamentos[input.dataset.budget] = value;
      await setDoc(doc(db, "usuarios", currentUser.uid), { orcamentos: userProfile.orcamentos }, { merge: true });
      showToast("Orçamento atualizado.");
      renderBudget();
    });
  });
}

// ---------- Insights ----------
function renderInsights() {
  const cur = filteredEntries();
  const prevRange = getPreviousRange(filterState.type, filterState.value, filterState.year);
  const prev = allEntries.filter((e) => inRange(e.data, prevRange));
  const list = document.getElementById("insights-list");
  const items = [];

  const total = totalOf(cur);
  const prevTotal = totalOf(prev);

  if (cur.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="display">Ainda sem dados suficientes</span>Lance alguns gastos no período selecionado para ver insights aqui.</div>`;
    return;
  }

  if (prevTotal > 0) {
    const pct = ((total - prevTotal) / prevTotal) * 100;
    items.push({
      icon: pct >= 0 ? "📈" : "📉",
      text: `Seus gastos ${pct >= 0 ? "subiram" : "caíram"} ${Math.abs(pct).toFixed(0)}% em relação ao período anterior (${fmtBRL(prevTotal)} → ${fmtBRL(total)}).`
    });
  }

  const byCat = sumBy(cur, (e) => e.categoria);
  const topCatId = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0];
  if (topCatId) {
    const pct = Math.round((byCat[topCatId] / total) * 100);
    items.push({ icon: "🏷️", text: `"${catById(topCatId)?.label}" é sua maior categoria neste período, representando ${pct}% do total (${fmtBRL(byCat[topCatId])}).` });
  }

  const personal = totalOf(cur.filter((e) => e.tipo === "pessoal"));
  const professional = totalOf(cur.filter((e) => e.tipo === "profissional"));
  if (professional > personal) {
    items.push({ icon: "💼", text: `Seus gastos profissionais (${fmtBRL(professional)}) superaram os pessoais (${fmtBRL(personal)}) neste período.` });
  } else if (personal > 0) {
    items.push({ icon: "🏠", text: `Seus gastos pessoais (${fmtBRL(personal)}) representam a maior parte do período, frente a ${fmtBRL(professional)} em despesas profissionais.` });
  }

  const byWeekday = {};
  cur.forEach((e) => {
    const d = parseDate(e.data).getDay();
    byWeekday[d] = (byWeekday[d] || 0) + Number(e.valor || 0);
  });
  const topDay = Object.keys(byWeekday).sort((a, b) => byWeekday[b] - byWeekday[a])[0];
  if (topDay !== undefined) {
    items.push({ icon: "📅", text: `${DIAS_SEMANA[topDay]} é o dia da semana com maior concentração de gastos no período.` });
  }

  const ticketMedio = total / cur.length;
  items.push({ icon: "🧾", text: `Você fez ${cur.length} lançamento${cur.length === 1 ? "" : "s"} no período, com ticket médio de ${fmtBRL(ticketMedio)}.` });

  const orcamentosDefinidos = Object.keys(userProfile.orcamentos || {});
  const estourados = orcamentosDefinidos.filter((id) => {
    const orcado = Number(userProfile.orcamentos[id] || 0);
    return orcado > 0 && (byCat[id] || 0) > orcado;
  });
  if (estourados.length > 0) {
    items.push({ icon: "⚠️", text: `Atenção: ${estourados.map((id) => catById(id)?.label).join(", ")} já passou do orçamento definido para o mês.` });
  }

  list.innerHTML = items.map((i) => `<div class="insight-card"><span class="ic">${i.icon}</span><span>${i.text}</span></div>`).join("");
}

// ------------------------------------------------------------
// MODAL — adicionar / editar lançamento
// ------------------------------------------------------------
function initModal() {
  document.getElementById("fab-add").addEventListener("click", () => openModal(null));
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });

  document.querySelectorAll(".toggle-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".toggle-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      populateCategorySelect(pill.dataset.tipo);
    });
  });

  document.getElementById("entry-form").addEventListener("submit", handleSubmitEntry);
}

function populateCategorySelect(tipo) {
  const sel = document.getElementById("entry-categoria");
  sel.innerHTML = CATEGORIES.filter((c) => c.tipo === tipo).map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
}

function openModal(entry) {
  editingId = entry ? entry.id : null;
  document.getElementById("modal-title").textContent = entry ? "Editar gasto" : "Novo gasto";
  document.getElementById("entry-error").textContent = "";
  document.getElementById("entry-submit").textContent = entry ? "Salvar alterações" : "Salvar gasto";

  const tipo = entry?.tipo || "pessoal";
  document.querySelectorAll(".toggle-pill").forEach((p) => p.classList.toggle("active", p.dataset.tipo === tipo));
  populateCategorySelect(tipo);

  document.getElementById("entry-valor").value = entry?.valor || "";
  document.getElementById("entry-data").value = entry?.data || new Date().toISOString().slice(0, 10);
  document.getElementById("entry-categoria").value = entry?.categoria || "";
  document.getElementById("entry-descricao").value = entry?.descricao || "";

  document.getElementById("modal-backdrop").classList.add("active");
}
function closeModal() {
  document.getElementById("modal-backdrop").classList.remove("active");
  document.getElementById("entry-form").reset();
  editingId = null;
}

async function handleSubmitEntry(e) {
  e.preventDefault();
  const errEl = document.getElementById("entry-error");
  const btn = document.getElementById("entry-submit");
  const tipo = document.querySelector(".toggle-pill.active").dataset.tipo;
  const valor = Number(document.getElementById("entry-valor").value);
  const data = document.getElementById("entry-data").value;
  const categoria = document.getElementById("entry-categoria").value;
  const descricao = document.getElementById("entry-descricao").value.trim();

  if (!valor || valor <= 0) { errEl.textContent = "Informe um valor válido."; return; }
  if (!categoria) { errEl.textContent = "Selecione uma categoria."; return; }

  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    const payload = { tipo, valor, data, categoria, descricao };
    if (editingId) {
      await updateDoc(doc(db, "usuarios", currentUser.uid, "lancamentos", editingId), payload);
      showToast("Gasto atualizado.");
    } else {
      await addDoc(collection(db, "usuarios", currentUser.uid, "lancamentos"), payload);
      showToast("Gasto adicionado.");
    }
    closeModal();
  } catch (err) {
    console.error(err);
    errEl.textContent = "Não foi possível salvar. Tente novamente.";
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? "Salvar alterações" : "Salvar gasto";
  }
}

// ------------------------------------------------------------
// TOAST
// ------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
