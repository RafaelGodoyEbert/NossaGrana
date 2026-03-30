// js/chat/ai-gemini.js — Integração com Gemini API (chave compartilhada pela família)

let geminiApiKey = '';

export function setGeminiKey(key) {
  geminiApiKey = key;
  // Mantém localStorage como fallback rápido
  if (key) localStorage.setItem('nossagrana_gemini_key', key);
}

export function getGeminiKey() {
  if (!geminiApiKey) geminiApiKey = localStorage.getItem('nossagrana_gemini_key') || '';
  return geminiApiKey;
}

export function hasGeminiKey() {
  return !!getGeminiKey();
}

/**
 * Carrega a chave da família (Firestore) e sincroniza localmente
 */
export function loadGeminiKeyFromFamily(family) {
  if (family?.geminiApiKey) {
    geminiApiKey = family.geminiApiKey;
    localStorage.setItem('nossagrana_gemini_key', family.geminiApiKey);
  }
}

/**
 * Envia mensagem para Gemini API
 */
export async function sendToGemini(userMessage, context = '') {
  const key = getGeminiKey();
  if (!key) throw new Error('Chave Gemini não configurada');

  const systemPrompt = `Você é um assistente financeiro pessoal chamado NossaGrana.
Responda em português do Brasil, de forma curta e útil.
${context ? 'Contexto financeiro do usuário: ' + context : ''}
Se o usuário pedir para registrar uma transação, responda com o comando no formato:
[CMD:EXPENSE|valor|categoria|descrição] ou [CMD:INCOME|valor|categoria|descrição]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt + '\n\nUsuário: ' + userMessage }] }
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 20500 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Não consegui processar sua pergunta.';
  return text;
}
