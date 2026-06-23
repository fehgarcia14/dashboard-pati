// ============================================================
// AUTENTICAÇÃO — index.html
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Se já está logado, manda direto pro dashboard
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "dashboard.html";
});

// ---------- Alternância de abas (Entrar / Criar conta) ----------
const tabs = document.querySelectorAll(".auth-tab");
const forms = document.querySelectorAll(".auth-form");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    forms.forEach((f) => f.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.target).classList.add("active");
  });
});

// ---------- Preview de versão na landing page ----------
document.querySelectorAll("[data-landing]").forEach(btn => {
  btn.addEventListener("click", () => {
    const perfil = btn.dataset.landing;
    document.querySelectorAll("[data-landing]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    document.getElementById("hero-salao").style.display = perfil === "salao" ? "" : "none";
    document.getElementById("hero-geral").style.display = perfil === "geral" ? "" : "none";

    document.documentElement.setAttribute("data-perfil", perfil);
    document.title = perfil === "geral"
      ? "Ficha — Controle Financeiro para Profissionais"
      : "Ficha — Controle Financeiro para Profissionais da Estética";

    // Sync signup profile selector if it exists
    const perfilHidden = document.getElementById("signup-perfil");
    if (perfilHidden) {
      perfilHidden.value = perfil;
      document.querySelectorAll(".perfil-card").forEach(c => {
        c.classList.toggle("active", c.dataset.perfil === perfil);
      });
      const fArea = document.getElementById("field-area");
      const fGeral = document.getElementById("field-area-geral");
      const aSel = document.getElementById("signup-area");
      if (perfil === "salao") {
        fArea.style.display = "";
        aSel.required = true;
        fGeral.style.display = "none";
      } else {
        fArea.style.display = "none";
        aSel.required = false;
        fGeral.style.display = "";
      }
    }
  });
});

// ---------- Seleção de perfil no cadastro ----------
const perfilCards = document.querySelectorAll(".perfil-card");
const perfilInput = document.getElementById("signup-perfil");
const fieldArea = document.getElementById("field-area");
const fieldAreaGeral = document.getElementById("field-area-geral");
const areaSelect = document.getElementById("signup-area");

perfilCards.forEach(card => {
  card.addEventListener("click", () => {
    perfilCards.forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    const perfil = card.dataset.perfil;
    perfilInput.value = perfil;

    if (perfil === "salao") {
      fieldArea.style.display = "";
      areaSelect.required = true;
      fieldAreaGeral.style.display = "none";
    } else {
      fieldArea.style.display = "none";
      areaSelect.required = false;
      fieldAreaGeral.style.display = "";
    }

    // Sync landing preview
    document.querySelectorAll("[data-landing]").forEach(b => {
      b.classList.toggle("active", b.dataset.landing === perfil);
    });
    document.getElementById("hero-salao").style.display = perfil === "salao" ? "" : "none";
    document.getElementById("hero-geral").style.display = perfil === "geral" ? "" : "none";
    document.documentElement.setAttribute("data-perfil", perfil);
  });
});

// ---------- Cadastro ----------
const signupForm = document.getElementById("signup-form");
const signupError = document.getElementById("signup-error");

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupError.textContent = "";

  const name = document.getElementById("signup-name").value.trim();
  const perfil = perfilInput.value;
  const area = perfil === "salao"
    ? areaSelect.value
    : (document.getElementById("signup-area-geral").value.trim() || "geral");
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const btn = signupForm.querySelector("button[type=submit]");

  if (password.length < 6) {
    signupError.textContent = "A senha precisa ter pelo menos 6 caracteres.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Criando conta...";

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nome: name,
      area: area,
      email: email,
      perfilNegocio: perfil,
      criadoEm: serverTimestamp(),
      orcamentos: {}
    });

    window.location.href = "dashboard.html";
  } catch (err) {
    signupError.textContent = traduzErro(err.code);
    btn.disabled = false;
    btn.textContent = "Criar minha conta";
  }
});

// ---------- Login ----------
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = loginForm.querySelector("button[type=submit]");

  btn.disabled = true;
  btn.textContent = "Entrando...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    loginError.textContent = traduzErro(err.code);
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

function traduzErro(code) {
  const mapa = {
    "auth/email-already-in-use": "Esse e-mail já está cadastrado. Tente entrar.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/weak-password": "Senha muito curta (mínimo 6 caracteres).",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo."
  };
  return mapa[code] || "Não foi possível concluir. Tente novamente.";
}
