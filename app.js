import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, orderBy, limit, getDocs, startAfter, Timestamp, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

enableIndexedDbPersistence(db).catch(err => console.warn("Caché offline no disponible:", err.code));

let lastDoc = null;
let currentFilters = {};

async function loadMunicipalities() {
  const snap = await getDocs(query(collection(db, "municipalities"), where("status", "==", "active")));
  const select = document.getElementById("muniSelect");
  snap.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().name;
    select.appendChild(opt);
  });
}

function buildQuery() {
  const conditions = [];
  conditions.push(where("visibility", "==", "public"));
  if (currentFilters.municipality) conditions.push(where("municipalityId", "==", currentFilters.municipality));
  if (currentFilters.dateFrom) conditions.push(where("start_date", ">=", Timestamp.fromDate(new Date(currentFilters.dateFrom))));
  if (currentFilters.dateTo) conditions.push(where("start_date", "<=", Timestamp.fromDate(new Date(currentFilters.dateTo + "T23:59:59"))));
  conditions.push(orderBy("start_date", "desc"));
  conditions.push(limit(20));
  if (lastDoc) conditions.push(startAfter(lastDoc));
  return query(collection(db, "incidents"), ...conditions.filter(Boolean));
}

async function loadIncidents(reset = true) {
  if (reset) {
    lastDoc = null;
    document.getElementById("incidentsList").innerHTML = "<p style='text-align:center;'>Cargando...</p>";
  }

  const snap = await getDocs(buildQuery());
  const container = document.getElementById("incidentsList");
  if (reset && snap.empty) container.innerHTML = "<p style='text-align:center;'>No hay avisos para estos filtros.</p>";
  else if (reset) container.innerHTML = "";
  
  lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

  snap.forEach(doc => {
    const data = doc.data();
    if (currentFilters.category && data.category !== currentFilters.category) return;
    
    const statusMap = { planned: "Planificado", ongoing: "En curso", completed: "Finalizado", cancelled: "Cancelado" };
    const catMap = { street_closure: "Corte de calles", parking_ban: "Prohibición aparcamiento", utility_cut: "Corte suministros", roadwork: "Obras", event: "Eventos", other: "Otros" };

    const card = document.createElement("article");
    card.className = "incident-card";
    card.innerHTML = `
      <span class="badge status-${data.status}">${statusMap[data.status] || data.status}</span>
      <h3>${data.title}</h3>
      <p class="cat">${catMap[data.category] || data.category}</p>
      <p class="desc">${data.description}</p>
      <p class="dates">📅 ${data.start_date?.toDate().toLocaleDateString('es-ES')} → ${data.end_date ? data.end_date.toDate().toLocaleDateString('es-ES') : 'Sin fecha fin'}</p>
      <p class="loc">📍 ${data.location?.address || 'Ubicación no especificada'}</p>
      <p class="muni">🏛️ ${data.municipalityName || 'Municipio'}</p>
    `;
    container.appendChild(card);
  });

  document.getElementById("loadMore").style.display = snap.docs.length === 20 ? "block" : "none";
}

// CORREGIDO: Arrow functions sin espacios
document.getElementById("applyFilters").addEventListener("click", () => {
  currentFilters = {
    municipality: document.getElementById("muniSelect").value,
    category: document.getElementById("catSelect").value,
    dateFrom: document.getElementById("dateFrom").value || null,
    dateTo: document.getElementById("dateTo").value || null
  };
  loadIncidents(true);
});

document.getElementById("loadMore").addEventListener("click", () => loadIncidents(false));
document.getElementById("loginBtn").addEventListener("click", () => window.location.href = "/municipal.html");

let deferredPrompt;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById("installPrompt").classList.remove("hidden");
});

document.getElementById("installBtn").addEventListener("click", async () => {
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === "accepted") document.getElementById("installPrompt").classList.add("hidden");
});

onAuthStateChanged(auth, user => { if (user) window.location.href = "/municipal.html"; });

loadMunicipalities();
loadIncidents(true);