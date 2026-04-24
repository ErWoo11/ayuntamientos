import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const auth = getAuth();
const db = getFirestore();

export async function login(email, password) {
  const userCred = await signInWithEmailAndPassword(auth, email, password);
  const userDoc = await getDoc(doc(db, "users", userCred.user.uid));
  if (!userDoc.exists()) throw new Error("Usuario no registrado en el sistema.");
  
  const role = userDoc.data().role;
  if (role === "superadmin") window.location.href = "/admin.html";
  else if (role === "municipal") window.location.href = "/municipal.html";
  else {
    await signOut(auth);
    throw new Error("Rol no autorizado.");
  }
}

export { auth, db };