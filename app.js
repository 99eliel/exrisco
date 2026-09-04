import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  deleteUser
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCEK7Gj0Q9kWCoipPRiQ4Ozmc9fGzLUSxc',
  authDomain: 'extratificacao.firebaseapp.com',
  projectId: 'extratificacao',
  storageBucket: 'extratificacao.firebasestorage.app',
  messagingSenderId: '1087941095904',
  appId: '1:1087941095904:web:c4921974c3e62a516c3b85',
  measurementId: 'G-4K02JWHV3P'
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
setPersistence(auth, browserLocalPersistence).catch(console.warn);

window.EXRiscoFirebase = {
  firebaseConfig, auth, db,
  initializeApp, deleteApp, getAuth,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, deleteUser,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, writeBatch,
  query, where, orderBy, startAt, endAt, limit, serverTimestamp
};

function loadClassic(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

for (const src of ['./app-config.js', './app-patient.js', './app-admin.js', './app-network.js', './app-main.js']) {
  await loadClassic(src);
}
