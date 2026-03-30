// js/chat/entity-extractor.js — Extrai valor, categoria e conta do texto
import { PATTERNS } from './constants.js';

/**
 * Extrai valor numérico do texto
 */
export function extractAmount(text) {
  // Remove +/- prefix
  const cleaned = text.replace(/^[+-]\s*/, '');
  const match = cleaned.match(/(\d[\d.,]*)/);
  if (!match) return 0;
  const numStr = match[1].replace(/\./g, '').replace(',', '.');
  const num = parseFloat(numStr);
  return isNaN(num) ? 0 : num;
}

/**
 * Extrai possível nome de categoria do texto
 */
export function extractCategory(text, categories) {
  if (!categories || !categories.length) return null;
  const lower = text.toLowerCase();
  // Remove amount and common words
  const cleaned = lower.replace(/[\d.,]+/g, '').replace(/^[+-]\s*/, '').trim();

  // Sort by name length descending (longest match first)
  const sorted = [...categories].sort((a, b) => b.name.length - a.name.length);

  for (const cat of sorted) {
    if (cleaned.includes(cat.name.toLowerCase())) return cat;
  }

  // If there's remaining text after removing numbers, use it as category hint
  const hint = cleaned.replace(/(gastei|gasto|paguei|comprei|recebi|salário|salario|renda|despesa|receita|em|de|do|da|no|na|com|para)/gi, '').trim();
  if (hint.length > 1) {
    // Try fuzzy match
    for (const cat of sorted) {
      if (cat.name.toLowerCase().includes(hint) || hint.includes(cat.name.toLowerCase())) return cat;
    }
  }

  return null;
}

/**
 * Extrai possível conta do texto
 */
export function extractAccount(text, accounts) {
  if (!accounts || !accounts.length) return accounts[0] || null;
  const lower = text.toLowerCase();

  for (const acc of accounts) {
    if (lower.includes(acc.name.toLowerCase())) return acc;
  }

  // Default to first account
  return accounts[0] || null;
}

/**
 * Extrai description: texto sem números e keywords
 */
export function extractDescription(text) {
  return text
    .replace(/^[+-]\s*/, '')
    // Remove installment pattern first (e.g. "10x de 29,90")
    .replace(/\b\d{1,2}\s*[xX](?:\s*(?:de|vezes))?\s*(?:R\$\s*)?\d[\d.,]*/gi, '')
    .replace(/[\d.,]+/g, '')
    .replace(/(gastei|gasto|paguei|comprei|recebi|salário|salario|renda|despesa|receita|parcela|parcelado|em|de|do|da|no|na|com|para|x\s*\d+)/gi, '')
    .trim() || 'Transação';
}

/**
 * Extrai informações de parcelamento do texto
 * Formatos: "10x de 29,90", "3x 100", "10x29,90", "5 vezes 50"
 * @returns {{ count: number, amount: number } | null}
 */
export function extractInstallment(text) {
  const match = text.match(PATTERNS.INSTALLMENT);
  if (!match) return null;

  const count = parseInt(match[1], 10);
  const rawAmount = match[2].replace(/\./g, '').replace(',', '.');
  const amount = parseFloat(rawAmount);

  if (isNaN(count) || isNaN(amount) || count < 2 || count > 72 || amount <= 0) return null;

  return { count, amount };
}
