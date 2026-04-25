import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, query, where, orderBy, limit,
  getDocs, startAfter, Timestamp
} from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";

// ── Firebase config ────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBzidosSZRxKmjMIrg0zAjYRt_rbohcHLU",
  authDomain: "saas-45027.firebaseapp.com",
  projectId: "saas-45027",
  storageBucket: "saas-45027.firebasestorage.app",
  messagingSenderId: "117144809845",
  appId: "1:117144809845:web:83153cf3aa6bc97851233c"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ── State ──────────────────────────────────────────────────────────────────
let lastDoc        = null;
let currentFilters = {};
let sortOrder      = "desc"; // "desc" | "asc"

// ── Category / status maps ─────────────────────────────────────────────────
const catIcons = {
  street_closure: "fa-road",
  parking_ban:    "fa-square-parking",
  utility_cut:    "fa-bolt",
  roadwork:       "fa-helmet-safety",
  event:          "fa-calendar-check",
  other:          "fa-circle-info"
};
const catLabels = {
  street_closure: "Corte de calles",
  parking_ban:    "Prohibición aparcamiento",
  utility_cut:    "Corte suministros",
  roadwork:       "Obras",
  event:          "Eventos",
  other:          "Otros"
};
const statusLabels = {
  planned:   "Planificado",
  ongoing:   "En curso",
  completed: "Finalizado",
  cancelled: "Cancelado"
};

// ── Load municipalities dropdown ───────────────────────────────────────────
async function loadMunicipalities() {
  try {
    const snap   = await getDocs(query(collection(db, "municipalities"), where("status", "==", "active"), orderBy("name")));
    const select = document.getElementById("muniSelect");
    snap.forEach(d => {
      const opt       = document.createElement("option");
      opt.value       = d.id;
      opt.textContent = d.data().name;
      select.appendChild(opt);
    });
    // Update hero stat
    document.getElementById("statMunis").textContent = snap.size;
  } catch (e) {
    console.warn("Error cargando municipios:", e);
  }
}

// ── Build Firestore query ──────────────────────────────────────────────────
function buildQuery() {
  const conds = [where("visibility", "==", "public")];

  if (currentFilters.municipality)
    conds.push(where("municipalityId", "==", currentFilters.municipality));

  if (currentFilters.status)
    conds.push(where("status", "==", currentFilters.status));

  if (currentFilters.dateFrom)
    conds.push(where("start_date", ">=", Timestamp.fromDate(new Date(currentFilters.dateFrom))));

  if (currentFilters.dateTo)
    conds.push(where("start_date", "<=", Timestamp.fromDate(new Date(currentFilters.dateTo + "T23:59:59"))));

  conds.push(orderBy("start_date", sortOrder));
  conds.push(limit(20));
  if (lastDoc) conds.push(startAfter(lastDoc));

  return query(collection(db, "incidents"), ...conds);
}

// ── Render a single card ───────────────────────────────────────────────────
function renderCard(id, data) {
  const card = document.createElement("article");
  card.className = "incident-card";

  const startStr = data.start_date?.toDate().toLocaleDateString("es-ES") ?? "—";
  const endStr   = data.end_date   ? data.end_date.toDate().toLocaleDateString("es-ES") : null;

  card.innerHTML = `
    <div class="card-header">
      <span class="category-badge ${data.category}">
        <i class="fas ${catIcons[data.category] || "fa-circle-info"}"></i>
        ${catLabels[data.category] || data.category}
      </span>
      <span class="status-badge">
        <span class="status-dot ${data.status}"></span>
        ${statusLabels[data.status] || data.status}
      </span>
    </div>
    <h3 class="card-title">${data.title}</h3>
    <p class="card-muni"><i class="fas fa-landmark"></i> ${data.municipalityName || "Municipio"}</p>
    <p class="card-desc">${data.description || ""}</p>
    <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.25rem;">
      <span style="font-size:0.82rem;color:var(--text-muted);">
        <i class="fas fa-calendar" style="width:14px;"></i>
        ${startStr}${endStr ? " → " + endStr : ""}
      </span>
      <span style="font-size:0.82rem;color:var(--text-muted);">
        <i class="fas fa-map-marker-alt" style="width:14px;"></i>
        ${data.location?.address || "Ubicación no especificada"}
      </span>
    </div>
  `;

  // Click → detail page
  card.style.cursor = "pointer";
  card.addEventListener("click", () => {
    window.location.href = `/ayuntamientos/incident-detail.html?id=${id}`;
  });

  return card;
}

// ── Load incidents ─────────────────────────────────────────────────────────
async function loadIncidents(reset = true) {
  if (reset) {
    lastDoc = null;
    document.getElementById("incidentsList").innerHTML =
      "<p style='text-align:center;padding:3rem;color:var(--text-muted);'><i class='fas fa-spinner fa-spin' style='margin-right:0.5rem;'></i>Cargando...</p>";
  }

  try {
    const snap     = await getDocs(buildQuery());
    const container = document.getElementById("incidentsList");

    if (reset) {
      if (snap.empty) {
        container.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1;">
            <i class="fas fa-bell-slash"></i>
            <p>No hay alertas para estos filtros.</p>
          </div>`;
        document.getElementById("resultsCount").textContent = "0 alertas encontradas";
        document.getElementById("loadMore").classList.add("hidden");
        updateHeroStats(0, 0);
        return;
      }
      container.innerHTML = "";
    }

    lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

    // Category filter (client-side, since Firestore can't combine it with orderBy without composite index)
    const toRender = currentFilters.category
      ? snap.docs.filter(d => d.data().category === currentFilters.category)
      : snap.docs;

    toRender.forEach(d => container.appendChild(renderCard(d.id, d.data())));

    // Results count
    const totalShown = container.querySelectorAll(".incident-card").length;
    document.getElementById("resultsCount").textContent = `${totalShown} alerta${totalShown !== 1 ? "s" : ""} encontrada${totalShown !== 1 ? "s" : ""}`;

    // Hero stats (only on first load / reset)
    if (reset) await updateHeroStatsFromDB();

    // Load more button
    document.getElementById("loadMore").classList.toggle("hidden", snap.docs.length < 20);

  } catch (err) {
    console.error("Error cargando incidencias:", err);
    document.getElementById("incidentsList").innerHTML =
      "<p style='text-align:center;padding:2rem;color:#ef4444;'>Error al cargar las alertas. Recarga la página.</p>";
  }
}

// ── Hero stats ─────────────────────────────────────────────────────────────
async function updateHeroStatsFromDB() {
  try {
    const [activeSnap, plannedSnap] = await Promise.all([
      getDocs(query(collection(db, "incidents"), where("visibility", "==", "public"), where("status", "==", "ongoing"),  limit(500))),
      getDocs(query(collection(db, "incidents"), where("visibility", "==", "public"), where("status", "==", "planned"),  limit(500)))
    ]);
    document.getElementById("statActive").textContent  = activeSnap.size;
    document.getElementById("statPlanned").textContent = plannedSnap.size;
  } catch (e) {
    console.warn("Error actualizando stats:", e);
  }
}

// ── Sort button ────────────────────────────────────────────────────────────
document.getElementById("sortBtn").addEventListener("click", () => {
  sortOrder = sortOrder === "desc" ? "asc" : "desc";
  document.getElementById("sortBtn").innerHTML =
    `<i class="fas fa-arrow-${sortOrder === "desc" ? "down" : "up"}"></i> ${sortOrder === "desc" ? "Más reciente" : "Más antiguo"}`;
  applyFilters();
});

// ── Filters ────────────────────────────────────────────────────────────────
function applyFilters() {
  currentFilters = {
    municipality: document.getElementById("muniSelect").value    || null,
    category:     document.getElementById("catSelect").value     || null,
    status:       document.getElementById("statusSelect").value  || null,
  };
  loadIncidents(true);
}

document.getElementById("muniSelect").addEventListener("change",   applyFilters);
document.getElementById("catSelect").addEventListener("change",    applyFilters);
document.getElementById("statusSelect").addEventListener("change", applyFilters);

// Search (client-side filter on rendered cards)
document.getElementById("searchInput").addEventListener("input", (e) => {
  const term  = e.target.value.toLowerCase();
  const cards = document.querySelectorAll(".incident-card");
  let visible = 0;
  cards.forEach(c => {
    const match = c.textContent.toLowerCase().includes(term);
    c.style.display = match ? "" : "none";
    if (match) visible++;
  });
  document.getElementById("resultsCount").textContent =
    `${visible} alerta${visible !== 1 ? "s" : ""} encontrada${visible !== 1 ? "s" : ""}`;
});

// Load more
document.getElementById("loadMore").addEventListener("click", () => loadIncidents(false));

// ── Login modal ────────────────────────────────────────────────────────────
document.getElementById("loginBtn").addEventListener("click", () => {
  document.getElementById("loginModal").classList.add("open");
  document.getElementById("loginEmail").focus();
});

document.getElementById("closeLoginModal").addEventListener("click", () => {
  document.getElementById("loginModal").classList.remove("open");
  clearLoginError();
});

document.getElementById("loginModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("loginModal")) {
    document.getElementById("loginModal").classList.remove("open");
    clearLoginError();
  }
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn   = e.target.querySelector("button[type='submit']");
  const email = document.getElementById("loginEmail").value.trim();
  const pass  = document.getElementById("loginPassword").value;

  btn.disabled   = true;
  btn.innerHTML  = "<i class='fas fa-spinner fa-spin'></i> Accediendo...";
  clearLoginError();

  try {
    const { login } = await import("./auth.js");
    await login(email, pass); // redirects on success
  } catch (err) {
    const msgs = {
      "auth/user-not-found":     "Email no encontrado.",
      "auth/wrong-password":     "Contraseña incorrecta.",
      "auth/invalid-credential": "Credenciales inválidas.",
      "auth/too-many-requests":  "Demasiados intentos. Inténtalo más tarde.",
      "auth/invalid-email":      "Email no válido."
    };
    showLoginError(msgs[err.code] || err.message);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "<i class='fas fa-sign-in-alt'></i> Acceder";
  }
});

function showLoginError(msg) {
  const el = document.getElementById("loginError");
  el.textContent = msg;
  el.style.display = "block";
}
function clearLoginError() {
  const el = document.getElementById("loginError");
  el.textContent  = "";
  el.style.display = "none";
}

// ── PWA install prompt ─────────────────────────────────────────────────────
let deferredPrompt;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  const bar = document.getElementById("installBar");
  if (bar) bar.classList.remove("hidden");
});

const installBtn = document.getElementById("installBtn");
if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      const bar = document.getElementById("installBar");
      if (bar) bar.classList.add("hidden");
    }
    deferredPrompt = null;
  });
}

// ── Auth redirect if already logged in ────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) window.location.href = "/ayuntamientos/municipal.html";
});

// ── Init ───────────────────────────────────────────────────────────────────
loadMunicipalities();
loadIncidents(true);
