# Ficha — Dashboard Financeiro para Profissionais da Estética

Web app onde cada pessoa cria sua conta, faz login e lança seus próprios gastos
pessoais e profissionais (produtos, equipamentos, cartão, moradia, cursos...),
acompanhando tudo em dashboards interativos. Nenhuma planilha precisa ser aberta —
os dados ficam guardados na nuvem (Firebase), separados por usuário.

## Stack

- HTML, CSS e JavaScript puro (sem build, sem framework)
- **Firebase Authentication** — login/cadastro por e-mail e senha
- **Firebase Firestore** — banco de dados em tempo real, um "espaço" por usuário
- **Chart.js** — gráficos
- Hospedagem: **GitHub Pages** (estático e gratuito)

## Estrutura de pastas

```
dashboard-estetica/
├── index.html          → tela de login / cadastro
├── dashboard.html       → o app em si (protegido por login)
├── css/styles.css
├── js/
│   ├── firebase-config.js   ← você edita este arquivo
│   ├── auth.js
│   └── dashboard.js
└── firestore.rules     → regras de segurança (colar no painel do Firebase)
```

---

## Passo 1 — Criar o projeto no Firebase (gratuito)

1. Acesse **https://console.firebase.google.com** e entre com uma conta Google.
2. Clique em **Adicionar projeto** → dê um nome (ex: `ficha-estetica`) → pode desativar o Google Analytics → **Criar projeto**.
3. No menu lateral, clique em **Build → Authentication → Get started**.
   - Na aba **Sign-in method**, ative o provedor **E-mail/senha**.
4. No menu lateral, clique em **Build → Firestore Database → Create database**.
   - Escolha **Iniciar em modo de produção** → escolha uma região (ex: `southamerica-east1` para Brasil) → **Ativar**.
5. Ainda no Firestore, vá na aba **Regras** (Rules), apague o conteúdo e cole o conteúdo do arquivo `firestore.rules` deste projeto → **Publicar**.

## Passo 2 — Pegar as chaves do projeto

1. No console do Firebase, clique no ícone de **engrenagem** (canto superior esquerdo) → **Configurações do projeto**.
2. Role até **Seus apps** → clique no ícone **`</>`** (Web) → dê um nome (ex: `ficha-web`) → **Registrar app**.
3. O Firebase vai te mostrar um bloco de código com `firebaseConfig = {...}`. Copie esses valores.
4. Abra o arquivo `js/firebase-config.js` deste projeto e substitua os valores de exemplo pelos seus:

```js
export const firebaseConfig = {
  apiKey: "sua-chave-aqui",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

> Essas chaves identificam seu projeto — elas não são secretas como uma senha.
> Quem realmente protege os dados são as **Regras do Firestore** (passo 1.5), que
> garantem que cada pessoa só vê os próprios lançamentos.

## Passo 3 — Testar localmente (opcional)

Como o projeto usa módulos JavaScript (`type="module"`), não dá pra simplesmente
abrir o `index.html` clicando duas vezes — o navegador bloqueia por segurança.
Rode um servidor local simples:

```bash
# dentro da pasta dashboard-estetica
python3 -m http.server 8000
```

Depois acesse `http://localhost:8000` no navegador.

## Passo 4 — Publicar no GitHub Pages

1. Crie um repositório novo no GitHub (ex: `dashboard-estetica`).
2. Suba todos os arquivos desta pasta para a raiz do repositório.
3. No repositório, vá em **Settings → Pages**.
4. Em **Source**, selecione a branch `main` e a pasta `/ (root)` → **Save**.
5. Em alguns minutos seu site estará em `https://seu-usuario.github.io/dashboard-estetica/`.

## Passo 5 — Autorizar o domínio no Firebase

1. Volte ao console do Firebase → **Authentication → Settings → Authorized domains**.
2. Clique em **Add domain** e adicione `seu-usuario.github.io`.
   (sem isso, o login funciona localmente mas é bloqueado no site publicado)

---

## Categorias incluídas

**Pessoais:** Moradia, Luz/Água/Internet, Alimentação, Transporte, Lazer,
Roupas & Acessórios, Saúde, Cartão de Crédito.

**Profissionais:** Produtos & Insumos, Equipamentos, Cursos & Capacitação,
Aluguel de Cadeira/Espaço, Marketing & Divulgação, Taxas de Cartão (maquininha).

Quer mudar, adicionar ou remover categorias? Edite o array `CATEGORIES` no
início do arquivo `js/dashboard.js` — cada categoria tem `id`, `label`, `tipo`
(`pessoal` ou `profissional`) e `color` (usada nos gráficos).

## Funcionalidades

- Cadastro e login por e-mail/senha, dados isolados por usuário
- Lançamento de gastos (valor, data, categoria, tipo, descrição)
- Edição e exclusão de lançamentos
- KPIs do período: total, pessoal x profissional, maior categoria, variação vs. período anterior
- Gráfico de evolução mensal (últimos 12 meses)
- Gráfico de distribuição por categoria
- Filtros por mês, trimestre, semestre e ano + botão de limpar filtros
- Orçamento mensal por categoria, com barra de progresso
- Insights automáticos sobre os gastos do período
- Modo claro/escuro

## Possíveis evoluções futuras

- Login com Google (além de e-mail/senha)
- Exportar lançamentos para CSV/Excel
- Anexar foto do comprovante a cada lançamento (Firebase Storage)
- Metas de economia mensal
