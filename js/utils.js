// js/utils.js — Funções utilitárias

/**
 * Formata valor como moeda BRL
 */
export function formatCurrency(value, currency = 'BRL') {
  const locales = { BRL: 'pt-BR', USD: 'en-US', EUR: 'de-DE' };
  return new Intl.NumberFormat(locales[currency] || 'pt-BR', {
    style: 'currency',
    currency: currency
  }).format(value || 0);
}

/**
 * Formata data para exibição
 */
export function formatDate(date) {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString('pt-BR');
}

/**
 * Gera ID de convite de 6 dígitos
 */
export function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Gera ID único
 */
export function generateId() {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

/**
 * Toast notification
 */
export function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Obtém a data de hoje como string YYYY-MM-DD
 */
export function todayString() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
}

/**
 * Retorna saudação baseada na hora
 */
export function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  if (hour >= 18 && hour < 22) return 'Boa noite';
  return 'Boa madrugada';
}
