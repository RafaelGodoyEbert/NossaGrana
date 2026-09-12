import { db } from '../firebase-config.js';
import { notifyPartner } from './notifications.js';

// ============================
// Estado Local (Demo Mode)
// ============================
let demoData = {
  accounts: [],
  transactions: [],
  budgets: [],
  goals: [],
  fixedBills: [],
  users: {},
  families: {}
};

let demoIdCounter = 1;
function demoId() { return 'demo-' + (demoIdCounter++); }

function isDemo() { return !db; }

// ============================
// Fetch All Data
// ============================
export async function fetchAllData(familyId, access = null) {
  const empty = { userAccounts: [], userTransactions: [], userBudgets: [], userGoals: [], userFixedBills: [] };
  if (access?.denied) return empty;

  if (isDemo()) {
    const all = {
      userAccounts: demoData.accounts.filter(a => a.familyId === familyId),
      userTransactions: demoData.transactions.filter(t => t.familyId === familyId),
      userBudgets: demoData.budgets.filter(b => b.familyId === familyId),
      userGoals: demoData.goals.filter(g => g.familyId === familyId),
      userFixedBills: demoData.fixedBills.filter(f => f.familyId === familyId)
    };
    if (!access?.restricted) return all;
    const allowedIds = new Set(access.scope === 'all' ? all.userAccounts.map(a => a.id) : access.accountIds);
    const withinDate = t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return (!access.from || d >= access.from) && (!access.until || d <= access.until);
    };
    return {
      userAccounts: all.userAccounts.filter(a => allowedIds.has(a.id)),
      userTransactions: all.userTransactions.filter(t => allowedIds.has(t.accountId) && withinDate(t)),
      userBudgets: [], userGoals: [], userFixedBills: []
    };
  }

  try {
    if (!access?.restricted) {
      const [accs, txs, buds, goals, bills] = await Promise.all([
        db.collection('accounts').where('familyId', '==', familyId).get(),
        db.collection('transactions').where('familyId', '==', familyId).get(),
        db.collection('budgets').where('familyId', '==', familyId).get(),
        db.collection('goals').where('familyId', '==', familyId).get(),
        db.collection('fixedBills').where('familyId', '==', familyId).get()
      ]);
      return {
        userAccounts: accs.docs.map(d => ({ id: d.id, ...d.data() })),
        userTransactions: txs.docs.map(d => ({ id: d.id, ...d.data() })),
        userBudgets: buds.docs.map(d => ({ id: d.id, ...d.data() })),
        userGoals: goals.docs.map(d => ({ id: d.id, ...d.data() })),
        userFixedBills: bills.docs.map(d => ({ id: d.id, ...d.data() }))
      };
    }

    let userAccounts = [];
    if (access.scope === 'all') {
      const accs = await db.collection('accounts').where('familyId', '==', familyId).get();
      userAccounts = accs.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      const docs = await Promise.all(access.accountIds.map(id => db.collection('accounts').doc(id).get()));
      userAccounts = docs.filter(d => d.exists && d.data().familyId === familyId).map(d => ({ id: d.id, ...d.data() }));
    }

    const txSnapshots = await Promise.all(userAccounts.map(account => {
      let query = db.collection('transactions').where('accountId', '==', account.id);
      if (access.from) query = query.where('date', '>=', access.from);
      if (access.until) query = query.where('date', '<=', access.until);
      return query.get();
    }));
    const txMap = new Map();
    txSnapshots.forEach(snapshot => snapshot.docs.forEach(doc => txMap.set(doc.id, { id: doc.id, ...doc.data() })));

    return {
      userAccounts,
      userTransactions: [...txMap.values()],
      userBudgets: [],
      userGoals: [],
      userFixedBills: []
    };
  } catch (error) {
    console.error('Erro ao buscar dados:', error);
    throw error;
  }
}

// ============================
// Generic Save / Delete
// ============================
async function saveDoc(collection, data, docId) {
  if (isDemo()) {
    if (docId) {
      const arr = demoData[collection];
      const idx = arr.findIndex(i => i.id === docId);
      if (idx >= 0) arr[idx] = { ...arr[idx], ...data };
    } else {
      const id = demoId();
      demoData[collection].push({ id, ...data });
      return id;
    }
    return docId;
  }

  if (docId) {
    await db.collection(collection).doc(docId).update(data);
    return docId;
  } else {
    const ref = await db.collection(collection).add(data);
    return ref.id;
  }
}

async function deleteDoc(collection, docId) {
  if (isDemo()) {
    demoData[collection] = demoData[collection].filter(i => i.id !== docId);
    return;
  }
  await db.collection(collection).doc(docId).delete();
}

// ============================
// Transactions
// ============================
export const saveTransaction = async (data, docId) => {
  const id = await saveDoc('transactions', data, docId);
  if (!docId && data.familyId && data.createdBy) {
    notifyPartner(data.familyId, data.createdBy, {
      title: data.type === 'receita' ? 'Nova Receita' : 'Nova Despesa',
      body: `${data.createdByName || 'O parceiro'} adicionou uma ${data.type} de R$ ${data.amount}.`,
      type: 'transaction'
    });
  }
  return id;
};
export const deleteTransaction = (docId) => deleteDoc('transactions', docId);

/**
 * Batch save transactions for high-performance imports.
 * @param {Array} transactions - Array of transaction data objects
 * @param {function} onProgress - Callback(saved, total) for progress updates
 * @returns {Promise<number>} Number of saved transactions
 */
export async function saveTransactionsBatch(transactions, onProgress, { queueLocally = false, accounts = [] } = {}) {
  if (isDemo()) {
    for (const account of accounts) {
      if (!demoData.accounts.some(a => a.id === account.id)) demoData.accounts.push(account);
    }
    let saved = 0;
    for (const data of transactions) {
      if (data.id) {
        // Update existing in demo mode
        const index = demoData.transactions.findIndex(t => t.id === data.id);
        if (index !== -1) {
          demoData.transactions[index] = { ...demoData.transactions[index], ...data };
        } else {
          demoData.transactions.push(data);
        }
      } else {
        const id = demoId();
        demoData.transactions.push({ id, ...data });
      }
      saved++;
      if (onProgress && saved % 50 === 0) onProgress(saved, transactions.length);
    }
    if (onProgress) onProgress(saved, transactions.length);
    return saved;
  }

  const BATCH_SIZE = 200;
  let saved = 0;
  let failed = 0;
  let queued = 0;
  const completions = [];
  const errors = [];
  const progress = () => onProgress?.(saved, transactions.length, { failed, queued });

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const chunk = transactions.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    if (i === 0) {
      for (const account of accounts) {
        const { id, ...data } = account;
        batch.set(db.collection('accounts').doc(id), data, { merge: true });
      }
    }
    for (const data of chunk) {
      const ref = data.id ? db.collection('transactions').doc(data.id) : db.collection('transactions').doc();
      // Keep the allocated ID for a safe retry of this same input.
      data.id = ref.id;
      const { id, ...payload } = data;
      batch.set(ref, payload, { merge: true });
    }
    queued += chunk.length;
    // The full Firestore SDK queues these writes locally and manages network retries.
    // Completion counts only server acknowledgements, never just local writes.
    const completion = batch.commit().then(() => {
      saved += chunk.length;
      progress();
    }).catch(error => {
      failed += chunk.length;
      errors.push(error);
      progress();
    });
    completions.push(completion);
    progress();
    if (queueLocally) {
      await new Promise(resolve => setTimeout(resolve, 0)); // Let previews and input stay responsive.
    } else {
      await completion;
      if (errors.length) break;
    }
  }
  await Promise.all(completions);
  if (errors.length) {
    const error = new Error(saved + ' de ' + transactions.length + ' transações confirmadas. ' + failed + ' falharam. ' + errors[0].message);
    error.code = errors[0].code;
    error.saved = saved;
    error.failed = failed;
    throw error;
  }
  return saved;
}

/**
 * Batch delete transactions.
 * @param {Array} transactionIds - Array of transaction IDs to delete
 * @param {function} onProgress - Callback(done, total)
 * @returns {Promise<number>} Number of deleted transactions
 */
export async function moveTransactionsToAccount(transactionIds, targetAccountId, onProgress) {
  if (!Array.isArray(transactionIds) || !transactionIds.length) return 0;
  if (!targetAccountId) throw new Error('Conta de destino inválida.');
  if (isDemo()) {
    let moved = 0;
    transactionIds.forEach(id => {
      const tx = demoData.transactions.find(t => t.id === id);
      if (tx) { tx.accountId = targetAccountId; moved++; }
    });
    if (onProgress) onProgress(moved, transactionIds.length);
    return moved;
  }
  const BATCH_SIZE = 450;
  let moved = 0;
  for (let i = 0; i < transactionIds.length; i += BATCH_SIZE) {
    const chunk = transactionIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(id => batch.update(db.collection('transactions').doc(id), { accountId: targetAccountId }));
    await batch.commit();
    moved += chunk.length;
    if (onProgress) onProgress(moved, transactionIds.length);
  }
  return moved;
}

export async function deleteTransactionsBatch(transactionIds, onProgress) {
  if (isDemo()) {
    transactionIds.forEach(id => {
      demoData.transactions = demoData.transactions.filter(t => t.id !== id);
    });
    if (onProgress) onProgress(transactionIds.length, transactionIds.length);
    return transactionIds.length;
  }

  const BATCH_SIZE = 500;
  let deleted = 0;

  for (let i = 0; i < transactionIds.length; i += BATCH_SIZE) {
    const chunk = transactionIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const id of chunk) {
      batch.delete(db.collection('transactions').doc(id));
    }

    await batch.commit();
    deleted += chunk.length;
    if (onProgress) onProgress(deleted, transactionIds.length);
  }

  return deleted;
}

/**
 * Move transações existentes para outra conta sem duplicá-las.
 */
export async function moveTransactionsBatch(transactionIds, targetAccountId, onProgress) {
  if (!Array.isArray(transactionIds) || !transactionIds.length) return 0;
  if (!targetAccountId) throw new Error('Conta de destino inválida.');

  if (isDemo()) {
    let moved = 0;
    transactionIds.forEach(id => {
      const tx = demoData.transactions.find(t => t.id === id);
      if (tx) { tx.accountId = targetAccountId; moved++; }
    });
    if (onProgress) onProgress(moved, transactionIds.length);
    return moved;
  }

  const BATCH_SIZE = 450;
  let moved = 0;
  for (let i = 0; i < transactionIds.length; i += BATCH_SIZE) {
    const chunk = transactionIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(id => batch.update(db.collection('transactions').doc(id), { accountId: targetAccountId }));
    await batch.commit();
    moved += chunk.length;
    if (onProgress) onProgress(moved, transactionIds.length);
  }
  return moved;
}

// ============================
// Accounts
// ============================
export const saveAccount = (data, docId) => saveDoc('accounts', data, docId);
export const deleteAccount = (docId) => deleteDoc('accounts', docId);

// ============================
// Budgets
// ============================
export const saveBudget = (data, docId) => saveDoc('budgets', data, docId);
export const deleteBudget = (docId) => deleteDoc('budgets', docId);

// ============================
// Goals
// ============================
export const saveGoal = (data, docId) => saveDoc('goals', data, docId);
export const deleteGoal = (docId) => deleteDoc('goals', docId);

// ============================
// Fixed Bills (Contas Fixas)
// ============================
export const saveFixedBill = (data, docId) => saveDoc('fixedBills', data, docId);
export const deleteFixedBill = (docId) => deleteDoc('fixedBills', docId);

// ============================
// Users / Families
// ============================
export async function getUserProfile(userId) {
  if (isDemo()) return demoData.users[userId] || null;
  const doc = await db.collection('users').doc(userId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function saveUserProfile(userId, data) {
  if (isDemo()) {
    demoData.users[userId] = { ...demoData.users[userId], ...data };
    return;
  }
  await db.collection('users').doc(userId).set(data, { merge: true });
}

export async function createFamily(familyId, data) {
  if (isDemo()) {
    demoData.families[familyId] = { id: familyId, ...data };
    return;
  }
  const batch = db.batch();
  batch.set(db.collection('families').doc(familyId), data);
  if (data.inviteCode) {
    batch.set(db.collection('familyInvites').doc(String(data.inviteCode).toUpperCase()), {
      familyId,
      createdBy: data.createdBy,
      createdAt: data.createdAt || new Date().toISOString()
    }, { merge: true });
  }
  await batch.commit();
}

export async function ensureFamilyInvite(family) {
  if (!family?.id || !family?.inviteCode || isDemo()) return;
  await db.collection('familyInvites').doc(String(family.inviteCode).toUpperCase()).set({
    familyId: family.id,
    createdBy: family.createdBy,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getFamilyByInviteCode(code) {
  if (isDemo()) {
    const entry = Object.entries(demoData.families).find(([_, f]) => f.inviteCode === code);
    return entry ? { id: entry[0], ...entry[1] } : null;
  }
  const doc = await db.collection('familyInvites').doc(String(code).toUpperCase()).get();
  return doc.exists ? { id: doc.data().familyId, inviteCode: String(code).toUpperCase() } : null;
}

export async function joinFamily(familyId, userId) {
  if (isDemo()) {
    const family = demoData.families[familyId];
    if (!family) throw new Error('Família não encontrada');
    family.members = [...new Set([...(family.members || []), userId])];
    return;
  }
  await db.collection('families').doc(familyId).update({
    members: firebase.firestore.FieldValue.arrayUnion(userId)
  });
}

export async function getFamily(familyId) {
  if (isDemo()) return demoData.families[familyId] || null;
  const doc = await db.collection('families').doc(familyId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function updateFamily(familyId, data) {
  if (isDemo()) {
    demoData.families[familyId] = { ...demoData.families[familyId], ...data };
    return;
  }
  await db.collection('families').doc(familyId).update(data);
}

// ============================
// Reset Family Data (Zona de Perigo)
// ============================
export async function resetFamilyData(familyId) {
  const collections = ['transactions', 'accounts', 'budgets', 'goals', 'fixedBills'];

  if (isDemo()) {
    collections.forEach(col => {
      demoData[col] = demoData[col].filter(item => item.familyId !== familyId);
    });
    return;
  }

  for (const col of collections) {
    let hasMore = true;
    while (hasMore) {
      const snap = await db.collection(col).where('familyId', '==', familyId).limit(500).get();
      if (snap.empty) {
        hasMore = false;
        continue;
      }

      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      // If we got 500 docs, there might be more
      if (snap.docs.length < 500) {
        hasMore = false;
      }
    }
  }
}

// ============================
// Balance Calculator
// ============================
export function calculateBalances(accounts, transactions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  accounts.forEach(acc => {
    // Começa com Saldo Inicial + Ajuste de Calibração
    let balance = (acc.initialBalance || 0) + (acc.initialAdjustment || 0);
    const accTxs = transactions.filter(t => t.accountId === acc.id);

    if (acc.type === 'cartao_credito') {
      const closingDay = acc.closingDay || 1;
      
      // ---- Determinar ciclos de faturamento ----
      // Modelo Nubank:
      //   - "Fatura Atual" = fatura FECHADA que precisa ser paga (ciclo anterior)
      //   - "Fatura Aberta" = ciclo acumulando agora
      //
      // Ex: closingDay=14, hoje=30/03:
      //   prevCycle:    14/fev → 14/mar  (Fatura Atual, vence ~14/abr)
      //   currentCycle: 14/mar → 14/abr  (Fatura Aberta, acumulando)
      //   Tudo antes de 14/fev = faturas antigas (provavelmente pagas)
      //
      // Ex: closingDay=14, hoje=10/03:
      //   prevCycle:    14/jan → 14/fev  (Fatura Atual, vence ~14/mar)
      //   currentCycle: 14/fev → 14/mar  (Fatura Aberta, acumulando)
      
      let prevCycleStart, prevCycleEnd, currentCycleStart, currentCycleEnd;
      if (now.getDate() >= closingDay) {
        // Já passou o fechamento deste mês
        prevCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, closingDay);
        prevCycleEnd = new Date(now.getFullYear(), now.getMonth(), closingDay);
        currentCycleStart = new Date(now.getFullYear(), now.getMonth(), closingDay);
        currentCycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, closingDay);
      } else {
        // Ainda não chegou no fechamento deste mês
        prevCycleStart = new Date(now.getFullYear(), now.getMonth() - 2, closingDay);
        prevCycleEnd = new Date(now.getFullYear(), now.getMonth() - 1, closingDay);
        currentCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, closingDay);
        currentCycleEnd = new Date(now.getFullYear(), now.getMonth(), closingDay);
      }
      prevCycleStart.setHours(0, 0, 0, 0);
      prevCycleEnd.setHours(0, 0, 0, 0);
      currentCycleStart.setHours(0, 0, 0, 0);
      currentCycleEnd.setHours(0, 0, 0, 0);

      let initialVal = (acc.initialBalance || 0) + (acc.initialAdjustment || 0);
      let debtTotal = initialVal;
      
      let purchasesClosed = initialVal < 0 ? Math.abs(initialVal) : 0;
      let totalPayments = initialVal > 0 ? initialVal : 0;
      let purchasesOpen = 0;
      let purchasesFuture = 0;

      accTxs.forEach(t => {
        // Restaurado: Respeitando a flag isPaid para a conta cartão de crédito fechar corretamente
        // sem exigir que o usuário crie transações de receita manualmente.
        if (!t.isPaid) {
          const txDate = t.date?.toDate ? t.date.toDate() : new Date(t.date);
          const amount = t.amount;
          
          if (t.type === 'receita') {
            totalPayments += amount;
            debtTotal += amount;
          } else {
            debtTotal -= amount;
            
            if (txDate >= currentCycleEnd) {
               purchasesFuture += amount;
            } else if (txDate >= currentCycleStart && txDate < currentCycleEnd) {
               purchasesOpen += amount;
            } else {
               purchasesClosed += amount;
            }
          }
        }
      });
      
      // Cascata de pagamentos: do mais antigo para o mais novo
      let closedDebt = purchasesClosed;
      let openDebt = purchasesOpen;
      let futureDebt = purchasesFuture;

      if (totalPayments > 0) {
        if (totalPayments >= closedDebt) {
          totalPayments -= closedDebt;
          closedDebt = 0;
        } else {
          closedDebt -= totalPayments;
          totalPayments = 0;
        }
      }

      if (totalPayments > 0) {
        if (totalPayments >= openDebt) {
          totalPayments -= openDebt;
          openDebt = 0;
        } else {
          openDebt -= totalPayments;
          totalPayments = 0;
        }
      }
      
      if (totalPayments > 0) {
        if (totalPayments >= futureDebt) {
          totalPayments -= futureDebt;
          futureDebt = 0;
        } else {
          futureDebt -= totalPayments;
          totalPayments = 0;
        }
      }

      acc.currentBalance = debtTotal;
      // Para o Nubank, a Fatura Atual engloba a fechada não paga e a acumulando
      acc.currentInvoice = -(closedDebt + openDebt);
      
      // Armazenando para o Modal
      acc._closedDebt = -closedDebt;
      acc._openDebt = -openDebt;
      acc._futureDebt = -futureDebt;
      // Guardar limites dos ciclos para uso na UI e liquidação
      acc._prevCycleStart = prevCycleStart;
      acc._prevCycleEnd = prevCycleEnd;
      acc._currentCycleStart = currentCycleStart;
      acc._currentCycleEnd = currentCycleEnd;
    } else {
      // Contas normais: considera tudo até hoje ou que já foi pago (mesmo se futuro)
      accTxs.forEach(t => {
        const txDate = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        if (txDate <= today || t.isPaid) {
          if (t.type === 'receita') balance += t.amount;
          else if (t.type === 'despesa') balance -= t.amount;
        }
      });
      acc.currentBalance = balance;
    }
  });
  return accounts;
}
