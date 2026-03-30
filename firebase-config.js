// firebase-config.js — NossaGrana
// Tenta carregar do localStorage ou do importFunc (Vite)
const savedConfig = localStorage.getItem('nossagrana_fb_config');
const firebaseConfig = savedConfig ? JSON.parse(savedConfig) : {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || ''
};

export const isFirebaseConfigured = () => {
  return firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('undefined');
};

export const saveFirebaseConfig = (config) => {
  localStorage.setItem('nossagrana_fb_config', JSON.stringify(config));
};

export const clearFirebaseConfig = () => {
  localStorage.removeItem('nossagrana_fb_config');
};

let app, dbInstance = null, authInstance = null;

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps || !firebase.apps.length) {
      if (firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('undefined')) {
        app = firebase.initializeApp(firebaseConfig);
        dbInstance = firebase.firestore();
        authInstance = firebase.auth();
      } else {
        console.warn('Firebase: chaves ausentes, rodando em modo demo.');
      }
    } else {
      app = firebase.app();
      dbInstance = firebase.firestore();
      authInstance = firebase.auth();
    }
  }
} catch (error) {
  console.error('Erro ao inicializar Firebase:', error);
}

export const db = dbInstance;
export const auth = authInstance;
