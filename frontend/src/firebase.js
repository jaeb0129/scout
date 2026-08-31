import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBswyXAcZ-p4Z_PFtOrPRjDBn4BMbvr3o8",
  authDomain: "scout-23045.firebaseapp.com",
  projectId: "scout-23045",
  storageBucket: "scout-23045.firebasestorage.app",
  messagingSenderId: "223111742058",
  appId: "1:223111742058:web:49e0a8fc5b494b87b3c013"
};

export const isFirebaseConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const db = isFirebaseConfigured ? getFirestore(app) : null;
export const auth = isFirebaseConfigured ? getAuth(app) : null;
export const googleProvider = isFirebaseConfigured ? new GoogleAuthProvider() : null;

