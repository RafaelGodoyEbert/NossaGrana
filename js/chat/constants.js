// js/chat/constants.js — Constantes do Chat IA (portado do Money Manager)

export const INTENTS = {
  ADD_INCOME: 'ADD_INCOME',
  ADD_EXPENSE: 'ADD_EXPENSE',
  ADD_INSTALLMENT: 'ADD_INSTALLMENT',
  CHECK_BALANCE: 'CHECK_BALANCE',
  RECENT_ACTIVITY: 'RECENT_ACTIVITY',
  GET_REPORT: 'GET_REPORT',
  CLEAR_DATA: 'CLEAR_DATA',
  HELP: 'HELP',
  QUERY_SPENDING: 'QUERY_SPENDING',
  HIGHEST_EXPENSE: 'HIGHEST_EXPENSE',
  AI_REPLY: 'AI_REPLY'
};

export const PATTERNS = {
  AMOUNT: /(\d[\d,.]*)/,
  INSTALLMENT: /\b(\d{1,2})\s*[xX](?:\s*(?:de|vezes))?\s*(?:R\$\s*)?(\d[\d,.]*)/i,
  INCOME_KEYWORDS: ['salário', 'salario', 'recebi', 'receita', 'renda', 'freelance', 'ganho', 'ganhei', '+'],
  EXPENSE_KEYWORDS: ['gastei', 'gasto', 'paguei', 'comprei', 'despesa', 'compra', 'conta', '-'],
  BALANCE_KEYWORDS: ['saldo', 'quanto tenho', 'balance', 'quanto sobrou', 'total'],
  RECENT_KEYWORDS: ['últimas', 'recentes', 'últimos', 'historico', 'extrato'],
  REPORT_KEYWORDS: ['relatório', 'relatorio', 'resumo', 'mensal', 'report'],
  HELP_KEYWORDS: ['ajuda', 'help', 'comandos', 'o que você faz', 'como funciona'],
  QUERY_SPENDING_KEYWORDS: ['quanto gastei', 'total de gastos', 'total gasto'],
  HIGHEST_EXPENSE_KEYWORDS: ['maior gasto', 'maior despesa', 'highest'],
  CLEAR_KEYWORDS: ['limpar', 'clear', 'apagar chat']
};

export const MSGS = {
  WELCOME: (name) => `😊 ${name}! Sou seu assistente financeiro. Diga algo como "<b>-500 mercado</b>" ou "<b>+3000 salário</b>".`,
  HELP: `🤖 <b>Posso te ajudar com:</b><br>
    <b>➕ Receita:</b> "+500 salário" ou "recebi 200"<br>
    <b>➖ Despesa:</b> "-100 mercado" ou "gastei 50 almoço"<br>
    <b>💳 Parcela:</b> "10x de 29,90 Netflix" ou "3x 100 loja"<br>
    <b>💰 Saldo:</b> "saldo" ou "quanto tenho"<br>
    <b>📊 Relatório:</b> "relatório" ou "resumo"<br>
    <b>📜 Extrato:</b> "últimas transações"<br>
    <b>🧹 Limpar:</b> "limpar chat"<br>
    <b>🤖 IA:</b> Pergunte qualquer coisa se tiver a chave do Gemini/OpenAI configurada!`,
  ASK_CATEGORY: (amount) => `Para R$ ${amount.toFixed(2).replace('.', ',')} — selecione uma categoria:`,
  INCOME_ADDED: (amount, account, category) => `✅ Receita de <b>${amount}</b> adicionada em <b>${category}</b>.`,
  EXPENSE_ADDED: (amount, account, category) => `✅ Despesa de <b>${amount}</b> registrada em <b>${category}</b>.`,
  NO_API_KEY: 'Não tenho uma API de IA configurada. Vá em ⚙️ para conectar o Gemini ou OpenAI! Enquanto isso, uso só as regras locais.',
  INSTALLMENT_ADDED: (num, amount, total, category) => `✅ <b>${num}x de R$ ${amount}</b> (total R$ ${total}) registrado em <b>${category}</b>. Parcelas criadas para cada mês!`,
  ERROR: 'Ops, algo deu errado. Tente novamente.',
  CHAT_CLEARED: '🧹 Chat limpo!'
};

export const CATEGORIES = [
  { name: 'Alimentação', icon: '🍔', type: 'despesa' },
  { name: 'Transporte', icon: '🚗', type: 'despesa' },
  { name: 'Moradia', icon: '🏠', type: 'despesa' },
  { name: 'Lazer', icon: '🎮', type: 'despesa' },
  { name: 'Saúde', icon: '💊', type: 'despesa' },
  { name: 'Educação', icon: '📚', type: 'despesa' },
  { name: 'Vestuário', icon: '👕', type: 'despesa' },
  { name: 'Beleza', icon: '💅', type: 'despesa' },
  { name: 'Assinaturas', icon: '📱', type: 'despesa' },
  { name: 'Outros', icon: '📦', type: 'despesa' },
  { name: 'Salário', icon: '💼', type: 'receita' },
  { name: 'Freelance', icon: '💻', type: 'receita' },
  { name: 'Investimentos', icon: '📈', type: 'receita' },
  { name: 'Presente', icon: '🎁', type: 'receita' },
  { name: 'Outros', icon: '💰', type: 'receita' }
];
