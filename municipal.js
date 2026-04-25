import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import {
  getFirestore, doc, getDoc, collection, query, where, orderBy,
  addDoc, updateDoc, deleteDoc, getDocs, serverTimestamp, Timestamp
} from "firebase/firestore";

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
const auth = getAuth(app);
const db   = getFirestore(app);

// ── State ──────────────────────────────────────────────────────────────────
let currentUser  = null;
let userMuniId   = null;
let userMuniName = null;
let incidents    = [];
let currentFilter = "all";

// ── Label maps ────────────────────────────────────────────────────────────
const catLabels = {
  street_closure: "Corte de calle",
  parking_ban:    "Prohibición aparcamiento",
  utility_cut:    "Corte suministros",
  roadwork:       "Obras",
  event:          "Evento",
  other:          "Otro"
};
const catIcons = {
  street_closure: "fa-road",
  parking_ban:    "fa-parking",
  utility_cut:    "fa-bolt",
  roadwork:       "fa-helmet-safety",
  event:          "fa-calendar-check",
  other:          "fa-circle-info"
};
const statusLabels = {
  planned:   "Próxima",
  ongoing:   "Activa",
  completed: "Finalizada",
  cancelled: "Cancelada"
};

// ── Auth listener ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserProfile();
  } else {
    window.location.href = "/ayuntamientos/index.html";
  }
});

// ── Load user profile ─────────────────────────────────────────────────────
async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (!snap.exists() || snap.data().role !== "municipal") {
      await signOut(auth);
      window.location.href = "/ayuntamientos/index.html";
      return;
    }

    const userData = snap.data();

    // Check municipality is active
    if (userData.status === "inactive") {
      await signOut(auth);
      window.location.href = "/ayuntamientos/index.html";
      return;
    }

    userMuniId = userData.municipality_id;

    const muniSnap = await getDoc(doc(db, "municipalities", userMuniId));
    userMuniName   = muniSnap.exists() ? muniSnap.data().name : "Mi Ayuntamiento";

    document.getElementById("userMuniDisplay").innerHTML = `<i class="fas fa-landmark"></i> ${userMuniName}`;
    document.getElementById("muniSubtitle").textContent  = userMuniName;

    loadIncidents();
  } catch (e) {
    console.error("Error cargando perfil:", e);
  }
}

// ── Load incidents ────────────────────────────────────────────────────────
async function loadIncidents() {
  try {
    const q    = query(
      collection(db, "incidents"),
      where("municipalityId", "==", userMuniId),
      orderBy("created_at", "desc")
    );
    const snap = await getDocs(q);
    incidents  = [];
    snap.forEach(d => incidents.push({ id: d.id, ...d.data() }));

    updateStats();
    renderTable();
  } catch (e) {
    console.error("Error cargando incidencias:", e);
    showTableError("Error al cargar las alertas.");
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById("statTotal").textContent     = incidents.length;
  document.getElementById("statActive").textContent    = incidents.filter(i => i.status === "ongoing").length;
  document.getElementById("statPlanned").textContent   = incidents.filter(i => i.status === "planned").length;
  document.getElementById("statCompleted").textContent = incidents.filter(i => i.status === "completed").length;
}

// ── Render table ──────────────────────────────────────────────────────────
function renderTable() {
  const tbody  = document.getElementById("incidentsTableBody");
  tbody.innerHTML = "";

  const search   = document.getElementById("searchInput").value.toLowerCase();
  const filtered = incidents.filter(i => {
    const matchFilter = currentFilter === "all" || i.status === currentFilter;
    const matchSearch = i.title.toLowerCase().includes(search) ||
                        (i.location?.address || "").toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:#9ca3af;">
      <i class="fas fa-bell-slash" style="font-size:1.5rem;display:block;margin-bottom:0.5rem;"></i>
      No hay alertas${currentFilter !== "all" ? " con este filtro" : ""}
    </td></tr>`;
    document.getElementById("tableFooter").textContent = "Mostrando 0 alertas";
    return;
  }

  filtered.forEach(i => {
    const dateStart = i.start_date ? i.start_date.toDate().toLocaleDateString("es-ES") : "Sin fecha";
    const dateEnd   = i.end_date   ? i.end_date.toDate().toLocaleDateString("es-ES")   : "";
    const dateStr   = dateEnd ? `${dateStart} → ${dateEnd}` : dateStart;
    const location  = i.location?.address || "Sin ubicación";

    // Map category class names to badge classes
    const catClassMap = {
      street_closure: "badge-cat-closure",
      parking_ban:    "badge-cat-parking",
      utility_cut:    "badge-cat-utility",
      roadwork:       "badge-cat-roadwork",
      event:          "badge-cat-event",
      other:          "badge-cat-other"
    };

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="alert-title">${i.title}</div>
        <div class="alert-loc">${location}</div>
      </td>
      <td>
        <span class="badge ${catClassMap[i.category] || "badge-cat-other"}">
          <i class="fas ${catIcons[i.category] || "fa-circle-info"}"></i>
          ${catLabels[i.category] || i.category}
        </span>
      </td>
      <td>
        <span class="badge badge-status ${i.status}">
          <span class="dot"></span>
          ${statusLabels[i.status] || i.status}
        </span>
      </td>
      <td style="color:var(--text-muted);font-size:0.85rem;">${dateStr}</td>
      <td style="text-align:right;">
        <div class="actions">
          <button class="action-btn edit"   data-id="${i.id}" title="Editar">
            <i class="fas fa-pen"></i>
          </button>
          <button class="action-btn delete" data-id="${i.id}" title="Eliminar">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("tableFooter").textContent =
    `Mostrando ${filtered.length} de ${incidents.length} alerta${incidents.length !== 1 ? "s" : ""}`;
}

function showTableError(msg) {
  document.getElementById("incidentsTableBody").innerHTML =
    `<tr><td colspan="5" style="text-align:center;padding:2rem;color:#ef4444;">${msg}</td></tr>`;
}

// ── Char counter ──────────────────────────────────────────────────────────
const descTextarea = document.getElementById("alertDesc");
if (descTextarea) {
  descTextarea.addEventListener("input", function () {
    document.getElementById("charCounter").textContent = `${this.value.length}/500`;
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────
function openModal() { document.getElementById("modal").classList.add("open"); }
function closeModal() { document.getElementById("modal").classList.remove("open"); }

// New alert
const newAlertBtn = document.getElementById("newAlertBtn");
if (newAlertBtn) {
  newAlertBtn.addEventListener("click", () => {
    document.getElementById("alertForm").reset();
    document.getElementById("alertId").value      = "";
    document.getElementById("modalTitle").textContent = "Nueva alerta";
    document.getElementById("charCounter").textContent = "0/500";
    openModal();
  });
}

// Close buttons
document.getElementById("closeModal")?.addEventListener("click", closeModal);
document.getElementById("cancelBtn")?.addEventListener("click",  closeModal);
document.getElementById("modal")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal")) closeModal();
});

// ── Save alert (create / edit) ────────────────────────────────────────────
const alertForm = document.getElementById("alertForm");
if (alertForm) {
  alertForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn          = e.target.querySelector("button[type='submit']");
    const originalHTML = btn.innerHTML;
    btn.disabled  = true;
    btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Guardando…";

    try {
      const streetsInput = document.getElementById("alertStreets").value.trim();
      const streetsArray = streetsInput
        ? streetsInput.split(",").map(s => s.trim()).filter(Boolean)
        : [];

      const startVal = document.getElementById("alertStart").value;
      const endVal   = document.getElementById("alertEnd").value;

      const data = {
        title:            document.getElementById("alertTitle").value.trim(),
        description:      document.getElementById("alertDesc").value.trim(),
        category:         document.getElementById("alertCategory").value,
        status:           document.getElementById("alertStatus").value,
        start_date:       Timestamp.fromDate(new Date(startVal)),
        end_date:         endVal ? Timestamp.fromDate(new Date(endVal)) : null,
        location:         { address: document.getElementById("alertLocation").value.trim() },
        affected_streets: streetsArray,
        municipalityId:   userMuniId,
        municipalityName: userMuniName,
        visibility:       "public",
        updated_at:       serverTimestamp()
      };

      const id = document.getElementById("alertId").value;
      if (id) {
        await updateDoc(doc(db, "incidents", id), data);
      } else {
        data.created_at = serverTimestamp();
        data.created_by = currentUser.uid;
        await addDoc(collection(db, "incidents"), data);
      }

      closeModal();
      loadIncidents();
    } catch (err) {
      console.error("Error guardando alerta:", err);
      alert("Error al guardar: " + err.message);
    } finally {
      btn.disabled  = false;
      btn.innerHTML = originalHTML;
    }
  });
}

// ── Tabs (filter by status) ───────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

// ── Search ────────────────────────────────────────────────────────────────
document.getElementById("searchInput")?.addEventListener("input", renderTable);

// ── Edit / Delete (event delegation) ─────────────────────────────────────
document.getElementById("incidentsTableBody")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const id     = btn.dataset.id;
  const isEdit = btn.classList.contains("edit");
  const isDel  = btn.classList.contains("delete");

  if (isEdit) {
    const incident = incidents.find(x => x.id === id);
    if (!incident) return;

    document.getElementById("alertId").value        = incident.id;
    document.getElementById("alertTitle").value     = incident.title;
    document.getElementById("alertDesc").value      = incident.description || "";
    document.getElementById("charCounter").textContent = `${(incident.description || "").length}/500`;
    document.getElementById("alertCategory").value  = incident.category;
    document.getElementById("alertStatus").value    = incident.status;
    document.getElementById("alertLocation").value  = incident.location?.address || "";
    document.getElementById("alertStart").value     = incident.start_date
      ? incident.start_date.toDate().toISOString().split("T")[0] : "";
    document.getElementById("alertEnd").value       = incident.end_date
      ? incident.end_date.toDate().toISOString().split("T")[0]   : "";
    document.getElementById("alertStreets").value   = (incident.affected_streets || []).join(", ");
    document.getElementById("modalTitle").textContent = "Editar alerta";
    openModal();
  }

  if (isDel) {
    if (!confirm("¿Seguro que quieres eliminar esta alerta? Esta acción no se puede deshacer.")) return;
    try {
      btn.disabled = true;
      await deleteDoc(doc(db, "incidents", id));
      loadIncidents();
    } catch (err) {
      alert("Error al eliminar: " + err.message);
      btn.disabled = false;
    }
  }
});

// ── Logout ────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "/ayuntamientos/index.html";
});
