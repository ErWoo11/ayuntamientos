import { initializeApp }    from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc, collection, query,
         where, orderBy, addDoc, updateDoc, deleteDoc,
         getDocs, serverTimestamp, Timestamp, writeBatch }
                             from "firebase/firestore";

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
let currentUser   = null;
let userMuniId    = null;
let userMuniName  = null;
let incidents     = [];
let currentFilter = "all";

// ── Label maps ────────────────────────────────────────────────────────────
const catLabels = {
  street_closure:"Corte de calle", parking_ban:"Prohibición aparcamiento",
  utility_cut:"Corte suministros", roadwork:"Obras",
  event:"Evento",                  other:"Otro"
};
const catIcons = {
  street_closure:"fa-road",    parking_ban:"fa-parking",
  utility_cut:"fa-bolt",       roadwork:"fa-helmet-safety",
  event:"fa-calendar-check",   other:"fa-circle-info"
};
const statusLabels = {
  planned:"Próxima", ongoing:"Activa",
  completed:"Finalizada", cancelled:"Cancelada"
};

// ── Auto-calculate status from dates ──────────────────────────────────────
// "cancelled" is never overridden — it was explicitly set by the user.
function computeStatus(incident) {
  if (incident.status === "cancelled") return "cancelled";

  // Use start of day (00:00:00) and end of day (23:59:59) in local time
  // so that an event created "today" is immediately "ongoing", not "completed".
  const nowMs = Date.now();

  let startMs = null, endMs = null;

  if (incident.start_date) {
    const d = incident.start_date.toDate();
    // Floor to start of local day: 00:00:00.000
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    startMs = startOfDay.getTime();
  }

  if (incident.end_date) {
    const d = incident.end_date.toDate();
    // Ceil to end of local day: 23:59:59.999
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    endMs = endOfDay.getTime();
  }

  if (!startMs) return incident.status; // no dates → trust stored value

  if (nowMs < startMs)                          return "planned";
  if (endMs && nowMs > endMs)                   return "completed";
  if (nowMs >= startMs && (!endMs || nowMs <= endMs)) return "ongoing";

  return incident.status;
}

// ── Sync status to Firestore for outdated docs ────────────────────────────
// Runs silently after loading — updates any incidents whose stored status
// no longer matches the computed status (e.g. planned → ongoing overnight).
async function syncStatuses(incidentList) {
  const toUpdate = incidentList.filter(i => {
    if (i.status === "cancelled") return false;
    return computeStatus(i) !== i.status;
  });

  if (toUpdate.length === 0) return;

  // Batch write (max 500 per batch, more than enough here)
  const batch = writeBatch(db);
  toUpdate.forEach(i => {
    batch.update(doc(db, "incidents", i.id), {
      status:     computeStatus(i),
      updated_at: serverTimestamp()
    });
  });

  try {
    await batch.commit();
    console.info(`[syncStatuses] Updated ${toUpdate.length} incident(s) status.`);
    // Update local array too so UI is consistent without re-fetching
    toUpdate.forEach(i => { i.status = computeStatus(i); });
    updateStats();
    renderTable();
  } catch (e) {
    // Non-critical — just log, don't disrupt UX
    console.warn("[syncStatuses] Batch update failed:", e);
  }
}

// ── Auth listener ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await loadUserProfile();
  } else {
    window.location.href = "/ayuntamientos/index.html";
  }
});

// ── Load user profile ──────────────────────────────────────────────────────
async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));

    if (!snap.exists() || snap.data().role !== "municipal") {
      await signOut(auth);
      window.location.href = "/ayuntamientos/index.html";
      return;
    }

    const userData = snap.data();

    if (userData.status === "inactive") {
      await signOut(auth);
      window.location.href = "/ayuntamientos/index.html";
      return;
    }

    userMuniId = userData.municipality_id;

    // Check municipality is still active
    const muniSnap = await getDoc(doc(db, "municipalities", userMuniId));
    if (!muniSnap.exists() || muniSnap.data().status !== "active") {
      await signOut(auth);
      window.location.href = "/ayuntamientos/index.html";
      return;
    }

    userMuniName = muniSnap.data().name;

    document.getElementById("userMuniDisplay").innerHTML = `<i class="fas fa-landmark"></i> ${userMuniName}`;
    document.getElementById("muniSubtitle").textContent  = userMuniName;

    await loadIncidents();
  } catch (e) {
    console.error("loadUserProfile:", e);
  }
}

// ── Load incidents ─────────────────────────────────────────────────────────
async function loadIncidents() {
  try {
    const snap = await getDocs(query(
      collection(db, "incidents"),
      where("municipalityId", "==", userMuniId),
      orderBy("created_at", "desc")
    ));

    incidents = [];
    snap.forEach(d => incidents.push({ id: d.id, ...d.data() }));

    updateStats();
    renderTable();

    // After rendering, silently sync any outdated statuses in Firestore
    syncStatuses(incidents);

  } catch (e) {
    console.error("loadIncidents:", e);
    showTableError("Error al cargar las alertas.");
  }
}

// ── Stats (use computed status) ────────────────────────────────────────────
function updateStats() {
  const computed = incidents.map(i => computeStatus(i));
  document.getElementById("statTotal").textContent     = incidents.length;
  document.getElementById("statActive").textContent    = computed.filter(s => s === "ongoing").length;
  document.getElementById("statPlanned").textContent   = computed.filter(s => s === "planned").length;
  document.getElementById("statCompleted").textContent = computed.filter(s => s === "completed").length;
}

// ── Render table ───────────────────────────────────────────────────────────
function renderTable() {
  const tbody  = document.getElementById("incidentsTableBody");
  tbody.innerHTML = "";

  const search   = document.getElementById("searchInput").value.toLowerCase();
  const filtered = incidents.filter(i => {
    const realStatus  = computeStatus(i);
    const matchFilter = currentFilter === "all" || realStatus === currentFilter;
    const matchSearch = i.title.toLowerCase().includes(search) ||
                        (i.location?.address || "").toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:#9ca3af;">
      <i class="fas fa-bell-slash" style="font-size:1.5rem;display:block;margin-bottom:.5rem;"></i>
      No hay alertas${currentFilter !== "all" ? " con este filtro" : ""}
    </td></tr>`;
    document.getElementById("tableFooter").textContent = "Mostrando 0 alertas";
    return;
  }

  const catClassMap = {
    street_closure:"badge-cat-closure", parking_ban:"badge-cat-parking",
    utility_cut:"badge-cat-utility",    roadwork:"badge-cat-roadwork",
    event:"badge-cat-event",            other:"badge-cat-other"
  };

  filtered.forEach(i => {
    // Always show the computed status in the UI
    const realStatus = computeStatus(i);
    const hasStatusChanged = realStatus !== i.status;

    const dateStart = i.start_date ? i.start_date.toDate().toLocaleDateString("es-ES") : "Sin fecha";
    const dateEnd   = i.end_date   ? i.end_date.toDate().toLocaleDateString("es-ES")   : "";
    const dateStr   = dateEnd ? `${dateStart} → ${dateEnd}` : dateStart;
    const location  = i.location?.address || "Sin ubicación";

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
        <span class="badge badge-status ${realStatus}">
          <span class="dot"></span>
          ${statusLabels[realStatus] || realStatus}
        </span>
        ${hasStatusChanged ? `
          <span title="Actualización pendiente de sincronización"
                style="font-size:.7rem;color:#9ca3af;margin-left:.3rem;">
            <i class="fas fa-sync-alt fa-spin"></i>
          </span>` : ""}
      </td>
      <td style="color:var(--text-muted);font-size:.85rem;">${dateStr}</td>
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

// ── Char counter ───────────────────────────────────────────────────────────
const descTA = document.getElementById("alertDesc");
if (descTA) {
  descTA.addEventListener("input", function () {
    document.getElementById("charCounter").textContent = `${this.value.length}/500`;
  });
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function openModal()  { document.getElementById("modal").classList.add("open"); }
function closeModal() { document.getElementById("modal").classList.remove("open"); }

document.getElementById("newAlertBtn")?.addEventListener("click", () => {
  document.getElementById("alertForm").reset();
  document.getElementById("alertId").value             = "";
  document.getElementById("modalTitle").textContent    = "Nueva alerta";
  document.getElementById("charCounter").textContent   = "0/500";
  openModal();
});

document.getElementById("closeModal")?.addEventListener("click", closeModal);
document.getElementById("cancelBtn")?.addEventListener("click",  closeModal);
document.getElementById("modal")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal")) closeModal();
});

// ── Save alert ─────────────────────────────────────────────────────────────
document.getElementById("alertForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type='submit']");
  const orig = btn.innerHTML;
  btn.disabled  = true;
  btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Guardando…";

  try {
    const streetsInput = document.getElementById("alertStreets").value.trim();
    const streetsArray = streetsInput
      ? streetsInput.split(",").map(s => s.trim()).filter(Boolean)
      : [];

    const startVal = document.getElementById("alertStart").value;
    const endVal   = document.getElementById("alertEnd").value;

    // Compute the correct status from the dates being saved
    // Parse dates as LOCAL midnight / end-of-day to avoid UTC offset issues.
    // new Date("2025-04-28") → UTC midnight → in Spain (UTC+2) = 22:00 prev day → bug.
    // new Date(2025, 3, 28, 0,0,0) → local midnight → correct.
    let startDate = null, endDate = null;
    if (startVal) {
      const [sy, sm, sd] = startVal.split("-").map(Number);
      startDate = new Date(sy, sm - 1, sd, 0, 0, 0, 0); // local 00:00:00
    }
    if (endVal) {
      const [ey, em, ed] = endVal.split("-").map(Number);
      endDate = new Date(ey, em - 1, ed, 23, 59, 59, 999); // local 23:59:59
    }
    const now = Date.now();

    let autoStatus = document.getElementById("alertStatus").value;
    // Only auto-compute if not manually cancelled
    if (autoStatus !== "cancelled" && startDate) {
      if (now < startDate.getTime())                                  autoStatus = "planned";
      else if (endDate && now > endDate.getTime())                    autoStatus = "completed";
      else if (now >= startDate.getTime() && (!endDate || now <= endDate.getTime())) autoStatus = "ongoing";
    }

    const data = {
      title:            document.getElementById("alertTitle").value.trim(),
      description:      document.getElementById("alertDesc").value.trim(),
      category:         document.getElementById("alertCategory").value,
      status:           autoStatus,
      start_date:       startDate ? Timestamp.fromDate(startDate) : null,
      end_date:         endDate   ? Timestamp.fromDate(endDate)   : null,
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
    await loadIncidents();
  } catch (err) {
    console.error("saveAlert:", err);
    alert("Error al guardar: " + err.message);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = orig;
  }
});

// ── Tabs ──────────────────────────────────────────────────────────────────
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

// ── Edit / Delete ─────────────────────────────────────────────────────────
document.getElementById("incidentsTableBody")?.addEventListener("click", async e => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const id    = btn.dataset.id;
  const isEdit= btn.classList.contains("edit");
  const isDel = btn.classList.contains("delete");

  if (isEdit) {
    const inc = incidents.find(x => x.id === id);
    if (!inc) return;

    document.getElementById("alertId").value       = inc.id;
    document.getElementById("alertTitle").value    = inc.title;
    document.getElementById("alertDesc").value     = inc.description || "";
    document.getElementById("charCounter").textContent = `${(inc.description||"").length}/500`;
    document.getElementById("alertCategory").value = inc.category;
    // Show the computed status in the edit form so user sees what it really is
    document.getElementById("alertStatus").value   = computeStatus(inc);
    document.getElementById("alertLocation").value = inc.location?.address || "";
    document.getElementById("alertStart").value    = inc.start_date
      ? inc.start_date.toDate().toISOString().split("T")[0] : "";
    document.getElementById("alertEnd").value      = inc.end_date
      ? inc.end_date.toDate().toISOString().split("T")[0]   : "";
    document.getElementById("alertStreets").value  = (inc.affected_streets || []).join(", ");
    document.getElementById("modalTitle").textContent = "Editar alerta";
    openModal();
  }

  if (isDel) {
    if (!confirm("¿Seguro que quieres eliminar esta alerta? Esta acción no se puede deshacer.")) return;
    btn.disabled = true;
    try {
      await deleteDoc(doc(db, "incidents", id));
      await loadIncidents();
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
