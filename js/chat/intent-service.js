// js/chat/intent-service.js — Detecção de intenção (portado do Money Manager)
import { INTENTS, PATTERNS } from './constants.js';

/**
 * Detecta a intenção do usuário baseado em keywords e regex
 */
export function detectIntent(text) {
  const lower = text.toLowerCase().trim();
  const hasAmount = PATTERNS.AMOUNT.test(lower);

  // Priority 1: Help
  if (PATTERNS.HELP_KEYWORDS.some(k => lower.includes(k))) return INTENTS.HELP;

  // Priority 2: Clear
  if (PATTERNS.CLEAR_KEYWORDS.some(k => lower.includes(k))) return INTENTS.CLEAR_DATA;

  // Priority 3: Installment — "10x de 29,90", "3x 100 netflix"
  if (PATTERNS.INSTALLMENT.test(lower)) return INTENTS.ADD_INSTALLMENT;

  // Priority 4: Explicit income with amount
  if (hasAmount && PATTERNS.INCOME_KEYWORDS.some(k => lower.includes(k))) return INTENTS.ADD_INCOME;

  // Priority 5: Explicit expense with amount
  if (hasAmount && PATTERNS.EXPENSE_KEYWORDS.some(k => lower.includes(k))) return INTENTS.ADD_EXPENSE;

  // Priority 6: Starts with + and has amount → income
  if (/^\+\s*\d/.test(lower)) return INTENTS.ADD_INCOME;

  // Priority 7: Starts with - and has amount → expense
  if (/^-\s*\d/.test(lower)) return INTENTS.ADD_EXPENSE;

  // Priority 7: Queries
  if (PATTERNS.QUERY_SPENDING_KEYWORDS.some(k => lower.includes(k))) return INTENTS.QUERY_SPENDING;
  if (PATTERNS.HIGHEST_EXPENSE_KEYWORDS.some(k => lower.includes(k))) return INTENTS.HIGHEST_EXPENSE;
  if (PATTERNS.BALANCE_KEYWORDS.some(k => lower.includes(k))) return INTENTS.CHECK_BALANCE;
  if (PATTERNS.RECENT_KEYWORDS.some(k => lower.includes(k))) return INTENTS.RECENT_ACTIVITY;
  if (PATTERNS.REPORT_KEYWORDS.some(k => lower.includes(k))) return INTENTS.GET_REPORT;

  // Priority 8: Just a number → start amount flow (treat as expense)
  if (/^\d[\d.,]*$/.test(lower.trim())) return INTENTS.ADD_EXPENSE;

  // Fallback: AI reply
  return INTENTS.AI_REPLY;
}
