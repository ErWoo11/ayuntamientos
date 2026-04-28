import { initializeApp }    from "firebase/app";
import { getFirestore, collection, query, where, orderBy,
         limit, getDocs, startAfter, Timestamp, doc, getDoc }
                             from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";

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
let sortOrder      = "desc";

// Set of active municipality IDs — only incidents from these are shown
let activeMuniIds  = new Set();

// ── Maps ───────────────────────────────────────────────────────────────────
const catIcons = {
  street_closure:"fa-road", parking_ban:"fa-square-parking",
  utility_cut:"fa-bolt",    roadwork:"fa-helmet-safety",
  event:"fa-calendar-check",other:"fa-circle-info"
};
const catLabels = {
  street_closure:"Corte de calles", parking_ban:"Prohibición aparcamiento",
  utility_cut:"Corte suministros",  roadwork:"Obras",
  event:"Eventos",                  other:"Otros"
};
const statusLabels = {
  planned:"Planificado", ongoing:"En curso",
  completed:"Finalizado", cancelled:"Cancelado"
};

// ── Auto-calculate status from dates ──────────────────────────────────────
// Returns the real status based on start/end dates regardless of what's stored.
// "cancelled" is never overridden — it was explicitly set by the user.
function computeStatus(data) {
  if (data.status === "cancelled") return "cancelled";

  const nowMs = Date.now();
  let startMs = null, endMs = null;

  if (data.start_date) {
    const d = data.start_date.toDate();
    startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  }
  if (data.end_date) {
    const d = data.end_date.toDate();
    endMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
  }

  if (!startMs) return data.status;

  if (nowMs < startMs)                            return "planned";
  if (endMs && nowMs > endMs)                     return "completed";
  if (nowMs >= startMs && (!endMs || nowMs <= endMs)) return "ongoing";

  return data.status;
}

// ── Load municipalities (active only) ─────────────────────────────────────
async function loadMunicipalities() {
  try {
    const snap = await getDocs(query(
      collection(db, "municipalities"),
      where("status", "==", "active"),
      orderBy("name")
    ));
    const sel = document.getElementById("muniSelect");
    activeMuniIds.clear();

    snap.forEach(d => {
      activeMuniIds.add(d.id);
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = d.data().name;
      sel.appendChild(o);
    });

    document.getElementById("statMunis").textContent = snap.size;
  } catch (e) {
    console.warn("loadMunicipalities:", e);
  }
}

// ── Build Firestore query ──────────────────────────────────────────────────
function buildQuery() {
  const conds = [where("visibility", "==", "public")];

  if (currentFilters.municipality)
    conds.push(where("municipalityId", "==", currentFilters.municipality));

  // Note: status filter is applied client-side after auto-calculation
  // to avoid Firestore index requirements and to use computed status

  conds.push(orderBy("start_date", sortOrder));
  conds.push(limit(40)); // fetch more to compensate for client-side filtering
  if (lastDoc) conds.push(startAfter(lastDoc));

  return query(collection(db, "incidents"), ...conds);
}

// ── Render a single card ───────────────────────────────────────────────────
function renderCard(id, data) {
  const realStatus = computeStatus(data);

  const card = document.createElement("article");
  card.className = "incident-card";
  card.dataset.status = realStatus;
  card.dataset.category = data.category;

  const startStr = data.start_date?.toDate().toLocaleDateString("es-ES") ?? "—";
  const endStr   = data.end_date ? data.end_date.toDate().toLocaleDateString("es-ES") : null;

  card.innerHTML = `
    <div class="card-header">
      <span class="category-badge ${data.category}">
        <i class="fas ${catIcons[data.category] || "fa-circle-info"}"></i>
        ${catLabels[data.category] || data.category}
      </span>
      <span class="status-badge">
        <span class="status-dot ${realStatus}"></span>
        ${statusLabels[realStatus] || realStatus}
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
      "<p style='text-align:center;padding:3rem;color:var(--text-muted)'>" +
      "<i class='fas fa-spinner fa-spin' style='margin-right:.5rem'></i>Cargando...</p>";
  }

  try {
    const snap      = await getDocs(buildQuery());
    const container = document.getElementById("incidentsList");

    if (reset) container.innerHTML = "";

    if (reset && snap.empty) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <i class="fas fa-bell-slash"></i>
          <p>No hay alertas para estos filtros.</p>
        </div>`;
      document.getElementById("resultsCount").textContent = "0 alertas encontradas";
      document.getElementById("loadMore").classList.add("hidden");
      if (reset) updateHeroStatsFromDB();
      return;
    }

    lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

    snap.docs.forEach(d => {
      const data = d.data();

      // ── FILTER 1: skip incidents from inactive municipalities ──────────
      if (!activeMuniIds.has(data.municipalityId)) return;

      // ── FILTER 2: skip if filtered municipality selected but not matching
      if (currentFilters.municipality && data.municipalityId !== currentFilters.municipality) return;

      // ── FILTER 3: category (client-side) ─────────────────────────────
      if (currentFilters.category && data.category !== currentFilters.category) return;

      // ── FILTER 4: status — use computed status ────────────────────────
      const realStatus = computeStatus(data);
      if (currentFilters.status && realStatus !== currentFilters.status) return;

      container.appendChild(renderCard(d.id, data));
    });

    const totalShown = container.querySelectorAll(".incident-card").length;
    document.getElementById("resultsCount").textContent =
      `${totalShown} alerta${totalShown !== 1 ? "s" : ""} encontrada${totalShown !== 1 ? "s" : ""}`;

    if (reset) await updateHeroStatsFromDB();

    // Show load more only if we got a full page AND there might be more
    document.getElementById("loadMore").classList.toggle("hidden", snap.docs.length < 40);

  } catch (err) {
    console.error("loadIncidents:", err);
    document.getElementById("incidentsList").innerHTML =
      "<p style='text-align:center;padding:2rem;color:#ef4444'>Error al cargar las alertas. Recarga la página.</p>";
  }
}

// ── Hero stats (computed from dates, not stored status) ───────────────────
async function updateHeroStatsFromDB() {
  try {
    // Fetch all public incidents and compute status client-side
    const now = Timestamp.now();
    const snap = await getDocs(query(
      collection(db, "incidents"),
      where("visibility", "==", "public"),
      limit(1000)
    ));

    let active = 0, planned = 0;
    snap.forEach(d => {
      const data = d.data();
      if (!activeMuniIds.has(data.municipalityId)) return; // skip inactive munis
      const st = computeStatus(data);
      if (st === "ongoing")  active++;
      if (st === "planned")  planned++;
    });

    document.getElementById("statActive").textContent  = active;
    document.getElementById("statPlanned").textContent = planned;
  } catch (e) {
    console.warn("updateHeroStats:", e);
  }
}

// ── Sort ──────────────────────────────────────────────────────────────────
document.getElementById("sortBtn").addEventListener("click", () => {
  sortOrder = sortOrder === "desc" ? "asc" : "desc";
  document.getElementById("sortBtn").innerHTML =
    `<i class="fas fa-arrow-${sortOrder === "desc" ? "down" : "up"}"></i> ${sortOrder === "desc" ? "Más reciente" : "Más antiguo"}`;
  applyFilters(); // applyFilters already calls updateClearBtn
});

// ── Filters ───────────────────────────────────────────────────────────────
function applyFilters() {
  currentFilters = {
    municipality: document.getElementById("muniSelect").value    || null,
    category:     document.getElementById("catSelect").value     || null,
    status:       document.getElementById("statusSelect").value  || null,
  };
  updateClearBtn();
  loadIncidents(true);
}

document.getElementById("muniSelect").addEventListener("change",   applyFilters);
document.getElementById("catSelect").addEventListener("change",    applyFilters);
document.getElementById("statusSelect").addEventListener("change", applyFilters);

document.getElementById("searchInput").addEventListener("input", e => {
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
  updateClearBtn();
});

// ── Clear filters ─────────────────────────────────────────────────────────
function hasActiveFilters() {
  return document.getElementById("muniSelect").value    !== "" ||
         document.getElementById("catSelect").value     !== "" ||
         document.getElementById("statusSelect").value  !== "" ||
         document.getElementById("searchInput").value   !== "" ||
         sortOrder !== "desc";
}

function updateClearBtn() {
  const btn = document.getElementById("clearFiltersBtn");
  if (!btn) return;
  btn.classList.toggle("visible", hasActiveFilters());
}

function clearFilters() {
  document.getElementById("muniSelect").value    = "";
  document.getElementById("catSelect").value     = "";
  document.getElementById("statusSelect").value  = "";
  document.getElementById("searchInput").value   = "";
  // Reset sort to default
  if (sortOrder !== "desc") {
    sortOrder = "desc";
    document.getElementById("sortBtn").innerHTML =
      `<i class="fas fa-arrow-down"></i> Más reciente`;
  }
  // Show all hidden cards (search may have hidden some)
  document.querySelectorAll(".incident-card").forEach(c => c.style.display = "");
  updateClearBtn();
  applyFilters();
}

document.getElementById("clearFiltersBtn")?.addEventListener("click", clearFilters);

document.getElementById("loadMore").addEventListener("click", () => loadIncidents(false));

// ── Login modal ───────────────────────────────────────────────────────────
const lModal = document.getElementById("loginModal");
document.getElementById("loginBtn").addEventListener("click", () => {
  lModal.classList.add("open");
  document.getElementById("loginEmail").focus();
});
document.getElementById("closeLoginModal").addEventListener("click", () => {
  lModal.classList.remove("open"); clearErr();
});
lModal.addEventListener("click", e => {
  if (e.target === lModal) { lModal.classList.remove("open"); clearErr(); }
});

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn   = e.target.querySelector("button[type='submit']");
  const email = document.getElementById("loginEmail").value.trim();
  const pass  = document.getElementById("loginPassword").value;

  btn.disabled  = true;
  btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Accediendo…";
  clearErr();

  try {
    const { login } = await import("./auth.js");
    await login(email, pass);
  } catch (err) {
    const msgs = {
      "auth/user-not-found":     "Email no encontrado.",
      "auth/wrong-password":     "Contraseña incorrecta.",
      "auth/invalid-credential": "Credenciales inválidas.",
      "auth/too-many-requests":  "Demasiados intentos. Inténtalo más tarde.",
      "auth/invalid-email":      "Email no válido."
    };
    showErr(msgs[err.code] || err.message);
    btn.disabled  = false;
    btn.innerHTML = "<i class='fas fa-sign-in-alt'></i> Acceder";
  }
});

function showErr(m) { const el = document.getElementById("loginError"); el.textContent = m; el.style.display = "block"; }
function clearErr() { const el = document.getElementById("loginError"); el.textContent = ""; el.style.display = "none"; }

// ── PWA ───────────────────────────────────────────────────────────────────
let dp;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); dp = e;
  const bar = document.getElementById("installBar");
  if (bar) bar.classList.remove("hidden");
});
const installBtn = document.getElementById("installBtn");
if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!dp) return;
    dp.prompt();
    const { outcome } = await dp.userChoice;
    if (outcome === "accepted") {
      const bar = document.getElementById("installBar");
      if (bar) bar.classList.add("hidden");
    }
    dp = null;
  });
}

// ── Auth redirect if already logged in ───────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) window.location.href = "/ayuntamientos/municipal.html";
});

// ── Init ──────────────────────────────────────────────────────────────────
loadMunicipalities().then(() => loadIncidents(true));
