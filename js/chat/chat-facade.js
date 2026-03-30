// js/chat/chat-facade.js — Orquestrador central do Chat IA
import { detectIntent } from './intent-service.js';
import { extractAmount, extractCategory, extractAccount, extractDescription, extractInstallment } from './entity-extractor.js';
import { INTENTS, MSGS, CATEGORIES } from './constants.js';
import { hasGeminiKey, sendToGemini } from './ai-gemini.js';
import { hasOpenAIKey, sendToOpenAI } from './ai-openai.js';
import { formatCurrency } from '../utils.js';

let appState = null; // Reference to main app state

export function initChatFacade(state) {
  appState = state;
}

/**
 * Processa mensagem do usuário e retorna resposta do bot
 * @returns {Promise<{text: string, type: 'text'|'html'|'categories', data?: any}>}
 */
export async function processMessage(userText) {
  const intent = detectIntent(userText);
  const amount = extractAmount(userText);

  switch (intent) {
    case INTENTS.HELP:
      return { text: MSGS.HELP, type: 'html' };

    case INTENTS.CLEAR_DATA:
      return { text: MSGS.CHAT_CLEARED, type: 'html', action: 'clear' };

    case INTENTS.ADD_INSTALLMENT: {
      const installment = extractInstallment(userText);
      if (!installment) {
        return { text: 'Não entendi o parcelamento. Tente algo como "<b>10x de 29,90 netflix</b>".', type: 'html' };
      }

      const accounts = appState?.accounts || [];
      const desc = extractDescription(userText);
      const catMatch = extractCategory(userText, CATEGORIES);
      const account = extractAccount(userText, accounts);
      const total = Math.round(installment.count * installment.amount * 100) / 100;

      if (catMatch) {
        return {
          text: '', type: 'installment',
          data: {
            type: 'despesa',
            installmentCount: installment.count,
            installmentAmount: installment.amount,
            totalAmount: total,
            category: catMatch.name,
            description: desc || catMatch.name,
            accountId: account?.id || '',
            accountName: account?.name || 'Conta principal'
          }
        };
      }

      // Ask for category
      const relevantCats = CATEGORIES.filter(c => c.type === 'despesa');
      return {
        text: MSGS.ASK_CATEGORY(total),
        type: 'categories',
        data: {
          categories: relevantCats,
          amount: installment.amount,
          txType: 'despesa',
          description: desc,
          accountId: account?.id || '',
          isInstallment: true,
          installmentCount: installment.count,
          installmentAmount: installment.amount,
          totalAmount: total
        }
      };
    }

    case INTENTS.ADD_EXPENSE:
    case INTENTS.ADD_INCOME: {
      if (amount <= 0) {
        return { text: 'Não entendi o valor. Tente algo como "<b>-50 mercado</b>".', type: 'html' };
      }

      const txType = intent === INTENTS.ADD_INCOME ? 'receita' : 'despesa';
      const accounts = appState?.accounts || [];
      const desc = extractDescription(userText);
      const catMatch = extractCategory(userText, CATEGORIES);
      const account = extractAccount(userText, accounts);

      if (catMatch) {
        // Direct transaction — category found
        return {
          text: '', type: 'transaction',
          data: {
            type: txType, amount, category: catMatch.name,
            description: desc || catMatch.name,
            accountId: account?.id || '',
            accountName: account?.name || 'Conta principal'
          }
        };
      }

      // Ask for category
      const relevantCats = CATEGORIES.filter(c => c.type === txType);
      return {
        text: MSGS.ASK_CATEGORY(amount),
        type: 'categories',
        data: { categories: relevantCats, amount, txType, description: desc, accountId: account?.id || '' }
      };
    }

    case INTENTS.CHECK_BALANCE: {
      const accounts = appState?.accounts || [];
      if (accounts.length === 0) {
        return { text: 'Você ainda não tem contas cadastradas. Crie uma primeiro!', type: 'html' };
      }
      let msg = '💰 <b>Saldos:</b><br>';
      let total = 0;
      accounts.forEach(acc => {
        const bal = acc.currentBalance || 0;
        total += bal;
        msg += `• ${acc.name}: <b>${formatCurrency(bal)}</b><br>`;
      });
      msg += `<br><b>Total: ${formatCurrency(total)}</b>`;
      return { text: msg, type: 'html' };
    }

    case INTENTS.QUERY_SPENDING: {
      const transactions = appState?.transactions || [];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthExpenses = transactions.filter(t => {
        const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        return t.type === 'despesa' && d >= monthStart;
      });
      const total = monthExpenses.reduce((sum, t) => sum + t.amount, 0);
      return { text: `📊 Total de despesas este mês: <b>${formatCurrency(total)}</b> (${monthExpenses.length} transações)`, type: 'html' };
    }

    case INTENTS.HIGHEST_EXPENSE: {
      const transactions = appState?.transactions || [];
      const expenses = transactions.filter(t => t.type === 'despesa');
      if (expenses.length === 0) return { text: 'Nenhuma despesa encontrada.', type: 'html' };
      const highest = expenses.reduce((max, t) => t.amount > max.amount ? t : max);
      return { text: `📈 Maior despesa: <b>${highest.description || highest.category}</b> — <b>${formatCurrency(highest.amount)}</b>`, type: 'html' };
    }

    case INTENTS.RECENT_ACTIVITY: {
      const transactions = appState?.transactions || [];
      if (transactions.length === 0) return { text: 'Nenhuma transação encontrada.', type: 'html' };
      const recent = [...transactions]
        .sort((a, b) => {
          const da = a.date?.seconds || 0;
          const db = b.date?.seconds || 0;
          return db - da;
        })
        .slice(0, 5);
      let msg = '📜 <b>Últimas transações:</b><br>';
      recent.forEach(t => {
        const sign = t.type === 'receita' ? '+' : '-';
        msg += `${sign} ${formatCurrency(t.amount)} — ${t.description || t.category}<br>`;
      });
      return { text: msg, type: 'html' };
    }

    case INTENTS.GET_REPORT: {
      const transactions = appState?.transactions || [];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthly = transactions.filter(t => {
        const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        return d >= monthStart;
      });
      const income = monthly.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
      const expense = monthly.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
      return {
        text: `📊 <b>Resumo do Mês:</b><br>
          ➕ Receitas: <b class="text-income">${formatCurrency(income)}</b><br>
          ➖ Despesas: <b class="text-expense">${formatCurrency(expense)}</b><br>
          💰 Saldo: <b>${formatCurrency(income - expense)}</b>`,
        type: 'html'
      };
    }

    case INTENTS.AI_REPLY: {
      // Try Gemini first, then OpenAI
      const context = buildFinancialContext();

      if (hasGeminiKey()) {
        try {
          const reply = await sendToGemini(userText, context);
          return { text: reply, type: 'html' };
        } catch (e) {
          console.error('Gemini error:', e);
          return { text: `❌ Erro Gemini: ${e.message}`, type: 'html' };
        }
      }

      if (hasOpenAIKey()) {
        try {
          const reply = await sendToOpenAI(userText, context);
          return { text: reply, type: 'html' };
        } catch (e) {
          console.error('OpenAI error:', e);
          return { text: `❌ Erro OpenAI: ${e.message}`, type: 'html' };
        }
      }

      return { text: 'Não entendi sua mensagem. ' + MSGS.NO_API_KEY, type: 'html' };
    }

    default:
      return { text: MSGS.HELP, type: 'html' };
  }
}

function buildFinancialContext() {
  if (!appState) return '';

  const accounts = appState.accounts || [];
  const transactions = appState.transactions || [];
  const totalBalance = accounts.reduce((s, a) => s + (a.currentBalance || 0), 0);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthly = transactions.filter(t => {
    const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    return d >= monthStart;
  });
  const income = monthly.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
  const expense = monthly.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);

  return `Saldo total: R$ ${totalBalance.toFixed(2)}. Receitas do mês: R$ ${income.toFixed(2)}. Despesas do mês: R$ ${expense.toFixed(2)}. ${accounts.length} contas, ${transactions.length} transações.`;
}
