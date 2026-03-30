// js/chat/chat-ui.js — Componente visual do Chat
import { processMessage, initChatFacade } from './chat-facade.js';
import { MSGS, CATEGORIES } from './constants.js';
import { setGeminiKey, getGeminiKey, loadGeminiKeyFromFamily } from './ai-gemini.js';
import { setOpenAIKey, getOpenAIKey, loadOpenAIKeyFromFamily } from './ai-openai.js';
import { showToast, getGreeting } from '../utils.js';
import { updateFamily } from '../firestore.js';

let messagesEl, inputEl, onTransactionCallback, onInstallmentCallback;
let chatInitialized = false;
let currentAppState = null;

export function initChat(appState, onTransaction, onInstallment) {
  initChatFacade(appState);
  onTransactionCallback = onTransaction;
  onInstallmentCallback = onInstallment;
  currentAppState = appState;

  // Load API keys from family object (shared between couple)
  if (appState.family) {
    loadGeminiKeyFromFamily(appState.family);
    loadOpenAIKeyFromFamily(appState.family);
  }

  // Only bind events and show welcome once
  if (chatInitialized) return;
  chatInitialized = true;

  messagesEl = document.getElementById('chat-messages');
  inputEl = document.getElementById('chat-input');

  // Load saved API keys display
  const geminiKeyInput = document.getElementById('gemini-api-key');
  const openaiKeyInput = document.getElementById('openai-api-key');
  if (geminiKeyInput) geminiKeyInput.value = getGeminiKey() ? '••••••••••' : '';
  if (openaiKeyInput) openaiKeyInput.value = getOpenAIKey() ? '••••••••••' : '';

  // Send button
  document.getElementById('chat-send-btn')?.addEventListener('click', handleSend);

  // Enter key
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Quick action buttons
  document.querySelectorAll('.chat-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'ajuda') { inputEl.value = 'ajuda'; handleSend(); }
      else if (action === 'saldo') { inputEl.value = 'saldo'; handleSend(); }
      else if (action === 'relatorio') { inputEl.value = 'relatório mensal'; handleSend(); }
      else if (action === '-') { inputEl.value = '-'; inputEl.focus(); }
      else if (action === '+') { inputEl.value = '+'; inputEl.focus(); }
    });
  });

  // AI config toggle
  document.getElementById('chat-ai-config-btn')?.addEventListener('click', () => {
    document.getElementById('chat-ai-settings')?.classList.toggle('hidden');
  });

  // Save keys — persist to family in Firestore so both partners use the same key
  document.getElementById('save-gemini-key')?.addEventListener('click', async () => {
    const val = document.getElementById('gemini-api-key').value.trim();
    if (val && !val.includes('•')) {
      setGeminiKey(val);
      if (currentAppState?.familyId) {
        try { await updateFamily(currentAppState.familyId, { geminiApiKey: val }); } catch(e) { console.warn('Erro ao salvar chave na família:', e); }
      }
      showToast('Chave Gemini salva!', 'Disponível para toda a família.', 'success');
    }
  });
  document.getElementById('save-openai-key')?.addEventListener('click', async () => {
    const val = document.getElementById('openai-api-key').value.trim();
    if (val && !val.includes('•')) {
      setOpenAIKey(val);
      if (currentAppState?.familyId) {
        try { await updateFamily(currentAppState.familyId, { openaiApiKey: val }); } catch(e) { console.warn('Erro ao salvar chave na família:', e); }
      }
      showToast('Chave OpenAI salva!', 'Disponível para toda a família.', 'success');
    }
  });

  // Welcome message
  const name = appState?.userName || 'Casal';
  pushBotMessage(MSGS.WELCOME(`${getGreeting()}, ${name}`));
}

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  pushUserMessage(text);
  showTyping();

  try {
    const response = await processMessage(text);
    hideTyping();

    if (response.action === 'clear') {
      messagesEl.innerHTML = '';
      pushBotMessage(response.text);
      return;
    }

    if (response.type === 'categories') {
      pushBotMessage(response.text);
      renderCategorySelector(response.data);
      return;
    }

    if (response.type === 'transaction') {
      // Auto-create transaction
      if (onTransactionCallback) {
        onTransactionCallback(response.data);
        const label = response.data.type === 'receita' ? MSGS.INCOME_ADDED : MSGS.EXPENSE_ADDED;
        const formatted = `R$ ${response.data.amount.toFixed(2).replace('.', ',')}`;
        pushBotMessage(label(formatted, response.data.accountName, response.data.category));
      }
      return;
    }

    if (response.type === 'installment') {
      // Auto-create installment transactions
      if (onInstallmentCallback) {
        onInstallmentCallback(response.data);
        const formatted = `${response.data.installmentAmount.toFixed(2).replace('.', ',')}`;
        const totalFormatted = `${response.data.totalAmount.toFixed(2).replace('.', ',')}`;
        pushBotMessage(MSGS.INSTALLMENT_ADDED(
          response.data.installmentCount, formatted, totalFormatted, response.data.category
        ));
      }
      return;
    }

    pushBotMessage(response.text);
  } catch (err) {
    hideTyping();
    console.error('Chat error:', err);
    pushBotMessage(MSGS.ERROR);
  }
}

function pushUserMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-message user';
  msg.innerHTML = `
    <div class="chat-msg-avatar">👤</div>
    <div class="chat-msg-bubble">${escapeHtml(text)}</div>
  `;
  messagesEl.appendChild(msg);
  scrollToBottom();
}

function pushBotMessage(html) {
  const msg = document.createElement('div');
  msg.className = 'chat-message bot';
  msg.innerHTML = `
    <div class="chat-msg-avatar">🤖</div>
    <div class="chat-msg-bubble">${html}</div>
  `;
  messagesEl.appendChild(msg);
  scrollToBottom();
}

function renderCategorySelector(data) {
  const container = document.createElement('div');
  container.className = 'chat-message bot';
  let chipsHtml = data.categories.map(c =>
    `<button class="chat-category-chip" data-cat="${c.name}">${c.icon} ${c.name}</button>`
  ).join('');

  container.innerHTML = `
    <div class="chat-msg-avatar">🤖</div>
    <div class="chat-msg-bubble">
      <div class="chat-category-selector">${chipsHtml}</div>
    </div>
  `;

  messagesEl.appendChild(container);
  scrollToBottom();

  // Handle chip clicks
  container.querySelectorAll('.chat-category-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const catName = chip.dataset.cat;
      container.remove(); // Remove selector

      if (data.isInstallment && onInstallmentCallback) {
        // Installment flow via category selector
        onInstallmentCallback({
          type: 'despesa',
          installmentCount: data.installmentCount,
          installmentAmount: data.installmentAmount,
          totalAmount: data.totalAmount,
          category: catName,
          description: data.description || catName,
          accountId: data.accountId
        });
        const formatted = `${data.installmentAmount.toFixed(2).replace('.', ',')}`;
        const totalFormatted = `${data.totalAmount.toFixed(2).replace('.', ',')}`;
        pushBotMessage(MSGS.INSTALLMENT_ADDED(
          data.installmentCount, formatted, totalFormatted, catName
        ));
      } else if (onTransactionCallback) {
        onTransactionCallback({
          type: data.txType,
          amount: data.amount,
          category: catName,
          description: data.description || catName,
          accountId: data.accountId
        });
        const label = data.txType === 'receita' ? MSGS.INCOME_ADDED : MSGS.EXPENSE_ADDED;
        const formatted = `R$ ${data.amount.toFixed(2).replace('.', ',')}`;
        pushBotMessage(label(formatted, '', catName));
      }
    });
  });
}

function showTyping() {
  const typing = document.createElement('div');
  typing.id = 'typing-indicator';
  typing.className = 'chat-message bot';
  typing.innerHTML = `
    <div class="chat-msg-avatar">🤖</div>
    <div class="chat-msg-bubble">
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>
  `;
  messagesEl.appendChild(typing);
  scrollToBottom();
}

function hideTyping() {
  document.getElementById('typing-indicator')?.remove();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
