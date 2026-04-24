import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc, collection, query, where, orderBy, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let userMuniId = null;
let userMuniName = null;
let incidents = [];
let currentFilter = "all";

// Mapeos de categorías y estados
const catLabels = {
  street_closure: "Corte de calle",
  parking_ban: "Prohibición aparcamiento",
  utility_cut: "Corte suministros",
  roadwork: "Obras",
  event: "Evento",
  other: "Otro"
};

const catIcons = {
  street_closure: "fa-road",
  parking_ban: "fa-parking",
  utility_cut: "fa-bolt",
  roadwork: "fa-helmet-safety",
  event: "fa-calendar-check",
  other: "fa-circle-info"
};

const statusLabels = {
  planned: "Próxima",
  ongoing: "Activa",
  completed: "Finalizada",
  cancelled: "Cancelada"
};

// Auth Listener
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserProfile();
  } else {
    window.location.href = "/index.html";
  }
});

// Cargar perfil del usuario municipal
async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (!snap.exists() || snap.data().role !== "municipal") {
      await signOut(auth);
      window.location.href = "/index.html";
      return;
    }
    
    userMuniId = snap.data().municipality_id;
    
    // Obtener nombre del municipio
    const muniSnap = await getDoc(doc(db, "municipalities", userMuniId));
    userMuniName = muniSnap.exists() ? muniSnap.data().name : "Mi Ayuntamiento";
    
    document.getElementById("userMuniDisplay").innerHTML = `<i class="fas fa-landmark"></i> ${userMuniName}`;
    document.getElementById("muniSubtitle").textContent = userMuniName;
    
    loadIncidents();
  } catch (e) {
    console.error("Error cargando perfil:", e);
  }
}

// Cargar incidencias del municipio
async function loadIncidents() {
  try {
    const q = query(
      collection(db, "incidents"),
      where("municipalityId", "==", userMuniId),
      orderBy("created_at", "desc")
    );
    const snap = await getDocs(q);
    incidents = [];
    snap.forEach(d => incidents.push({ id: d.id, ...d.data() }));
    
    updateStats();
    renderTable();
  } catch (e) {
    console.error("Error cargando incidencias:", e);
  }
}

// Actualizar estadísticas
function updateStats() {
  document.getElementById("statTotal").textContent = incidents.length;
  document.getElementById("statActive").textContent = incidents.filter(i => i.status === "ongoing").length;
  document.getElementById("statPlanned").textContent = incidents.filter(i => i.status === "planned").length;
  document.getElementById("statCompleted").textContent = incidents.filter(i => i.status === "completed").length;
}

// Renderizar tabla de incidencias
function renderTable() {
  const tbody = document.getElementById("incidentsTableBody");
  tbody.innerHTML = "";
  
  const search = document.getElementById("searchInput").value.toLowerCase();
  
  const filtered = incidents.filter(i => {
    const matchFilter = currentFilter === "all" || i.status === currentFilter;
    const matchSearch = i.title.toLowerCase().includes(search) || (i.location?.address || "").toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  filtered.forEach(i => {
    const catClass = `badge-cat-${i.category}`;
    const statusClass = `badge-status ${i.status}`;
    const dateStart = i.start_date ? i.start_date.toDate().toLocaleDateString('es-ES') : "Sin fecha";
    const dateEnd = i.end_date ? i.end_date.toDate().toLocaleDateString('es-ES') : "";
    const dateStr = dateEnd ? `${dateStart} → ${dateEnd}` : dateStart;
    const location = i.location?.address || "Sin ubicación";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="alert-title">${i.title}</div>
        <div class="alert-loc">${location}</div>
      </td>
      <td><span class="badge ${catClass}"><i class="fas ${catIcons[i.category]}"></i> ${catLabels[i.category]}</span></td>
      <td><span class="badge ${statusClass}"><span class="dot"></span> ${statusLabels[i.status]}</span></td>
      <td style="color:var(--text-muted);font-size:0.85rem;">${dateStr}</td>
      <td style="text-align:right;">
        <div class="actions">
          <button class="action-btn edit" data-id="${i.id}"><i class="fas fa-pen"></i></button>
          <button class="action-btn delete" data-id="${i.id}"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("tableFooter").textContent = `Mostrando ${filtered.length} de ${incidents.length} alertas`;
}

// Contador de caracteres para descripción
const descTextarea = document.getElementById("alertDesc");
if (descTextarea) {
  descTextarea.addEventListener("input", function() {
    const counter = document.getElementById("charCounter");
    if (counter) {
      counter.textContent = `${this.value.length}/500`;
    }
  });
}

// Abrir modal para nueva alerta
const newAlertBtn = document.getElementById("newAlertBtn");
if (newAlertBtn) {
  newAlertBtn.addEventListener("click", () => {
    document.getElementById("alertForm").reset();
    document.getElementById("alertId").value = "";
    document.getElementById("modalTitle").textContent = "Nueva alerta";
    document.getElementById("charCounter").textContent = "0/500";
    document.getElementById("modal").classList.add("open");
  });
}

// Cerrar modal
const closeModalBtn = document.getElementById("closeModal");
if (closeModalBtn) {
  closeModalBtn.addEventListener("click", () => {
    document.getElementById("modal").classList.remove("open");
  });
}

const cancelBtn = document.getElementById("cancelBtn");
if (cancelBtn) {
  cancelBtn.addEventListener("click", () => {
    document.getElementById("modal").classList.remove("open");
  });
}

// Guardar alerta (crear o editar)
const alertForm = document.getElementById("alertForm");
if (alertForm) {
  alertForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type='submit']");
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Guardando...";

    try {
      // Procesar calles afectadas (separadas por comas)
      const streetsInput = document.getElementById("alertStreets").value.trim();
      const streetsArray = streetsInput ? streetsInput.split(',').map(s => s.trim()).filter(s => s) : [];

      const data = {
        title: document.getElementById("alertTitle").value.trim(),
        description: document.getElementById("alertDesc").value.trim(),
        category: document.getElementById("alertCategory").value,
        status: document.getElementById("alertStatus").value,
        start_date: Timestamp.fromDate(new Date(document.getElementById("alertStart").value)),
        end_date: document.getElementById("alertEnd").value ? Timestamp.fromDate(new Date(document.getElementById("alertEnd").value)) : null,
        location: { address: document.getElementById("alertLocation").value.trim() },
        affected_streets: streetsArray,
        municipalityId: userMuniId,
        municipalityName: userMuniName,
        visibility: "public",
        updated_at: serverTimestamp()
      };

      const id = document.getElementById("alertId").value;
      if (id) {
        await updateDoc(doc(db, "incidents", id), data);
      } else {
        data.created_at = serverTimestamp();
        data.created_by = currentUser.uid;
        await addDoc(collection(db, "incidents"), data);
      }

      document.getElementById("modal").classList.remove("open");
      loadIncidents();
    } catch (err) {
      alert("Error al guardar: " + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });
}

// Cerrar modal al hacer click fuera
const modal = document.getElementById("modal");
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("open");
    }
  });
}

// Filtros por estado
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

// Búsqueda en tiempo real
const searchInput = document.getElementById("searchInput");
if (searchInput) {
  searchInput.addEventListener("input", renderTable);
}

// Editar/Eliminar incidencias
const tableBody = document.getElementById("incidentsTableBody");
if (tableBody) {
  tableBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    
    const id = btn.dataset.id;
    const action = btn.classList.contains("edit") ? "edit" : btn.classList.contains("delete") ? "delete" : null;

    if (action === "edit") {
      const incident = incidents.find(x => x.id === id);
      if (!incident) return;
      
      document.getElementById("alertId").value = incident.id;
      document.getElementById("alertTitle").value = incident.title;
      document.getElementById("alertDesc").value = incident.description || "";
      document.getElementById("charCounter").textContent = `${(incident.description || "").length}/500`;
      document.getElementById("alertCategory").value = incident.category;
      document.getElementById("alertStatus").value = incident.status;
      document.getElementById("alertLocation").value = incident.location?.address || "";
      document.getElementById("alertStart").value = incident.start_date ? incident.start_date.toDate().toISOString().split('T')[0] : "";
      document.getElementById("alertEnd").value = incident.end_date ? incident.end_date.toDate().toISOString().split('T')[0] : "";
      document.getElementById("alertStreets").value = (incident.affected_streets || []).join(', ');
      
      document.getElementById("modalTitle").textContent = "Editar alerta";
      document.getElementById("modal").classList.add("open");
    }

    if (action === "delete") {
      if (confirm("¿Estás seguro de eliminar esta alerta?")) {
        try {
          await deleteDoc(doc(db, "incidents", id));
          loadIncidents();
        } catch (err) {
          alert("Error al eliminar: " + err.message);
        }
      }
    }
  });
}

// Logout
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "/index.html";
  });
}