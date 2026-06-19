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

// ---------- Cadastro ----------
const signupForm = document.getElementById("signup-form");
const signupError = document.getElementById("signup-error");

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupError.textContent = "";

  const name = document.getElementById("signup-name").value.trim();
  const area = document.getElementById("signup-area").value;
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
