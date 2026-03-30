// js/chat/ai-openai.js — Integração com OpenAI API (chave compartilhada pela família)

let openaiApiKey = '';

export function setOpenAIKey(key) {
  openaiApiKey = key;
  if (key) localStorage.setItem('nossagrana_openai_key', key);
}

export function getOpenAIKey() {
  if (!openaiApiKey) openaiApiKey = localStorage.getItem('nossagrana_openai_key') || '';
  return openaiApiKey;
}

export function hasOpenAIKey() {
  return !!getOpenAIKey();
}

/**
 * Carrega a chave da família (Firestore) e sincroniza localmente
 */
export function loadOpenAIKeyFromFamily(family) {
  if (family?.openaiApiKey) {
    openaiApiKey = family.openaiApiKey;
    localStorage.setItem('nossagrana_openai_key', family.openaiApiKey);
  }
}

/**
 * Envia mensagem para OpenAI API (GPT-4o-mini)
 */
export async function sendToOpenAI(userMessage, context = '') {
  const key = getOpenAIKey();
  if (!key) throw new Error('Chave OpenAI não configurada');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é um assistente financeiro pessoal chamado NossaGrana.
Responda em português do Brasil, de forma curta e útil.
${context ? 'Contexto financeiro do usuário: ' + context : ''}
Se o usuário pedir para registrar uma transação, responda com o comando no formato:
[CMD:EXPENSE|valor|categoria|descrição] ou [CMD:INCOME|valor|categoria|descrição]`
        },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'Não consegui processar sua pergunta.';
}
