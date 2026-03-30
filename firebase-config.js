// firebase-config.js — NossaGrana
// Tenta carregar do localStorage ou do importFunc (Vite)
const envConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || ''
};

const isConfigValid = (c) => c && c.apiKey && !String(c.apiKey).includes('undefined') && c.apiKey !== '';

const savedConfigStr = localStorage.getItem('nossagrana_fb_config');
const savedConfig = savedConfigStr ? JSON.parse(savedConfigStr) : null;

// Prioridade: Se as chaves do Ambiente (GitHub Secrets) forem válidas, use-as.
// Caso contrário, use o que estiver no localStorage.
const firebaseConfig = isConfigValid(envConfig) ? envConfig : (savedConfig || envConfig);

export const isFirebaseConfigured = () => {
  const hasKeys = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('undefined') && firebaseConfig.apiKey !== '');
  console.log('Firebase Configured:', hasKeys ? 'YES' : 'NO (using fallback UI)');
  return hasKeys;
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
