import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// ── Firebase config embebido (no depende de firebase-config.js externo) ──
const firebaseConfig = {
  apiKey: "AIzaSyBzidosSZRxKmjMIrg0zAjYRt_rbohcHLU",
  authDomain: "saas-45027.firebaseapp.com",
  projectId: "saas-45027",
  storageBucket: "saas-45027.firebasestorage.app",
  messagingSenderId: "117144809845",
  appId: "1:117144809845:web:83153cf3aa6bc97851233c"
};

// Inicializar app (reutiliza la instancia si ya existe)
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  // Si ya está inicializado, getApp lo recoge
  const { getApp } = await import("firebase/app");
  app = getApp();
}

const auth = getAuth(app);
const db   = getFirestore(app);

/**
 * Login con email/contraseña. Redirige según rol.
 * @throws {Error} Si las credenciales son incorrectas o el rol no está autorizado.
 */
export async function login(email, password) {
  const userCred = await signInWithEmailAndPassword(auth, email, password);
  const userDoc  = await getDoc(doc(db, "users", userCred.user.uid));

  if (!userDoc.exists()) {
    await signOut(auth);
    throw new Error("Usuario no registrado en el sistema.");
  }

  const role = userDoc.data().role;
  if (role === "superadmin")       window.location.href = "/ayuntamientos/admin.html";
  else if (role === "municipal")   window.location.href = "/ayuntamientos/municipal.html";
  else {
    await signOut(auth);
    throw new Error("Rol no autorizado.");
  }
}

export { auth, db };
