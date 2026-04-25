import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// ── Firebase config ────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBzidosSZRxKmjMIrg0zAjYRt_rbohcHLU",
  authDomain: "saas-45027.firebaseapp.com",
  projectId: "saas-45027",
  storageBucket: "saas-45027.firebasestorage.app",
  messagingSenderId: "117144809845",
  appId: "1:117144809845:web:83153cf3aa6bc97851233c"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Label maps ─────────────────────────────────────────────────────────────
const categoryIcons = {
  street_closure: "fa-road",
  parking_ban:    "fa-square-parking",
  utility_cut:    "fa-bolt",
  roadwork:       "fa-helmet-safety",
  event:          "fa-calendar-check",
  other:          "fa-circle-info"
};
const categoryLabels = {
  street_closure: "Corte de calles",
  parking_ban:    "Prohibición aparcamiento",
  utility_cut:    "Corte suministros",
  roadwork:       "Obras",
  event:          "Evento",
  other:          "Otro"
};
const statusLabels = {
  planned:   "Próxima",
  ongoing:   "En curso",
  completed: "Finalizada",
  cancelled: "Cancelada"
};
const statusColors = {
  planned:   { bg: "#fffbeb", text: "#b45309" },
  ongoing:   { bg: "#ecfdf5", text: "#059669" },
  completed: { bg: "#f3f4f6", text: "#6b7280" },
  cancelled: { bg: "#fef2f2", text: "#dc2626" }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getIncidentId() {
  return new URLSearchParams(window.location.search).get("id");
}

function calculateDuration(start, end) {
  if (!start || !end) return null;
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return `${Math.max(days, 1)} ${days === 1 ? "día" : "días"}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "Sin fecha";
  return timestamp.toDate().toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric"
  });
}

// ── Load detail ────────────────────────────────────────────────────────────
async function loadDetail() {
  const id = getIncidentId();
  if (!id) { showError("No se ha especificado ninguna alerta."); return; }

  try {
    const snap = await getDoc(doc(db, "incidents", id));
    if (!snap.exists()) { showError("Esta alerta no existe o ha sido eliminada."); return; }

    const data      = snap.data();
    const container = document.getElementById("mainContent");

    // Duration
    let duration = null;
    if (data.start_date && data.end_date) {
      duration = calculateDuration(data.start_date.toDate(), data.end_date.toDate());
    }

    // Maps
    const mapsQuery = encodeURIComponent(data.location?.address || "");
    const mapsUrl   = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

    // Affected streets
    const affectedStreets = data.affected_streets || [];
    const streetsHtml = affectedStreets.length > 0 ? `
      <div class="streets-section">
        <div class="streets-title">Calles afectadas</div>
        <div class="streets-tags">
          ${affectedStreets.map(s => `<span class="street-tag"><i class="fas fa-map-pin"></i> ${s}</span>`).join("")}
        </div>
      </div>` : "";

    // Published date
    const publishedDate = data.created_at ? data.created_at.toDate() : new Date();
    const publishedText = `Publicado el ${publishedDate.toLocaleDateString("es-ES", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    })}`;

    // Status style
    const statusColor = statusColors[data.status] || statusColors.planned;
    const statusStyle = `background:${statusColor.bg};color:${statusColor.text};`;

    // Render
    container.innerHTML = `
      <article class="detail-card">
        <div class="badges-row">
          <span class="category-badge ${data.category}">
            <i class="fas ${categoryIcons[data.category] || "fa-circle-info"}"></i>
            ${categoryLabels[data.category] || data.category}
          </span>
          <span class="status-badge" style="${statusStyle}">
            <span class="dot"></span>
            ${statusLabels[data.status] || data.status}
          </span>
        </div>

        <h1 class="detail-title">${data.title}</h1>

        <p class="detail-muni">
          <i class="fas fa-landmark"></i>
          ${data.municipalityName || "Ayuntamiento"}${data.region ? ` — ${data.region}` : ""}
        </p>

        <p class="detail-description">${data.description || "Sin descripción disponible."}</p>

        <div class="info-grid">
          <div class="info-block">
            <div class="info-block-title">Período</div>
            <div class="info-row">
              <i class="fas fa-calendar-plus"></i>
              <span>Inicio: <strong>${formatDate(data.start_date)}</strong></span>
            </div>
            <div class="info-row">
              <i class="fas fa-calendar-minus"></i>
              <span>Fin: <strong>${data.end_date ? formatDate(data.end_date) : "Sin fecha fin"}</strong></span>
            </div>
            ${duration ? `
            <div class="info-row">
              <i class="fas fa-clock"></i>
              <span>Duración: <strong>${duration}</strong></span>
            </div>` : ""}
          </div>

          <div class="info-block">
            <div class="info-block-title">Ubicación</div>
            <div class="info-row">
              <i class="fas fa-map-marker-alt"></i>
              <span>${data.location?.address || "Ubicación no especificada"}</span>
            </div>
            <div class="info-row">
              <i class="fas fa-external-link-alt"></i>
              <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">
                Ver en Google Maps <i class="fas fa-arrow-right" style="font-size:0.7rem;"></i>
              </a>
            </div>
          </div>
        </div>

        ${streetsHtml}

        <p class="published-date">${publishedText}</p>
      </article>

      <section class="map-card">
        <div class="map-header">
          <i class="fas fa-map"></i>
          Mapa de la zona afectada
        </div>
        <iframe
          class="map-container"
          src="https://maps.google.com/maps?q=${mapsQuery}&t=&z=15&ie=UTF8&iwloc=&output=embed"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          allowfullscreen>
        </iframe>
      </section>
    `;

    // Update breadcrumb
    document.getElementById("breadcrumbMuni").innerHTML =
      `<a href="/ayuntamientos/index.html">${data.municipalityName || "Ayuntamiento"}</a>`;
    document.getElementById("breadcrumbTitle").textContent = data.title;
    document.title = `${data.title} — Alertas Municipales`;

  } catch (err) {
    console.error("Error cargando detalle:", err);
    showError("Error al cargar la alerta. Inténtalo de nuevo.");
  }
}

function showError(message) {
  document.getElementById("mainContent").innerHTML = `
    <div class="error-detail">
      <i class="fas fa-exclamation-circle"></i>
      <p>${message}</p>
      <br>
      <a href="/ayuntamientos/index.html">← Volver al listado</a>
    </div>`;
}

// ── Init ───────────────────────────────────────────────────────────────────
loadDetail();
