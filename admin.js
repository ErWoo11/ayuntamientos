import { initializeApp } from "firebase/app";
import {
  getAuth, signOut, onAuthStateChanged, createUserWithEmailAndPassword
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, collection, query, where, orderBy,
  addDoc, updateDoc, serverTimestamp, getDocs, limit, setDoc
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

const app          = initializeApp(firebaseConfig);
const auth         = getAuth(app);
const db           = getFirestore(app);

// Second app instance so creating a user doesn't kick out the superadmin
const creationApp  = initializeApp(firebaseConfig, "user-creation-app");
const creationAuth = getAuth(creationApp);

// ── State ──────────────────────────────────────────────────────────────────
let municipalities = [];

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  const icons = { success: "fa-check-circle", error: "fa-times-circle", info: "fa-info-circle" };
  t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3500);
}

// ── Auth guard ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "/index.html"; return; }

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists() || snap.data().role !== "superadmin") {
    showToast("Acceso denegado. Rol insuficiente.", "error");
    await signOut(auth);
    window.location.href = "/index.html";
    return;
  }

  // Load municipalities first (needed for user table municipality names)
  await loadMunicipalities();
  loadMetrics();
  loadUsers();
});

// ── Logout ─────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "/index.html";
});

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ── Metrics ────────────────────────────────────────────────────────────────
async function loadMetrics() {
  try {
    const [mSnap, uSnap, iSnap] = await Promise.all([
      getDocs(query(collection(db, "municipalities"), where("status", "==", "active"))),
      getDocs(query(collection(db, "users"), where("role", "==", "municipal"), where("status", "==", "active"))),
      getDocs(query(collection(db, "incidents"), limit(1000)))
    ]);
    document.getElementById("countMunis").textContent     = mSnap.size;
    document.getElementById("countUsers").textContent     = uSnap.size;
    document.getElementById("countIncidents").textContent = iSnap.size;
  } catch (err) {
    console.error("Error cargando métricas:", err);
  }
}

// ── Municipalities ─────────────────────────────────────────────────────────
async function loadMunicipalities() {
  try {
    const snap = await getDocs(query(collection(db, "municipalities"), orderBy("name")));
    municipalities = [];

    const tbody  = document.getElementById("muniTableBody");
    const select = document.getElementById("userMuniSelect");
    tbody.innerHTML  = "";
    select.innerHTML = '<option value="">Seleccionar municipio…</option>';

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">
        <i class="fas fa-city"></i>No hay municipios registrados
      </td></tr>`;
      return;
    }

    snap.forEach(docSnap => {
      const data = docSnap.data();
      municipalities.push({ id: docSnap.id, ...data });

      // Populate select
      const opt = document.createElement("option");
      opt.value = docSnap.id;
      opt.textContent = data.name;
      select.appendChild(opt);

      // Table row
      const isActive = data.status === "active";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${data.name}</strong></td>
        <td>${data.region || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${data.contact_email || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>
          <span class="badge ${isActive ? "badge-active" : "badge-inactive"}">
            <span class="badge-dot"></span>
            ${isActive ? "Activo" : "Inactivo"}
          </span>
        </td>
        <td style="text-align:right;">
          <button class="btn btn-sm ${isActive ? "btn-danger" : "btn-success"}"
                  data-action="toggle-muni" data-id="${docSnap.id}">
            <i class="fas ${isActive ? "fa-ban" : "fa-check"}"></i>
            ${isActive ? "Desactivar" : "Activar"}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error cargando municipios:", err);
    showToast("Error cargando municipios", "error");
  }
}

// Create municipality
document.getElementById("muniForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type='submit']");
  btn.disabled  = true;
  btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Creando…";

  try {
    await addDoc(collection(db, "municipalities"), {
      name:          document.getElementById("muniName").value.trim(),
      region:        document.getElementById("muniRegion").value.trim(),
      contact_email: document.getElementById("muniContact").value.trim(),
      status:        "active",
      created_at:    serverTimestamp()
    });
    showToast("Municipio creado correctamente", "success");
    e.target.reset();
    await loadMunicipalities();
    loadMetrics();
  } catch (err) {
    console.error("Error creando municipio:", err);
    showToast("Error al crear municipio", "error");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "<i class='fas fa-plus'></i> Crear municipio";
  }
});

// Toggle municipality (event delegation)
document.getElementById("muniTableBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='toggle-muni']");
  if (!btn) return;

  const id   = btn.dataset.id;
  const muni = municipalities.find(m => m.id === id);
  if (!muni) return;

  btn.disabled = true;
  try {
    const newStatus = muni.status === "active" ? "inactive" : "active";
    await updateDoc(doc(db, "municipalities", id), { status: newStatus });
    showToast(`Municipio ${newStatus === "active" ? "activado" : "desactivado"}`, "success");
    await loadMunicipalities();
    loadMetrics();
  } catch (err) {
    console.error("Error actualizando municipio:", err);
    showToast("Error al actualizar municipio", "error");
    btn.disabled = false;
  }
});

// ── Users ──────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const snap = await getDocs(
      query(collection(db, "users"), where("role", "==", "municipal"), orderBy("created_at", "desc"))
    );
    const tbody = document.getElementById("userTableBody");
    tbody.innerHTML = "";

    // Build name map from the already-loaded municipalities array
    const muniMap = {};
    municipalities.forEach(m => { muniMap[m.id] = m.name; });

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">
        <i class="fas fa-users"></i>No hay usuarios municipales
      </td></tr>`;
      return;
    }

    snap.forEach(docSnap => {
      const data     = docSnap.data();
      const isActive = data.status === "active";
      const tr       = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <i class="fas fa-user-circle" style="color:var(--text-muted);font-size:1.1rem;"></i>
            ${data.email}
          </div>
        </td>
        <td>${muniMap[data.municipality_id] || '<span style="color:var(--text-muted)">Desconocido</span>'}</td>
        <td>
          <span class="badge ${isActive ? "badge-active" : "badge-inactive"}">
            <span class="badge-dot"></span>
            ${isActive ? "Activo" : "Inactivo"}
          </span>
        </td>
        <td style="text-align:right;">
          <button class="btn btn-sm ${isActive ? "btn-danger" : "btn-success"}"
                  data-action="toggle-user" data-id="${docSnap.id}">
            <i class="fas ${isActive ? "fa-ban" : "fa-check"}"></i>
            ${isActive ? "Desactivar" : "Activar"}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error cargando usuarios:", err);
    showToast("Error cargando usuarios", "error");
  }
}

// Create user
document.getElementById("userForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email  = document.getElementById("userEmail").value.trim();
  const pass   = document.getElementById("userPass").value;
  const muniId = document.getElementById("userMuniSelect").value;

  if (!muniId) { showToast("Selecciona un municipio", "error"); return; }

  const btn = e.target.querySelector("button[type='submit']");
  btn.disabled  = true;
  btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Creando…";

  try {
    const userCred = await createUserWithEmailAndPassword(creationAuth, email, pass);
    await signOut(creationAuth);

    await setDoc(doc(db, "users", userCred.user.uid), {
      email,
      role:            "municipal",
      municipality_id: muniId,
      status:          "active",
      created_at:      serverTimestamp()
    }, { merge: true });

    showToast("Usuario creado correctamente", "success");
    e.target.reset();
    loadUsers();
    loadMetrics();
  } catch (err) {
    console.error("Error creando usuario:", err);
    const msgs = {
      "auth/email-already-in-use": "Este email ya está registrado.",
      "auth/weak-password":        "La contraseña es demasiado débil (mínimo 6 caracteres).",
      "auth/invalid-email":        "El email no tiene un formato válido."
    };
    showToast(msgs[err.code] || `Error: ${err.message}`, "error");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "<i class='fas fa-user-plus'></i> Crear usuario";
  }
});

// Toggle user (event delegation — uses CSS class, not text content)
document.getElementById("userTableBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='toggle-user']");
  if (!btn) return;

  const id       = btn.dataset.id;
  const row      = btn.closest("tr");
  const isActive = row.querySelector(".badge-active") !== null;

  btn.disabled = true;
  try {
    await updateDoc(doc(db, "users", id), { status: isActive ? "inactive" : "active" });
    showToast(`Usuario ${isActive ? "desactivado" : "activado"}`, "success");
    loadUsers();
    loadMetrics();
  } catch (err) {
    console.error("Error actualizando usuario:", err);
    showToast("Error al actualizar usuario", "error");
    btn.disabled = false;
  }
});
