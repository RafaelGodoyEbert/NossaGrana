// js/main.js — Bootstrap principal do NossaGrana
import { auth, db, isFirebaseConfigured, saveFirebaseConfig } from '../firebase-config.js';
import {
  fetchAllData, saveTransaction, saveTransactionsBatch, deleteTransaction,
  saveAccount, deleteAccount, saveBudget, deleteBudget,
  saveGoal, deleteGoal, saveFixedBill, deleteFixedBill,
  getUserProfile, saveUserProfile,
  createFamily, getFamilyByInviteCode, getFamily, updateFamily,
  calculateBalances, resetFamilyData, deleteTransactionsBatch
} from './firestore.js';
import { formatCurrency, formatDate, showToast, todayString, generateInviteCode, getGreeting } from './utils.js';
import { initChat } from './chat/chat-ui.js';
import { initImport } from './import-ofx.js';
import { getGeminiKey } from './chat/ai-gemini.js';
import { getOpenAIKey } from './chat/ai-openai.js';
import { listenNotifications, requestNotificationPermission, markAsRead, notifyPartner } from './notifications.js';

// ============================
// App State
// ============================
const state = {
  user: null,
  profile: null,
  familyId: null,
  family: null,
  accounts: [],
  transactions: [],
  budgets: [],
  goals: [],
  fixedBills: [],
  filter: 'all', // all | mine | partner
  charts: {},
  txPagination: {
    currentPage: 1,
    rowsPerPage: 30
  },
  txSearchQuery: '',
  txShowFuture: false
};

// ============================
// Auth
// ============================
function initAuth() {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  document.getElementById('show-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  });
  document.getElementById('show-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });

  const forgotPasswordForm = document.getElementById('forgot-password-form');

  document.getElementById('show-forgot-password')?.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    forgotPasswordForm.classList.remove('hidden');
  });
  document.getElementById('forgot-password-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    forgotPasswordForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });

  loginForm?.addEventListener('submit', handleLogin);
  registerForm?.addEventListener('submit', handleRegister);
  forgotPasswordForm?.addEventListener('submit', handleForgotPassword);
  document.getElementById('join-invite-btn')?.addEventListener('click', handleJoinInvite);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  if (auth) {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        await onUserLoggedIn(user);
      } else {
        showAuthScreen();
      }
    });
  } else {
    // Demo mode — auto-login
    console.log('Modo Demo: Firebase não configurado');
    onUserLoggedIn({
      uid: 'demo-user',
      email: 'demo@nossagrana.app',
      displayName: 'Modo Demo'
    }, true);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('auth-error');

  try {
    errorEl.textContent = '';
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    errorEl.textContent = getAuthError(err.code);
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-password-email').value;
  const errorEl = document.getElementById('forgot-password-error');

  if (!auth) {
    showToast('Modo Demo', 'A recuperação de senha não está disponível no Modo Demo.', 'warning');
    return;
  }

  try {
    errorEl.textContent = '';
    await auth.sendPasswordResetEmail(email);
    showToast('Email enviado!', 'Verifique sua caixa de entrada para redefinir a senha.', 'success');
    document.getElementById('forgot-password-back')?.click();
  } catch (err) {
    errorEl.textContent = getAuthError(err.code);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('register-name').value;
  const email = document.getElementById('register-email').value;
  const pwd = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;
  const errorEl = document.getElementById('register-error');

  if (pwd !== confirm) { errorEl.textContent = 'As senhas não coincidem.'; return; }
  if (pwd.length < 6) { errorEl.textContent = 'Senha deve ter no mínimo 6 caracteres.'; return; }

  try {
    errorEl.textContent = '';
    const cred = await auth.createUserWithEmailAndPassword(email, pwd);

    // Create family
    const familyId = 'fam-' + generateInviteCode();
    const inviteCode = generateInviteCode();

    await createFamily(familyId, {
      inviteCode,
      members: [cred.user.uid],
      createdAt: new Date().toISOString(),
      createdBy: cred.user.uid
    });

    await saveUserProfile(cred.user.uid, {
      name, email,
      familyId,
      role: 'admin',
      createdAt: new Date().toISOString()
    });

    showToast('Conta criada!', 'Bem-vindo ao NossaGrana 💜', 'success');
  } catch (err) {
    errorEl.textContent = getAuthError(err.code);
  }
}

async function handleSetupForm(e) {
  e.preventDefault();
  const config = {
    apiKey: document.getElementById('setup-api-key').value.trim(),
    authDomain: document.getElementById('setup-auth-domain').value.trim(),
    projectId: document.getElementById('setup-project-id').value.trim(),
    storageBucket: document.getElementById('setup-storage-bucket').value.trim(),
    messagingSenderId: document.getElementById('setup-messaging-sender-id').value.trim(),
    appId: document.getElementById('setup-app-id').value.trim()
  };

  saveFirebaseConfig(config);
  showToast('Configuração salva!', 'O app será reiniciado agora...', 'success');
  setTimeout(() => window.location.reload(), 1500);
}

async function handleJoinInvite() {
  const code = document.getElementById('invite-code-input').value.trim().toUpperCase();
  if (code.length < 4) { showToast('Código inválido', 'Digite o código de convite', 'warning'); return; }

  const family = await getFamilyByInviteCode(code);
  if (!family) { showToast('Código não encontrado', 'Verifique o código e tente novamente', 'error'); return; }

  // Store the code temporarily — user needs to register/login first
  localStorage.setItem('pending_invite', JSON.stringify({ code, familyId: family.id }));
  showToast('Código válido!', 'Agora crie sua conta ou faça login para entrar', 'success');
}

async function handleLogout() {
  if (auth) {
    await auth.signOut();
  } else {
    showAuthScreen();
  }
}

async function onUserLoggedIn(user, isDemo = false) {
  state.user = user;

  // Check for pending invite
  const pending = localStorage.getItem('pending_invite');

  if (isDemo) {
    state.familyId = 'demo-family';
    state.profile = { name: 'Modo Demo', email: 'demo@nossagrana.app', familyId: 'demo-family', role: 'admin' };
    await createFamily('demo-family', { inviteCode: 'DEMO00', members: ['demo-user'], createdAt: new Date().toISOString(), createdBy: 'demo-user' });
    await saveUserProfile('demo-user', state.profile);
  } else {
    let profile = await getUserProfile(user.uid);

    if (!profile) {
      // First time — create profile and family
      const familyId = 'fam-' + generateInviteCode();
      const inviteCode = generateInviteCode();

      if (pending) {
        // Join existing family
        const invite = JSON.parse(pending);
        const family = await getFamily(invite.familyId);
        if (family) {
          family.members = [...(family.members || []), user.uid];
          await updateFamily(invite.familyId, { members: family.members });
          profile = {
            name: user.displayName || user.email.split('@')[0],
            email: user.email, familyId: invite.familyId, role: 'member',
            createdAt: new Date().toISOString()
          };
          localStorage.removeItem('pending_invite');
        }
      }

      if (!profile) {
        await createFamily(familyId, { inviteCode, members: [user.uid], createdAt: new Date().toISOString(), createdBy: user.uid });
        profile = { name: user.displayName || user.email.split('@')[0], email: user.email, familyId, role: 'admin', createdAt: new Date().toISOString() };
      }

      await saveUserProfile(user.uid, profile);
    } else if (pending) {
      // Existing user joining a family
      const invite = JSON.parse(pending);
      const family = await getFamily(invite.familyId);
      if (family && !family.members.includes(user.uid)) {
        family.members.push(user.uid);
        await updateFamily(invite.familyId, { members: family.members });
        profile.familyId = invite.familyId;
        profile.role = 'member';
        await saveUserProfile(user.uid, profile);
        localStorage.removeItem('pending_invite');
      }
    }

    state.profile = profile;
    state.familyId = profile.familyId;
  }

  state.family = await getFamily(state.familyId);
  showMainApp();
  await loadAllData();

  if (!isDemo) {
    if (await requestNotificationPermission()) {
      console.log('Permissão de notificação concedida');
    }
    listenNotifications(state.user.uid, renderNotifications);
  }
}

// ============================
// Data Loading
// ============================
async function loadAllData() {
  const data = await fetchAllData(state.familyId);
  state.accounts = calculateBalances(data.userAccounts, data.userTransactions);
  state.transactions = data.userTransactions;
  state.budgets = data.userBudgets;
  state.goals = data.userGoals;
  state.fixedBills = data.userFixedBills || [];


  state.familyProfiles = {};
  if (state.family && state.family.members) {
    for (const uid of state.family.members) {
      if (uid === state.user.uid) {
        state.familyProfiles[uid] = state.profile;
      } else {
        const p = await getUserProfile(uid);
        if (p) state.familyProfiles[uid] = p;
      }
    }
  }

  state.userName = state.profile?.name || 'Usuário';
  renderDashboard();
  renderTransactions();
  renderAccounts();
  renderBudgets();
  renderGoals();
  renderFixedBills();
  renderProfile();
  renderReports();
  renderPayables();
  renderCategories();

  // Init Chat
  initChat(state, handleChatTransaction, handleChatInstallment);

  // Init Import
  initImport(
    handleImportedTransactions,
    () => state.accounts,
    () => state.transactions,
    () => state.familyProfiles,
    () => state.user.uid
  );
}


/**
 * Paga a fatura do ciclo anterior (fatura fechada / Fatura Atual).
 * Marca como isPaid=true todas as transações do prevCycle.
 */
window.payCurrentInvoice = async function(accountId) {
  const acc = state.accounts.find(a => a.id === accountId);
  if (!acc || acc.type !== 'cartao_credito') return;
  if (!db) { showToast('Modo Demo', 'Não disponível no modo demo.', 'warning'); return; }

  const prevStart = acc._prevCycleStart;
  const prevEnd = acc._prevCycleEnd;
  if (!prevStart || !prevEnd) return;

  // Encontrar transações não pagas no ciclo anterior (fatura fechada)
  const txsInCycle = state.transactions.filter(t => {
    if (t.accountId !== accountId || t.isPaid) return false;
    const txDate = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    return txDate >= prevStart && txDate < prevEnd;
  });

  if (txsInCycle.length === 0) {
    showToast('Sem pendências', 'Não há transações pendentes na fatura atual.', 'info');
    return;
  }

  const total = txsInCycle.reduce((s, t) => s + (t.type === 'despesa' ? t.amount : -t.amount), 0);
  const cycleLabel = `${prevStart.toLocaleDateString('pt-BR')} a ${prevEnd.toLocaleDateString('pt-BR')}`;

  if (!confirm(`💳 Pagar fatura do ciclo ${cycleLabel}?\n\n${txsInCycle.length} transação(ões) — Total: ${formatCurrency(Math.abs(total))}\n\nIsso marcará todas como PAGAS.`)) return;

  try {
    for (let i = 0; i < txsInCycle.length; i += 500) {
      const chunk = txsInCycle.slice(i, i + 500);
      const batch = db.batch();
      chunk.forEach(t => {
        batch.update(db.collection('transactions').doc(t.id), { isPaid: true });
      });
      await batch.commit();
    }

    showToast('Fatura Paga! ✅', `${txsInCycle.length} transações liquidadas — ${formatCurrency(Math.abs(total))}`, 'success');
    notifyPartner(state.familyId, state.user.uid, {
      title: 'Fatura Paga',
      body: `${state.profile?.name || 'O parceiro'} pagou a fatura do cartão "${acc.name}".`,
      type: 'info'
    });
    await loadAllData();
  } catch (err) {
    console.error('Erro ao pagar fatura:', err);
    showToast('Erro', 'Não foi possível marcar a fatura como paga.', 'error');
  }
};

window.paySpecificInvoice = async function(accountId, cycleKey) {
  const acc = state.accounts.find(a => a.id === accountId);
  if (!acc || acc.type !== 'cartao_credito') return;
  if (!db) { showToast('Modo Demo', 'Não disponível no modo demo.', 'warning'); return; }

  const closingDay = acc.closingDay || 1;
  const getCycleKey = (date) => {
    const m = date.toLocaleString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '');
    const y = date.getFullYear().toString().slice(2);
    return `${m} ${y}`;
  };

  const txsInCycle = state.transactions.filter(t => {
    if (t.accountId !== accountId || t.isPaid) return false;
    const txDate = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    let cycleMonthDate = new Date(txDate.getFullYear(), txDate.getMonth(), closingDay);
    if (txDate.getDate() >= closingDay) {
        cycleMonthDate.setMonth(cycleMonthDate.getMonth() + 1);
    }
    return getCycleKey(cycleMonthDate) === cycleKey;
  });

  if (txsInCycle.length === 0) {
    showToast('Sem pendências', 'Não há transações pendentes nesta fatura.', 'info');
    return;
  }

  const total = txsInCycle.reduce((s, t) => {
    let amt = Number(t.amount) || 0;
    const descLower = (t.description || t.name || '').toLowerCase();
    const isPayment = t.type === 'receita' && (descLower.includes('pagamento') || descLower.includes('fatura') || descLower.includes('recebido'));
    if (isPayment) return s; 
    return s + (t.type === 'receita' ? -amt : amt);
  }, 0);

  if (!confirm(`💳 Pagar a fatura do cartão "${acc.name}" correspondente a ${cycleKey}?\n\n${txsInCycle.length} transação(ões) pendentes.\nTotal a liquidar: ${formatCurrency(Math.abs(total))}\n\nIsso marcará todas essas compras como PAGAS.`)) return;

  try {
    for (let i = 0; i < txsInCycle.length; i += 500) {
      const chunk = txsInCycle.slice(i, i + 500);
      const batch = db.batch();
      chunk.forEach(t => {
        batch.update(db.collection('transactions').doc(t.id), { isPaid: true });
      });
      await batch.commit();
    }

    showToast('Fatura Paga! ✅', `${txsInCycle.length} transações liquidadas — ${formatCurrency(Math.abs(total))}`, 'success');
    notifyPartner(state.familyId, state.user.uid, {
      title: 'Fatura Paga',
      body: `${state.profile?.name || 'O parceiro'} pagou a fatura isolada do cartão "${acc.name}".`,
      type: 'info'
    });
    
    // Fecha o modal caso esteja aberto dessa fatura específica
    const modal = document.getElementById('invoice-modal');
    if (modal && !modal.classList.contains('hidden')) {
        closeModal('invoice-modal');
    }
    
    await loadAllData();
  } catch (err) {
    console.error('Erro ao pagar fatura isolada:', err);
    showToast('Erro', 'Não foi possível marcar a fatura como paga.', 'error');
  }
};

// ============================
// Chat Transaction Handler
// ============================
async function handleChatTransaction(txData) {
  const data = {
    familyId: state.familyId,
    createdBy: state.user.uid,
    createdByName: state.profile?.name || 'Usuário',
    type: txData.type,
    amount: txData.amount,
    category: txData.category,
    description: txData.description || txData.category,
    accountId: txData.accountId || (state.accounts[0]?.id || ''),
    date: db ? firebase.firestore.Timestamp.fromDate(new Date()) : { seconds: Math.floor(Date.now() / 1000), toDate: () => new Date() },
    isPaid: true
  };

  await saveTransaction(data, null);
  showToast(
    txData.type === 'receita' ? 'Receita adicionada!' : 'Despesa registrada!',
    `${formatCurrency(txData.amount)} • ${txData.category}`,
    'success'
  );
  await loadAllData();
}

// ============================
// Chat Installment Handler
// ============================
async function handleChatInstallment(txData) {
  const baseDate = new Date();
  const count = txData.installmentCount;
  const perAmount = txData.installmentAmount;

  for (let i = 0; i < count; i++) {
    const installDate = addMonths(baseDate, i);
    const descFinal = `[Parcela ${i + 1}/${count}] ${txData.description || txData.category}`;

    const data = {
      familyId: state.familyId,
      createdBy: state.user.uid,
      createdByName: state.profile?.name || 'Usuário',
      type: 'despesa',
      amount: perAmount,
      category: txData.category,
      description: descFinal,
      accountId: txData.accountId || (state.accounts[0]?.id || ''),
      date: db ? firebase.firestore.Timestamp.fromDate(installDate) : { seconds: Math.floor(installDate.getTime() / 1000), toDate: () => installDate },
      isPaid: i === 0,
      installmentInfo: { current: i + 1, total: count, originalAmount: perAmount * count }
    };

    await saveTransaction(data, null);
  }

  showToast(
    'Parcelas criadas!',
    `${count}x de ${formatCurrency(perAmount)} • ${txData.category}`,
    'success'
  );
  await loadAllData();
}

// ============================
// Import Handler
// ============================
async function handleImportedTransactions(importedTxs, accountId, userId) {
  const selectedUserId = userId || state.user.uid;
  const selectedUserName = state.familyProfiles?.[selectedUserId]?.name || state.profile?.name || 'Usuário';

  // Auto-separation logic for 'credito'
  const hasCredito = importedTxs.some(tx => tx.paymentMethod === 'credito');
  let targetCreditAccountId = null;
  const originalAccount = state.accounts.find(a => a.id === accountId);

  if (hasCredito && originalAccount) {
    if (originalAccount.type === 'cartao_credito') {
      // If importing directly into a credit card, keep it there
      targetCreditAccountId = originalAccount.id;
    } else {
      // Look for a paired credit card account
      const expectedName = `Cartão ${originalAccount.name}`;
      let cAcc = state.accounts.find(a => a.type === 'cartao_credito' && (a.name === expectedName || a.name.includes(originalAccount.name)));

      if (!cAcc) {
        // Auto-create the credit card account with zero limit
        const newAccData = {
          familyId: state.familyId,
          createdBy: selectedUserId,
          name: expectedName,
          type: 'cartao_credito',
          initialBalance: 0,
          creditLimit: 0
        };
        targetCreditAccountId = await saveAccount(newAccData, null);
      } else {
        targetCreditAccountId = cAcc.id;
      }
    }
  }

  const normalizeDesc = (desc) => {
    if (!desc) return '';
    return desc.toLowerCase()
               .replace(/ - parcela \d+\/\d+$/i, '')
               .replace(/ - \d+\/\d+$/i, '')
               .replace(/^cartão - /, '')
               .replace(/^nupay - /, '')
               .replace(/parcela \d+\/\d+/i, '')
               .replace(/\s+/g, '')
               .trim();
  };

  const existingInsts = [];
  state.transactions.forEach(ex => {
    if (ex.description && (ex.description.includes('/') || ex.installmentInfo)) {
      const normBase = normalizeDesc(ex.description);
      const amountCents = Math.round(ex.amount * 100);
      const instMatch = ex.description.match(/(\d+\/\d+)$/);
      const instCount = instMatch ? instMatch[1] : (ex.installmentInfo ? `${ex.installmentInfo.current}/${ex.installmentInfo.total}` : '1/1');
      const cleanInstCount = instCount.replace(/^0+/, '').replace(/\/0+/, '/'); 
      existingInsts.push({ normBase, amountCents, cleanInstCount });
    }
  });

  // Build data array
  const txDataArray = importedTxs.reduce((acc, tx) => {
    const dateObj = tx.date instanceof Date ? tx.date : new Date(tx.date);

    let finalAccountId = accountId || state.accounts[0]?.id || '';
    if (tx.paymentMethod === 'credito' && targetCreditAccountId) {
      finalAccountId = targetCreditAccountId;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Lógica de "Pago":
    // 1. Se for crédito e tiver flag invoicePayment, marca como PAGO (isPaid: true).
    //    Isso porque esses créditos/pagamentos se referem à fatura anterior.
    // 2. Se for crédito comum, NUNCA é marcado como pago automaticamente na importação.
    // 3. Se não for crédito, é pago se a data for hoje ou no passado.
    let isPaid = false;
    if (tx.invoicePayment) {
      isPaid = true; // Já aplicado na fatura anterior
    } else if (tx.paymentMethod === 'credito') {
      isPaid = false; // Mantenha como dívida até o pagamento da fatura ser registrado
    } else {
      isPaid = dateObj <= today;
    }

    let resultTx = {
      familyId: state.familyId,
      createdBy: selectedUserId,
      createdByName: selectedUserName,
      type: tx.type,
      amount: tx.amount,
      category: tx.category || 'Importado',
      description: tx.description || 'Transação importada',
      accountId: finalAccountId,
      date: db ? firebase.firestore.Timestamp.fromDate(dateObj) : { seconds: Math.floor(dateObj.getTime() / 1000), toDate: () => dateObj },
      isPaid,
      source: 'import',
      paymentMethod: tx.paymentMethod || '',
      invoicePayment: tx.invoicePayment || false
    };

    if (tx.fitid) {
      resultTx.fitid = tx.fitid;
    }

    if (tx.updateTargetId) {
      resultTx.id = tx.updateTargetId;
    }
    
    if (tx.installmentInfo) {
      resultTx.installmentInfo = tx.installmentInfo;
    }

    acc.push(resultTx);

    // Auto-generate future installments for credit card purchases
    if (tx.installmentInfo && tx.paymentMethod === 'credito') {
      const current = tx.installmentInfo.current;
      const total = tx.installmentInfo.total;
      
      for (let i = current + 1; i <= total; i++) {
        const instCountStr = `${i}/${total}`;
        const cleanInstCountStr = instCountStr.replace(/^0+/, '').replace(/\/0+/, '/'); 
        const normBase = normalizeDesc(tx.description);
        const amountCents = Math.round(tx.amount * 100);
        const isMatch = (dbItem) => {
           if (dbItem.cleanInstCount !== cleanInstCountStr) return false;
           if (Math.abs(dbItem.amountCents - amountCents) > 5) return false;
           return dbItem.normBase.includes(normBase) || normBase.includes(dbItem.normBase);
        };

        if (!existingInsts.some(isMatch)) {
          existingInsts.push({ normBase, amountCents, cleanInstCount: cleanInstCountStr });
          
          const futureDate = new Date(dateObj);
          futureDate.setMonth(futureDate.getMonth() + (i - current));
          
          let baseTitle = tx.description;
          if (tx.installmentInfo.baseTitle) {
             baseTitle = tx.installmentInfo.baseTitle;
          } else {
             const instMatch = tx.description.match(/ - Parcela \d+\/\d+$/i) || 
                               tx.description.match(/ - \d+\/\d+$/i) || 
                               tx.description.match(/ Parcela \d+\/\d+$/i) || 
                               tx.description.match(/ \d+\/\d+$/i);
             if (instMatch) {
               baseTitle = tx.description.substring(0, tx.description.length - instMatch[0].length).trim();
             }
          }
          
          const futureDesc = `${baseTitle} - ${i}/${total}`;
          
          acc.push({
            familyId: state.familyId,
            createdBy: selectedUserId,
            createdByName: selectedUserName,
            type: 'despesa', // installments are always despesa
            amount: tx.amount,
            category: tx.category || 'Importado',
            description: futureDesc,
            accountId: finalAccountId,
            date: db ? firebase.firestore.Timestamp.fromDate(futureDate) : { seconds: Math.floor(futureDate.getTime() / 1000), toDate: () => futureDate },
            isPaid: false,
            source: 'import',
            paymentMethod: 'credito',
            invoicePayment: false,
            installmentInfo: { current: i, total: total, originalAmount: tx.amount * total, baseTitle }
          });
        }
      }
    }

    return acc;
  }, []);

  // Show progress overlay
  const overlay = document.createElement('div');
  overlay.id = 'import-progress-overlay';
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;">
      <div style="background:var(--bg-secondary,#1e1e2e);border-radius:16px;padding:32px 40px;text-align:center;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
        <div style="font-size:2rem;margin-bottom:12px;">📥</div>
        <h3 style="margin-bottom:8px;">Importando transações...</h3>
        <p id="import-progress-text" style="color:var(--text-secondary);margin-bottom:16px;">Preparando...</p>
        <div style="background:var(--bg-tertiary,#2a2a3e);border-radius:8px;height:12px;overflow:hidden;">
          <div id="import-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--primary-color,#6366f1),var(--accent-color,#a78bfa));border-radius:8px;transition:width 0.3s ease;"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  try {
    const saved = await saveTransactionsBatch(txDataArray, (done, total) => {
      const pct = Math.round((done / total) * 100);
      const bar = document.getElementById('import-progress-bar');
      const text = document.getElementById('import-progress-text');
      if (bar) bar.style.width = pct + '%';
      if (text) text.textContent = `${done} de ${total} transações (${pct}%)`;
    });

    // Se houver pagamentos de fatura, dispara a liquidação automática do histórico
    const hasInvoicePayment = txDataArray.some(t => t.invoicePayment);
    if (hasInvoicePayment) {
      const accountIds = [...new Set(txDataArray.filter(t => t.invoicePayment).map(t => t.accountId))];
      for (const accId of accountIds) {
        await automateInvoiceSettlement(accId);
      }
    }

    showToast(`${saved} transações importadas!`, 'Dados atualizados', 'success');
  } catch (err) {
    console.error('Batch import error:', err);
    showToast('Erro na importação', err.message, 'error');
  } finally {
    overlay.remove();
    await loadAllData();
  }
}

/**
 * Liquida automaticamente transações antigas de um cartão quando um pagamento é detectado.
 */
async function automateInvoiceSettlement(accountId) {
  const acc = state.accounts.find(a => a.id === accountId);
  if (!acc || acc.type !== 'cartao_credito') return;

  const closingDay = acc.closingDay || 14;
  const now = new Date();
  let limitDate;

  // Define a data limite como o fechamento da fatura que acabou de ser paga
  if (now.getDate() >= closingDay) {
    limitDate = new Date(now.getFullYear(), now.getMonth(), closingDay);
  } else {
    limitDate = new Date(now.getFullYear(), now.getMonth() - 1, closingDay);
  }

  const txsToUpdate = state.transactions.filter(t => 
    t.accountId === accountId && 
    !t.isPaid && 
    !t.invoicePayment &&
    (t.date?.toDate ? t.date.toDate() : new Date(t.date)) < limitDate
  );

  if (txsToUpdate.length > 0) {
    console.log(`Liquidando ${txsToUpdate.length} transações antigas para o cartão ${acc.name}`);
    const batch = db.batch();
    txsToUpdate.forEach(t => {
      batch.update(db.collection('transactions').doc(t.id), { isPaid: true });
    });
    await batch.commit();
  }
}

/**
 * Limpeza retroativa para transações de 2024 e 2025 em massa.
 */
window.cleanupOldCreditHistory = async function() {
  const accId = document.getElementById('acc-id')?.value;
  if (!accId) {
    showToast('Atenção', 'Selecione uma conta de cartão primeiro.', 'warning');
    return;
  }

  const limitDate = new Date(2026, 0, 1); // 01/Jan/2026
  const txsToUpdate = state.transactions.filter(t => 
    t.accountId === accId && 
    !t.isPaid && 
    (t.date?.toDate ? t.date.toDate() : new Date(t.date)) < limitDate
  );

  if (txsToUpdate.length === 0) {
    showToast('Limpo!', 'Não há transações de 2024/2025 pendentes nesta conta.', 'info');
    return;
  }

  const msg = `Encontramos ${txsToUpdate.length} transações de 2024/2025 ainda em aberto. Deseja marcá-las como PAGAS para limpar seu histórico?`;
  if (!confirm(msg)) return;

  try {
    const batch = db.batch();
    txsToUpdate.forEach(t => {
      batch.update(db.collection('transactions').doc(t.id), { isPaid: true });
    });
    await batch.commit();
    showToast('Histórico Limpo!', `${txsToUpdate.length} transações liquidadas.`, 'success');
    await loadAllData();
  } catch (err) {
    console.error('Cleanup error:', err);
    showToast('Erro', 'Não foi possível limpar o histórico.', 'error');
  }
};

// ============================
// Installment Utility
// ============================
function addMonths(dateObj, months) {
  const d = new Date(dateObj);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ============================
// Dashboard
// ============================
function renderDashboard() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  let txs = state.transactions;
  // Filter by couple
  if (state.filter === 'mine') txs = txs.filter(t => t.createdBy === state.user.uid);
  else if (state.filter === 'partner') txs = txs.filter(t => t.createdBy !== state.user.uid);

  const monthly = txs.filter(t => {
    const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    return d >= monthStart && d <= monthEnd && t.category !== 'Transferência Interna';
  });

  const income = monthly.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
  const expense = monthly.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
  // Saldo total: se tem contas, usa balances; senão calcula de todas as transações (até hoje)
  // Para cartões, o saldo que impacta o "Patrimônio" imediato é o que vc deve na Fatura Atual.
  let totalBalance = state.accounts.reduce((s, a) => {
    const val = a.type === 'cartao_credito' ? (a.currentInvoice || 0) : (a.currentBalance || 0);
    return s + val;
  }, 0);
  
  if (state.accounts.length === 0 && txs.length > 0) {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    totalBalance = txs.reduce((s, t) => {
      const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      if (td <= endOfToday || t.isPaid) {
        return s + (t.type === 'receita' ? t.amount : -t.amount);
      }
      return s;
    }, 0);
  }

  document.getElementById('total-balance').textContent = formatCurrency(totalBalance);
  document.getElementById('monthly-income').textContent = formatCurrency(income);
  document.getElementById('monthly-expenses').textContent = formatCurrency(expense);
  document.getElementById('monthly-savings').textContent = formatCurrency(income - expense);

  // Colorize
  document.getElementById('total-balance').style.color = totalBalance >= 0 ? '' : 'var(--expense-color)';
  document.getElementById('monthly-savings').style.color = (income - expense) >= 0 ? 'var(--income-color)' : 'var(--expense-color)';

  // Recent transactions
  renderRecentTransactions(txs);

  // Chart
  renderMainChart(txs);
  renderDashboardWidgets(txs);
}

function renderRecentTransactions(txs) {
  const container = document.getElementById('recent-transactions-list');
  if (!container) return;

  const now = new Date();
  const recent = [...txs]
    .filter(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return d <= now || t.isPaid; // Mostra tudo até hoje OU o que já foi marcado como pago manualmente
    })
    .sort((a, b) => {
      const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
      const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
      return db.getTime() - da.getTime();
    })
    .slice(0, 8);

  if (recent.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-receipt"></i><p>Nenhuma transação ainda</p></div>';
    return;
  }

  container.innerHTML = recent.map(t => {
    const profile = state.familyProfiles?.[t.createdBy];
    const who = profile?.name ? profile.name.split(' ')[0] : (t.createdByName || '?').split(' ')[0];
    const initial = who[0].toUpperCase();
    const sign = t.type === 'receita' ? '+' : '-';
    const colorClass = t.type === 'receita' ? 'text-income' : 'text-expense';
    const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    return `
      <div class="recent-tx-item">
        <div class="recent-tx-info">
          <div class="recent-tx-avatar">${initial}</div>
          <div>
            <div class="recent-tx-desc">${t.description || t.category}</div>
            <div class="recent-tx-cat">${t.category} • ${d.toLocaleDateString('pt-BR')} • ${who}</div>
          </div>
        </div>
        <span class="recent-tx-amount ${colorClass}">${sign} ${formatCurrency(t.amount)}</span>
      </div>
    `;
  }).join('');
}

function renderMainChart(txs) {
  const ctx = document.getElementById('main-chart');
  if (!ctx) return;

  // Destroy previous chart
  if (state.charts.main) state.charts.main.destroy();

  const months = [];
  const incomes = [];
  const expenses = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1); // Set to 1st to avoid wrapping months on 31st
    d.setMonth(d.getMonth() - i);
    const label = d.toLocaleDateString('pt-BR', { month: 'short' });
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    const monthTxs = txs.filter(t => {
      const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return td >= start && td <= end;
    });

    months.push(label);
    incomes.push(monthTxs.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0));
    expenses.push(monthTxs.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0));
  }

  state.charts.main = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Receitas', data: incomes,
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderColor: '#10b981', borderWidth: 1, borderRadius: 6
        },
        {
          label: 'Despesas', data: expenses,
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderColor: '#ef4444', borderWidth: 1, borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR') } } }
    }
  });
}

// ============================
// Dashboard Widgets
// ============================
function renderDashboardWidgets(txs) {
  const invoicesList = document.getElementById('upcoming-invoices-list');
  const budgetsList = document.getElementById('budgets-overview-list');
  if (!invoicesList || !budgetsList) return;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const next30Time = now.getTime() + (30 * 24 * 60 * 60 * 1000);

  // Faturas Próximas (próximos 30 dias com base no pendente do mês)
  let pending = txs.filter(t => !t.isPaid).filter(t => t.type === 'despesa');

  // Excluir compras individuais de cartão de crédito e substitui-las por faturas agregadas
  pending = pending.filter(t => {
    const acc = state.accounts.find(a => a.id === t.accountId);
    return !(acc && acc.type === 'cartao_credito');
  });

  const getCycleKey = (date) => {
    const m = date.toLocaleString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '');
    const y = date.getFullYear().toString().slice(2);
    return `${m} ${y}`;
  };

  state.accounts.filter(a => a.type === 'cartao_credito').forEach(acc => {
    const createVirtualInvoice = (debt, cycleEnd, isClosed) => {
      if (Math.abs(debt) < 0.01) return;
      const cycleKey = getCycleKey(cycleEnd);
      let dueDate = new Date(cycleEnd.getTime());
      dueDate.setDate(acc.dueDay || acc.closingDay);
      if ((acc.dueDay || acc.closingDay) < acc.closingDay) {
          dueDate.setMonth(dueDate.getMonth() + 1);
      }
      dueDate.setHours(0, 0, 0, 0);
      pending.push({
        _isCreditCardInvoice: true,
        description: `Fatura ${acc.name} (${cycleKey})` + (isClosed ? ' - Fechada' : ''),
        category: 'Cartão de Crédito',
        date: dueDate,
        amount: Math.abs(debt),
        type: 'despesa'
      });
    };

    if (acc._closedDebt) createVirtualInvoice(acc._closedDebt, acc._prevCycleEnd, true);
    if (acc.currentInvoice) createVirtualInvoice(acc.currentInvoice, acc._currentCycleEnd, false);
    if (acc._nextInvoice) createVirtualInvoice(acc._nextInvoice, acc._nextCycleEnd, false);
  });

  const upcoming = pending.filter(t => {
    let d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    d.setHours(0, 0, 0, 0);
    const m = d.getTime();
    return m >= now.getTime() && m <= next30Time;
  }).sort((a, b) => {
    const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
    const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
    return da.getTime() - db.getTime();
  });

  if (upcoming.length === 0) {
    invoicesList.innerHTML = '<div class="empty-state" style="padding:15px;font-size:0.8rem;"><p>Sem faturas próximas</p></div>';
  } else {
    invoicesList.innerHTML = upcoming.slice(0, 5).map(t => {
      let d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return `
      <div class="recent-tx-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color); gap:12px;">
        <div style="font-size:0.85rem; flex:1; min-width:0;">
          <div style="font-weight:600; color:var(--text-primary); line-height:1.2; margin-bottom:2px; overflow-wrap:break-word;">${t.description || t.category}</div>
          <div style="font-size:0.75rem; color:var(--text-secondary); opacity:0.8;">${d.toLocaleDateString('pt-BR')}</div>
        </div>
        <div style="font-weight:700; color:var(--expense-color); font-size:0.9rem; white-space:nowrap; text-align:right;">
          - ${formatCurrency(t.amount)}
        </div>
      </div>`;
    }).join('');
  }

  // Orçamentos do Mês
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (state.budgets && state.budgets.length > 0) {
    budgetsList.innerHTML = state.budgets.slice(0, 4).map(b => {
      const spent = txs.filter(t => t.type === 'despesa' && t.category.toLowerCase() === b.category.toLowerCase())
        .filter(t => { const d = t.date?.toDate ? t.date.toDate() : new Date(t.date); return d >= monthStart; })
        .reduce((s, t) => s + t.amount, 0);
      const pct = Math.min((spent / b.limit) * 100, 100);
      const color = pct > 90 ? 'var(--expense-color)' : pct > 70 ? 'var(--warning-color)' : 'var(--primary-500)';
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:4px;">
            <span>${b.category}</span>
            <span><strong style="color:${color}">${formatCurrency(spent)}</strong> / ${formatCurrency(b.limit)}</span>
          </div>
          <div class="progress-bar" style="background:var(--bg-tertiary); height:6px; border-radius:3px; margin:0;">
            <div style="width:${pct}%; background:${color}; height:100%; border-radius:3px; transition: width 0.3s;"></div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    budgetsList.innerHTML = '<div class="empty-state" style="padding:15px;font-size:0.8rem;"><p>Nenhum orçamento configurado.</p></div>';
  }
}

// ============================
// Transactions Page
// ============================
function renderTransactions() {
  const tbody = document.querySelector('#transactions-table tbody');
  if (!tbody) return;

  // Populate filter dropdowns dynamically
  populateTransactionFilters();

  let filtered = [...state.transactions];

  // Text search filter
  if (state.txSearchQuery) {
    const q = state.txSearchQuery.toLowerCase();
    filtered = filtered.filter(t => (t.description || '').toLowerCase().includes(q));
  }

  // Category filter
  const catFilter = document.getElementById('tx-filter-category')?.value;
  if (catFilter) {
    filtered = filtered.filter(t => t.category === catFilter);
  }

  // Account filter
  const accFilter = document.getElementById('tx-filter-account')?.value;
  if (accFilter) {
    filtered = filtered.filter(t => t.accountId === accFilter);
  }

  // Who filter
  const whoFilter = document.getElementById('tx-filter-who')?.value;
  if (whoFilter) {
    filtered = filtered.filter(t => t.createdBy === whoFilter);
  }

  // Future transactions filter
  if (!state.txShowFuture) {
    const now = new Date();
    // Last day of current month
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    filtered = filtered.filter(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return d <= lastDayOfMonth;
    });
  }

  const sorted = filtered.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));

  if (sorted.length === 0) {
    if (state.txSearchQuery) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px;">Nenhuma transação encontrada com o termo pesquisado</td></tr>';
    } else {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px;">Nenhuma transação ainda</td></tr>';
    }
    updatePaginationUI(0);
    updateSearchSummary(0, 0);
    return;
  }

  // Handle Search Summary
  const totalFilteredCount = filtered.length;
  const totalFilteredAmount = filtered.reduce((acc, t) => {
    return t.type === 'receita' ? acc + t.amount : acc - t.amount;
  }, 0);
  updateSearchSummary(totalFilteredCount, totalFilteredAmount);

  // Handle Pagination
  const totalItems = sorted.length;
  const rowsPerPage = state.txPagination.rowsPerPage === 'all' ? totalItems : parseInt(state.txPagination.rowsPerPage);
  const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));

  // Ensure current page is within bounds
  if (state.txPagination.currentPage > totalPages) state.txPagination.currentPage = totalPages;
  if (state.txPagination.currentPage < 1) state.txPagination.currentPage = 1;

  const start = (state.txPagination.currentPage - 1) * rowsPerPage;
  const end = state.txPagination.rowsPerPage === 'all' ? totalItems : start + rowsPerPage;
  const paginated = sorted.slice(start, end);

  tbody.innerHTML = paginated.map(t => {
    const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    const acc = state.accounts.find(a => a.id === t.accountId);
    const installBadge = t.installmentInfo
      ? `<span class="installment-badge" title="Parcela ${t.installmentInfo.current}/${t.installmentInfo.total}">💳 ${t.installmentInfo.current}/${t.installmentInfo.total}</span>`
      : '';
    const fixedBillBadge = t.fixedBillId
      ? `<span class="fixed-bill-badge" title="Conta Fixa"><i class="fas fa-calendar-check"></i></span>`
      : '';

    let methodBadge = '';
    if (t.paymentMethod && t.paymentMethod !== 'outros') {
      const methodLabels = { pix: 'PIX', credito: 'Crédito', debito: 'Débito', transferencia: 'TED/DOC' };
      methodBadge = `<span class="payment-method-badge ${t.paymentMethod}" style="margin-left:6px;font-size:0.65rem;">${methodLabels[t.paymentMethod] || t.paymentMethod}</span>`;
    }

    const profile = state.familyProfiles?.[t.createdBy];
    const who = profile?.name ? profile.name.split(' ')[0] : (t.createdByName || '?').split(' ')[0];
    return `
        <tr data-tx-id="${t.id}">
          <td>${d.toLocaleDateString('pt-BR')}</td>
          <td class="editable-cell" data-field="description" data-tx-id="${t.id}">${t.description}${installBadge}${fixedBillBadge}${methodBadge}</td>
        <td class="editable-cell" data-field="category" data-tx-id="${t.id}">${t.category}</td>
        <td class="editable-cell" data-field="account" data-tx-id="${t.id}">${acc?.name || '-'}</td>
        <td title="${t.createdByName || ''}">${who}</td>
        <td class="editable-cell ${t.type}" data-field="amount" data-tx-id="${t.id}">${formatCurrency(t.amount)}</td>
        <td>
          <button class="btn-icon" onclick="editTransaction('${t.id}')" title="Editar"><i class="fas fa-pencil-alt"></i></button>
          <button class="btn-icon" onclick="removeTransaction('${t.id}')" title="Excluir"><i class="fas fa-trash-alt"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  updatePaginationUI(totalItems);

  // Attach inline editing events
  initInlineEditing();
}

function populateTransactionFilters() {
  // Category dropdown
  const catSelect = document.getElementById('tx-filter-category');
  if (catSelect) {
    const currentCat = catSelect.value;
    const categories = [...new Set(state.transactions.map(t => t.category).filter(Boolean))].sort();
    catSelect.innerHTML = '<option value="">Todas as categorias</option>' +
      categories.map(c => `<option value="${c}" ${c === currentCat ? 'selected' : ''}>${c}</option>`).join('');
  }

  // Account dropdown
  const accSelect = document.getElementById('tx-filter-account');
  if (accSelect) {
    const currentAcc = accSelect.value;
    accSelect.innerHTML = '<option value="">Todas as contas</option>' +
      state.accounts.map(a => `<option value="${a.id}" ${a.id === currentAcc ? 'selected' : ''}>${a.name}</option>`).join('');
  }

  // Who dropdown
  const whoSelect = document.getElementById('tx-filter-who');
  if (whoSelect) {
    const currentWho = whoSelect.value;
    const members = state.familyProfiles ? Object.entries(state.familyProfiles) : [];
    whoSelect.innerHTML = '<option value="">Todos os membros</option>' +
      members.map(([uid, prof]) => `<option value="${uid}" ${uid === currentWho ? 'selected' : ''}>${prof.name}</option>`).join('');
  }
}

function updatePaginationUI(totalItems) {
  const rowsPerPage = state.txPagination.rowsPerPage === 'all' ? totalItems : parseInt(state.txPagination.rowsPerPage);
  const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));
  const currentPage = state.txPagination.currentPage;

  const infoEl = document.getElementById('tx-pagination-info');
  if (infoEl) {
    if (state.txPagination.rowsPerPage === 'all') {
      infoEl.textContent = `Mostrando todas as ${totalItems} transações`;
    } else {
      const startRange = totalItems === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
      const endRange = Math.min(currentPage * rowsPerPage, totalItems);
      infoEl.textContent = `Mostrando ${startRange}-${endRange} de ${totalItems} (Página ${currentPage} de ${totalPages})`;
    }
  }

  const prevBtn = document.getElementById('tx-prev-page');
  const nextBtn = document.getElementById('tx-next-page');

  if (prevBtn) prevBtn.disabled = currentPage <= 1 || state.txPagination.rowsPerPage === 'all';
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages || state.txPagination.rowsPerPage === 'all';
}

function updateSearchSummary(count, total) {
  const summaryBar = document.getElementById('tx-summary-bar');
  if (!summaryBar) return;

  if (state.txSearchQuery) {
    summaryBar.classList.remove('hidden');
    const countEl = document.getElementById('tx-summary-count');
    const totalEl = document.getElementById('tx-summary-total');

    if (countEl) countEl.textContent = count;
    if (totalEl) {
      totalEl.textContent = formatCurrency(total);
      totalEl.className = 'summary-value ' + (total >= 0 ? 'income' : 'expense');
    }
  } else {
    summaryBar.classList.add('hidden');
  }
}

// ============================
// Inline Editing (Excel-style)
// ============================
let _inlineEditingActive = false;
let _longPressTimer = null;

function initInlineEditing() {
  const cells = document.querySelectorAll('#transactions-table td.editable-cell');

  cells.forEach(cell => {
    // Double-click for desktop
    cell.addEventListener('dblclick', (e) => {
      e.preventDefault();
      startInlineEdit(cell);
    });

    // Long-press for mobile
    cell.addEventListener('touchstart', (e) => {
      _longPressTimer = setTimeout(() => {
        e.preventDefault();
        startInlineEdit(cell);
      }, 500);
    }, { passive: false });

    cell.addEventListener('touchend', () => {
      clearTimeout(_longPressTimer);
    });

    cell.addEventListener('touchmove', () => {
      clearTimeout(_longPressTimer);
    });
  });
}

function startInlineEdit(cell) {
  if (_inlineEditingActive) return;
  _inlineEditingActive = true;

  const field = cell.dataset.field;
  const txId = cell.dataset.txId;
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) { _inlineEditingActive = false; return; }

  const originalContent = cell.innerHTML;
  cell.classList.add('inline-editing');

  if (field === 'account') {
    // Show a select for accounts
    const select = document.createElement('select');
    select.className = 'inline-edit-select';
    state.accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = acc.name;
      if (acc.id === tx.accountId) opt.selected = true;
      select.appendChild(opt);
    });

    cell.innerHTML = '';
    cell.appendChild(select);
    select.focus();

    select.addEventListener('change', () => {
      saveInlineEdit(txId, field, select.value, cell, originalContent);
    });
    select.addEventListener('blur', () => {
      // Small delay to allow change event to fire first
      setTimeout(() => {
        if (_inlineEditingActive) cancelInlineEdit(cell, originalContent);
      }, 150);
    });
    select.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelInlineEdit(cell, originalContent);
    });
  } else if (field === 'category') {
    // Input with datalist for categories
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit-input';
    input.value = tx.category || '';
    input.setAttribute('list', 'category-suggestions');

    // Make sure datalist is populated
    populateCategoryDatalist();

    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const save = () => saveInlineEdit(txId, field, input.value.trim(), cell, originalContent);
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') cancelInlineEdit(cell, originalContent);
    });
  } else {
    // Text input for description and amount
    const input = document.createElement('input');
    input.className = 'inline-edit-input';

    if (field === 'amount') {
      input.type = 'number';
      input.step = '0.01';
      input.min = '0.01';
      input.value = tx.amount;
    } else {
      input.type = 'text';
      input.value = tx.description || '';
    }

    cell.innerHTML = '';
    cell.appendChild(input);

    // Add hint
    const hint = document.createElement('span');
    hint.className = 'inline-edit-hint';
    hint.textContent = 'Enter salva • Esc cancela';
    cell.appendChild(hint);

    input.focus();
    input.select();

    const save = () => {
      const val = field === 'amount' ? parseFloat(input.value) : input.value.trim();
      saveInlineEdit(txId, field, val, cell, originalContent);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') cancelInlineEdit(cell, originalContent);
    });
  }
}

async function saveInlineEdit(txId, field, newValue, cell, originalContent) {
  if (!_inlineEditingActive) return;
  _inlineEditingActive = false;

  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) { cancelInlineEdit(cell, originalContent); return; }

  // Validate
  if (field === 'amount' && (isNaN(newValue) || newValue <= 0)) {
    cancelInlineEdit(cell, originalContent);
    showToast('Valor inválido', 'O valor deve ser maior que zero', 'warning');
    return;
  }
  if ((field === 'description' || field === 'category') && !newValue) {
    cancelInlineEdit(cell, originalContent);
    return;
  }

  // Check if value actually changed
  const oldValue = field === 'account' ? tx.accountId : tx[field];
  if (field === 'amount' && newValue === tx.amount) { cancelInlineEdit(cell, originalContent); return; }
  if (field !== 'amount' && newValue === oldValue) { cancelInlineEdit(cell, originalContent); return; }

  // Build updated data
  const updateData = { ...tx };
  if (field === 'description') updateData.description = newValue;
  else if (field === 'category') updateData.category = newValue;
  else if (field === 'account') updateData.accountId = newValue;
  else if (field === 'amount') updateData.amount = newValue;

  try {
    await saveTransaction(updateData, txId);
    showToast('Atualizado!', `${field === 'description' ? 'Descrição' : field === 'category' ? 'Categoria' : field === 'account' ? 'Conta' : 'Valor'} alterado(a)`, 'success');
    await loadAllData();
  } catch (err) {
    console.error('Inline edit error:', err);
    cancelInlineEdit(cell, originalContent);
    showToast('Erro', 'Não foi possível salvar', 'error');
  }
}

function cancelInlineEdit(cell, originalContent) {
  _inlineEditingActive = false;
  cell.classList.remove('inline-editing');
  cell.innerHTML = originalContent;
}

// ============================
// Accounts Page
// ============================

// Bank logo detection based on account name keywords
const BANK_LOGOS = [
  { keywords: ['nubank', 'nu '], logo: 'https://logo.clearbit.com/nubank.com.br', color: '#820AD1' },
  { keywords: ['inter', 'banco inter'], logo: 'https://logo.clearbit.com/bancointer.com.br', color: '#FF7A00' },
  { keywords: ['bradesco'], logo: 'https://logo.clearbit.com/bradesco.com.br', color: '#CC092F' },
  { keywords: ['itau', 'itaú'], logo: 'https://logo.clearbit.com/itau.com.br', color: '#003399' },
  { keywords: ['caixa', 'cef'], logo: 'https://logo.clearbit.com/caixa.gov.br', color: '#005CA9' },
  { keywords: ['banco do brasil', ' bb', 'bb '], logo: 'https://logo.clearbit.com/bb.com.br', color: '#FECE00' },
  { keywords: ['santander'], logo: 'https://logo.clearbit.com/santander.com.br', color: '#EC0000' },
  { keywords: ['c6', 'c6 bank'], logo: 'https://logo.clearbit.com/c6bank.com.br', color: '#242424' },
  { keywords: ['pagbank', 'pagseguro'], logo: 'https://logo.clearbit.com/pagbank.com.br', color: '#00A651' },
  { keywords: ['mercado pago', 'mercadopago'], logo: 'https://logo.clearbit.com/mercadopago.com.br', color: '#009EE3' },
  { keywords: ['neon'], logo: 'https://logo.clearbit.com/neon.com.br', color: '#0DC5FF' },
  { keywords: ['next'], logo: 'https://logo.clearbit.com/next.me', color: '#00E68A' },
  { keywords: ['btg'], logo: 'https://logo.clearbit.com/btgpactual.com', color: '#1A2537' },
  { keywords: ['xp'], logo: 'https://logo.clearbit.com/xpi.com.br', color: '#000000' },
  { keywords: ['rico'], logo: 'https://logo.clearbit.com/rico.com.vc', color: '#FF5500' },
  { keywords: ['sicoob'], logo: 'https://logo.clearbit.com/sicoob.com.br', color: '#003641' },
  { keywords: ['sicredi'], logo: 'https://logo.clearbit.com/sicredi.com.br', color: '#006633' },
  { keywords: ['original'], logo: 'https://logo.clearbit.com/original.com.br', color: '#00A651' },
  { keywords: ['safra'], logo: 'https://logo.clearbit.com/safra.com.br', color: '#002D62' },
  { keywords: ['picpay'], logo: 'https://logo.clearbit.com/picpay.com', color: '#21C25E' },
  { keywords: ['will', 'willbank'], logo: 'https://logo.clearbit.com/willbank.com.br', color: '#FF2D78' },
  { keywords: ['stone'], logo: 'https://logo.clearbit.com/stone.com.br', color: '#00A868' },
  { keywords: ['iti'], logo: 'https://logo.clearbit.com/iti.itau', color: '#FF6600' },
  { keywords: ['binance'], logo: 'https://logo.clearbit.com/binance.com', color: '#F0B90B' },
  { keywords: ['wise'], logo: 'https://logo.clearbit.com/wise.com', color: '#9FE870' },
  { keywords: ['paypal'], logo: 'https://logo.clearbit.com/paypal.com', color: '#003087' },
  { keywords: ['modal'], logo: 'https://logo.clearbit.com/modalmais.com.br', color: '#FF6B00' },
  { keywords: ['daycoval'], logo: 'https://logo.clearbit.com/daycoval.com.br', color: '#004B87' },
  { keywords: ['pan'], logo: 'https://logo.clearbit.com/bancopan.com.br', color: '#0066CC' },
  { keywords: ['bmg'], logo: 'https://logo.clearbit.com/bancobmg.com.br', color: '#F47920' },
  { keywords: ['sofisa'], logo: 'https://logo.clearbit.com/sofisadireto.com.br', color: '#1E3A5F' },
];

function getBankLogo(accountName) {
  const nameLower = ` ${(accountName || '').toLowerCase()} `;
  for (const bank of BANK_LOGOS) {
    for (const kw of bank.keywords) {
      if (nameLower.includes(kw.toLowerCase())) {
        return bank;
      }
    }
  }
  return null;
}

function renderAccounts() {
  const summaryContainer = document.getElementById('accounts-summary');
  const groupedContainer = document.getElementById('accounts-grouped-list');
  if (!summaryContainer || !groupedContainer) return;

  if (state.accounts.length === 0) {
    summaryContainer.innerHTML = '';
    groupedContainer.innerHTML = '<div class="empty-state"><i class="fas fa-wallet"></i><p>Nenhuma conta cadastrada</p></div>';
    return;
  }

  // Calculate totals by type
  const typeMap = {};
  let grandTotal = 0;
  let totalAvailableCredit = 0;

  state.accounts.forEach(acc => {
    // Para cartões, o "Saldo" que compõe o patrimônio líquido imediato é a Fatura Atual
    // Mas o saldo da conta em si (currentBalance) é a dívida total.
    const balanceToSum = acc.type === 'cartao_credito' ? (acc.currentInvoice || 0) : (acc.currentBalance || 0);
    grandTotal += balanceToSum;
    
    if (acc.type === 'cartao_credito') {
      const limit = acc.creditLimit || 0;
      const used = Math.abs(acc.currentBalance || 0); // dívida total consumindo limite
      totalAvailableCredit += Math.max(0, limit - used);
    }
    
    if (!typeMap[acc.type]) typeMap[acc.type] = { balance: 0, accounts: [] };
    typeMap[acc.type].balance += balanceToSum;
    typeMap[acc.type].accounts.push(acc);
  });

  const typeConfig = {
    conta_corrente: { label: 'Conta Corrente', icon: 'fas fa-university', cssClass: 'corrente' },
    poupanca: { label: 'Poupança', icon: 'fas fa-piggy-bank', cssClass: 'poupanca' },
    investimento: { label: 'Investimento', icon: 'fas fa-chart-line', cssClass: 'investimento' },
    cartao_credito: { label: 'Faturas (Cartão)', icon: 'fas fa-file-invoice-dollar', cssClass: 'carteira' },
    carteira: { label: 'Carteira', icon: 'fas fa-money-bill-wave', cssClass: 'carteira' }
  };

  // Render summary cards
  summaryContainer.innerHTML = `
    <div class="acc-summary-card">
      <div class="acc-icon total"><i class="fas fa-balance-scale"></i></div>
      <div class="acc-summary-content">
        <span class="acc-summary-label">Patrimônio Total</span>
        <span class="acc-summary-value ${grandTotal >= 0 ? '' : 'text-expense'}">${formatCurrency(grandTotal)}</span>
      </div>
    </div>
    ${Object.entries(typeMap).map(([type, data]) => {
    const cfg = typeConfig[type] || { label: type, icon: 'fas fa-wallet', cssClass: 'total' };
    
    let extraCard = '';
    if (type === 'cartao_credito') {
      extraCard = `
      <div class="acc-summary-card" style="border-bottom: 4px solid var(--primary-color);">
        <div class="acc-icon" style="background:rgba(99,102,241,0.2);color:var(--primary-color);">
          <i class="fas fa-credit-card"></i>
        </div>
        <div class="acc-summary-content">
          <span class="acc-summary-label">Crédito Disponível</span>
          <span class="acc-summary-value text-income" style="color:var(--primary-color)!important;">${formatCurrency(totalAvailableCredit)}</span>
        </div>
      </div>`;
    }

    return `
      ${extraCard}
      <div class="acc-summary-card">
        <div class="acc-icon ${cfg.cssClass}"><i class="${cfg.icon}"></i></div>
        <div class="acc-summary-content">
          <span class="acc-summary-label">${cfg.label}</span>
          <span class="acc-summary-value ${data.balance >= 0 ? '' : 'text-expense'}">${formatCurrency(data.balance)}</span>
        </div>
      </div>`;
  }).join('')}
  `;

  // Render grouped accounts
  groupedContainer.innerHTML = Object.entries(typeMap).map(([type, data]) => {
    const cfg = typeConfig[type] || { label: type, icon: 'fas fa-wallet', cssClass: 'total' };
    return `
      <div class="account-group">
        <div class="account-group-header">
          <i class="${cfg.icon}"></i>
          <h3>${cfg.label}</h3>
          <span class="group-count">${data.accounts.length}</span>
          <span class="group-total ${data.balance >= 0 ? 'text-income' : 'text-expense'}">${formatCurrency(data.balance)}</span>
        </div>
        ${data.accounts.map(acc => {
      // Calculate per-account stats
      const accTxs = state.transactions.filter(t => t.accountId === acc.id);
      const totalIn = accTxs.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
      const totalOut = accTxs.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);
      const txCount = accTxs.length;
      const balance = acc.currentBalance || 0;

      let statsHtml = '';
      if (acc.type === 'cartao_credito') {
        const limit = acc.creditLimit || 0;
        const totalDebt = acc.currentBalance || 0;
        const invoiceBalance = acc._closedDebt || 0; // Fatura fechada (atrasada)
        const openCycle = acc._openDebt || 0; // Fatura aberta (atual)
        const futureDebt = acc._futureDebt || 0; // Parcelas futuras

        const usedForLimit = Math.abs(totalDebt);
        const available = Math.max(0, limit - usedForLimit);
        const pct = limit > 0 ? Math.min((usedForLimit / limit) * 100, 100) : 0;
        const barColor = pct > 90 ? 'var(--expense-color)' : pct > 70 ? 'var(--warning-color)' : 'var(--primary-500)';

        // Info do ciclo de faturamento
        const prevStartStr = acc._prevCycleStart ? acc._prevCycleStart.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'}) : '?';
        const prevEndStr = acc._prevCycleEnd ? acc._prevCycleEnd.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'}) : '?';
        const currStartStr = acc._currentCycleStart ? acc._currentCycleStart.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'}) : '?';
        const currEndStr = acc._currentCycleEnd ? acc._currentCycleEnd.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'}) : '?';

        statsHtml = `
              <div class="acc-stats" style="flex-direction:column;align-items:stretch;background:transparent;padding:0;">
                <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:8px;">
                  <span style="color:var(--text-secondary);">Disponível: <strong style="color:var(--income-color);font-size:1rem;">${formatCurrency(available)}</strong></span>
                  <span style="color:var(--text-secondary);font-size:0.75rem;">Limite: ${formatCurrency(limit)}</span>
                </div>
                <div class="progress-bar" style="background:var(--bg-tertiary); height:8px; border-radius:4px; margin:0;">
                  <div style="width:${pct}%; background:${barColor}; height:100%; border-radius:4px; transition: width 0.3s;"></div>
                </div>
                <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;font-size:0.75rem;margin-top:10px;color:var(--text-secondary);gap:4px;">
                  ${Math.abs(invoiceBalance) > 0.01 ? `<span>📄 Fechada/Atrasada (${prevStartStr} — ${prevEndStr}): <strong style="color:var(--expense-color);">${formatCurrency(Math.abs(invoiceBalance))}</strong></span>` : ''}
                  ${Math.abs(openCycle) > 0.01 ? `<span>🔄 Atual/Aberta (${currStartStr} — ${currEndStr}): <strong style="color:var(--warning-color);">${formatCurrency(Math.abs(openCycle))}</strong></span>` : ''}
                  ${Math.abs(futureDebt) > 0.01 ? `<span>📅 Futuras: <strong style="color:var(--text-secondary);">${formatCurrency(Math.abs(futureDebt))}</strong></span>` : ''}
                </div>
                <div style="margin-top:10px; display:flex; justify-content:flex-end; gap:6px; flex-wrap:wrap;">
                  <button class="btn btn-sm btn-primary" onclick="showInvoiceModal('${acc.id}')" title="Ver Detalhes da Fatura" style="font-size:0.65rem; padding:4px 8px; border:none; border-radius:6px; cursor:pointer;">
                    <i class="fas fa-list-alt"></i> Ver Faturas
                  </button>
                  <button class="btn btn-sm" onclick="payCurrentInvoice('${acc.id}')" title="Marcar fatura fechada como paga" style="font-size:0.65rem; padding:4px 10px; background:var(--income-color); color:#fff; border:none; border-radius:6px; cursor:pointer;">
                    <i class="fas fa-check-circle"></i> Pagar Fatura
                  </button>
                  <button class="btn btn-sm btn-secondary" onclick="cleanCreditCardDuplicates('${acc.id}')" title="Limpar duplicatas" style="font-size:0.65rem; padding:4px 8px;">
                    <i class="fas fa-broom"></i> Duplicatas
                  </button>
                </div>
              </div>
            `;
      } else {
        statsHtml = `
              <div class="acc-stats">
                <span class="acc-stat in"><i class="fas fa-arrow-up"></i> ${formatCurrency(totalIn)}</span>
                <span class="acc-stat out"><i class="fas fa-arrow-down"></i> ${formatCurrency(totalOut)}</span>
                <span class="acc-stat"><i class="fas fa-receipt"></i> ${txCount} transações</span>
              </div>
            `;
      }

      const bankInfo = getBankLogo(acc.name);
      const logoHtml = bankInfo
        ? `<img src="${bankInfo.logo}" alt="" class="bank-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
           <div class="bank-logo-fallback" style="display:none;background:${bankInfo.color}"><i class="fas fa-university"></i></div>`
        : `<div class="bank-logo-fallback" style="background:var(--primary-500,#6366f1)"><i class="fas fa-wallet"></i></div>`;

      return `
          <div class="account-card-enhanced">
            <div class="acc-main">
              <div class="acc-logo-name">
                ${logoHtml}
                <div class="acc-name-area">
                  <span class="acc-name">${acc.name}</span>
                  ${acc.ownerTag ? `<span class="badge" style="font-size:0.6rem;background:var(--primary-color);color:#fff;margin-left:8px;"><i class="fas fa-tag"></i> ${acc.ownerTag}</span>` : ''}
                  ${acc.type === 'cartao_credito' && acc.closingDay ? `<span class="badge" style="font-size:0.6rem;background:var(--bg-tertiary);margin-left:8px;">Fecha dia ${acc.closingDay}</span>` : ''}
                  ${acc.initialAdjustment ? `<i class="fas fa-magic" title="Possui ajuste manual de ${formatCurrency(acc.initialAdjustment)}" style="font-size:0.7rem;margin-left:4px;color:var(--primary-color);"></i>` : ''}
                </div>
              </div>
              <div class="acc-actions-area">
                <span class="acc-balance ${balance >= 0 ? 'text-income' : 'text-expense'}">${formatCurrency(balance)}</span>
                <div class="account-card-actions">
                  <button class="btn-icon" onclick="editAccount('${acc.id}')" title="Editar"><i class="fas fa-pencil-alt"></i></button>
                  <button class="btn-icon" onclick="removeAccount('${acc.id}')" title="Excluir"><i class="fas fa-trash-alt"></i></button>
                </div>
              </div>
            </div>
            ${statsHtml}
          </div>`;
    }).join('')}
      </div>`;
  }).join('');
}

// Cleanup function for credit card duplicates
window.cleanCreditCardDuplicates = async function(accountId) {
  let accName = "Todas as Contas";
  let accTxs = [...state.transactions];

  if (accountId) {
    const acc = state.accounts.find(a => a.id === accountId);
    if (!acc) return;
    accName = acc.name;
    accTxs = accTxs.filter(t => t.accountId === accountId);
  }

  const msg = accountId ? `Deseja analisar possíveis duplicatas para a conta "${accName}"?` : `Deseja analisar possíveis duplicatas em TODAS as suas contas?`;
  if (!confirm(msg)) return;

  accTxs.sort((a,b) => {
    const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
    const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
    return da - db;
  });

  const groups = [];
  const used = new Set();

  for (let i = 0; i < accTxs.length; i++) {
    if (used.has(i)) continue;
    const t1 = accTxs[i];
    const d1 = t1.date?.toDate ? t1.date.toDate() : new Date(t1.date);
    const amount1 = Math.round(t1.amount * 100);

    const matchGroup = [t1];
    
    for (let j = i + 1; j < accTxs.length; j++) {
      if (used.has(j)) continue;
      const t2 = accTxs[j];
      const d2 = t2.date?.toDate ? t2.date.toDate() : new Date(t2.date);
      const amount2 = Math.round(t2.amount * 100);
      
      const diffDays = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
      
      if (amount1 === amount2 && t1.type === t2.type && t1.accountId === t2.accountId) {
         const desc1 = (t1.description || t1.category || '').toLowerCase();
         const desc2 = (t2.description || t2.category || '').toLowerCase();
         
         // 0. Proteção absoluta contra parcelas distintas marcadas erroneamente
         const instRegex = /\b(\d+)\/(\d+)\b/;
         const instMatch1 = desc1.match(instRegex);
         const instMatch2 = desc2.match(instRegex);
         
         if (instMatch1 && instMatch2) {
             // Se ambos possuem assinatura de parcela (ex: 1/4 e 2/4), a parcela atual TEM que ser a mesma
             if (instMatch1[1] !== instMatch2[1] || instMatch1[2] !== instMatch2[2]) {
                 continue; // São parcelas diferentes na sequência, NUNCA são duplicatas
             }
         }

         // 1. Se ambas são de OFX e possuem IDs diferentes originais do banco, NUNCA são duplicatas
         if (t1.fitid && t2.fitid && t1.fitid !== t2.fitid) {
             continue;
         }

         // 2. Se possuírem o mesmíssimo ID de OFX (erro de gravação dupla banco de dados)
         if (t1.fitid && t2.fitid && t1.fitid === t2.fitid) {
             // Bancos como Nubank usam o mesmo FITID para diferentes parcelas em meses diferentes!
             // Só é duplicata se ocorrer no mesmo dia ou quase mesmo dia, e como protegemos parcelas no passo 0, é blindado.
             if (diffDays <= 2) {
                 matchGroup.push(t2);
                 used.add(j);
             }
             continue;
         }

         const len = Math.min(4, desc1.length, desc2.length);
         const prefixMatch = len > 0 && desc1.substring(0, len) === desc2.substring(0, len);
         const isInst = desc1.includes('/') || desc2.includes('/') || t1.installmentInfo || t2.installmentInfo;
         
         // Verifica se uma tem procedência OFX (fitid) e a outra é manual (sem fitid)
         const oneIsOfx = (t1.fitid || t2.fitid) && (!t1.fitid || !t2.fitid);

         // 3. Casamento de OFX com Manual (tolerância de até 7 dias, mas exige prefixo igual ou ser parcela)
         if (oneIsOfx && diffDays <= 7 && (prefixMatch || isInst)) {
             matchGroup.push(t2);
             used.add(j);
             continue;
         }

         // 4. Ambas manuais (ou origens antigas sem fitid): exige mesmo dia e descrição similar
         if (!oneIsOfx && diffDays === 0 && prefixMatch) {
             matchGroup.push(t2);
             used.add(j);
             continue;
         }
      }
    }
    
    if (matchGroup.length > 1) {
       groups.push(matchGroup);
    }
  }

  if (groups.length === 0) {
    showToast('Limpeza concluída', 'Nenhuma possível duplicata encontrada.', 'info');
    return;
  }

  // Montar HTML do Modal
  let modalHtml = `
  <div id="duplicates-modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div style="background:var(--bg-secondary,#1e1e2e);border-radius:16px;width:100%;max-width:700px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.5);">
      <div style="padding:20px;border-bottom:1px solid var(--border-color,rgba(255,255,255,0.1));display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;font-size:1.3rem;"><i class="fas fa-copy" style="color:var(--primary-color);"></i> Analisar Duplicatas</h2>
        <button onclick="document.getElementById('duplicates-modal-overlay').remove()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;font-size:1.2rem;"><i class="fas fa-times"></i></button>
      </div>
      <div style="padding:20px;overflow-y:auto;flex:1;">
        <p style="color:var(--text-secondary);margin-bottom:20px;">Estes agrupamentos possuem o mesmo valor e datas próximas. <strong>Selecione os que deseja EXCLUIR.</strong></p>
  `;

  groups.forEach((g, idx) => {
    // Ordena: Preserva elementos com FITID (importados) e mais antigas na garantia
    g.sort((a,b) => {
      if (a.fitid && !b.fitid) return -1;
      if (!a.fitid && b.fitid) return 1;
      const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
      const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
      return da - db;
    });

    modalHtml += `
      <div style="background:var(--bg-tertiary,rgba(255,255,255,0.03));border:1px solid var(--border-color,rgba(255,255,255,0.1));border-radius:12px;margin-bottom:16px;overflow:hidden;">
        <div style="background:rgba(0,0,0,0.2);padding:10px 15px;font-weight:bold;font-size:0.9rem;border-bottom:1px solid var(--border-color,rgba(255,255,255,0.1));display:flex;justify-content:space-between;">
          <span>Grupo ${idx + 1} — R$ ${formatCurrency(g[0].amount)}</span>
          <span style="color:var(--text-secondary);font-size:0.8rem;">${g.length} itens</span>
        </div>
        <div style="padding:10px;">
    `;

    g.forEach((t, tIdx) => {
      const isChecked = tIdx > 0; // Marca todos pra exclusão, exceto o primeiro (melhor candidato a manter)
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      modalHtml += `
          <label style="display:flex;align-items:center;padding:8px;border-radius:8px;cursor:pointer;gap:12px;transition:background 0.2s;${isChecked ? 'background:rgba(239,68,68,0.1);' : ''}">
            <input type="checkbox" class="dup-checkbox" value="${t.id}" ${isChecked ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--expense-color);">
            <div style="flex:1;">
              <div style="font-weight:500;font-size:0.95rem;">${t.description || t.category}</div>
              <div style="font-size:0.8rem;color:var(--text-secondary);">
                ${d.toLocaleDateString('pt-BR')} • ${t.category} ${t.fitid ? ' <span style="color:var(--income-color);font-size:0.75rem;margin-left:6px;"><i class="fas fa-link"></i> Importado (OFX)</span>' : ''}
              </div>
            </div>
          </label>
      `;
    });

    modalHtml += `
        </div>
      </div>
    `;
  });

  modalHtml += `
      </div>
      <div style="padding:20px;border-top:1px solid var(--border-color,rgba(255,255,255,0.1));display:flex;justify-content:flex-end;gap:12px;">
        <button class="btn btn-secondary" onclick="document.getElementById('duplicates-modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" id="confirm-duplicates-btn" style="background:var(--expense-color);border-color:var(--expense-color);color:#fff;">
          <i class="fas fa-trash-alt"></i> Remover Selecionados
        </button>
      </div>
    </div>
  </div>
  `;

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = modalHtml;
  document.body.appendChild(tempDiv.firstElementChild);

  const overlay = document.getElementById('duplicates-modal-overlay');
  const checkboxes = overlay.querySelectorAll('.dup-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const label = e.target.closest('label');
      if (e.target.checked) {
        label.style.background = 'rgba(239,68,68,0.1)';
      } else {
        label.style.background = 'transparent';
      }
    });
  });

  document.getElementById('confirm-duplicates-btn').addEventListener('click', async () => {
    const toDeleteIds = Array.from(overlay.querySelectorAll('.dup-checkbox:checked')).map(cb => cb.value);
    
    if (toDeleteIds.length === 0) {
      overlay.remove();
      return;
    }

    const btn = document.getElementById('confirm-duplicates-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removendo...';

    try {
      let deletedCount = 0;
      for (const id of toDeleteIds) {
        await deleteTransaction(id);
        deletedCount++;
      }
      showToast('Sucesso!', `${deletedCount} transações removidas.`, 'success');
      overlay.remove();
      await loadAllData();
    } catch (err) {
      console.error('Duplicate removal error:', err);
      showToast('Erro', 'Não foi possível remover.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-trash-alt"></i> Remover Selecionados';
    }
  });
};

// ============================
// Budgets & Goals
// ============================
function renderBudgets() {
  const container = document.getElementById('budgets-list');
  if (!container) return;

  if (state.budgets.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-bullseye"></i><p>Nenhum orçamento definido para este mês</p></div>';
    return;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  container.innerHTML = state.budgets.map(b => {
    const spent = state.transactions
      .filter(t => t.type === 'despesa' && t.category.toLowerCase() === b.category.toLowerCase())
      .filter(t => { const d = t.date?.toDate ? t.date.toDate() : new Date(t.date); return d >= monthStart; })
      .reduce((s, t) => s + t.amount, 0);
    const pct = Math.min((spent / b.limit) * 100, 100);
    const remaining = b.limit - spent;
    const isOverBudget = remaining < 0;

    const barClass = pct > 90 ? 'danger' : pct > 70 ? 'warning' : '';

    return `
      <div class="budget-card">
        <h3>${b.category}</h3>
        <p>Gasto: ${formatCurrency(spent)} / Total: ${formatCurrency(b.limit)}</p>
        <div class="progress-bar"><div class="progress-fill ${barClass}" style="width:${pct}%"></div></div>
        <p class="budget-remaining ${isOverBudget ? 'text-expense' : 'text-income'}" style="margin-top: 8px; font-weight: 600; font-size: 0.85rem;">
            ${isOverBudget
        ? `<i class="fas fa-exclamation-triangle"></i> Ultrapassou em ${formatCurrency(Math.abs(remaining))}`
        : `<i class="fas fa-check-circle"></i> Restam ${formatCurrency(remaining)}`
      }
        </p>
        <div class="account-card-actions" style="margin-top:12px;">
          <button class="btn-icon" onclick="editBudget('${b.id}')" title="Editar"><i class="fas fa-pencil-alt"></i></button>
          <button class="btn-icon" onclick="removeBudget('${b.id}')" title="Excluir"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

function renderGoals() {
  const container = document.getElementById('goals-list');
  if (!container) return;

  if (state.goals.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-flag-checkered"></i><p>Nenhuma meta definida</p></div>';
    return;
  }

  container.innerHTML = state.goals.map(g => {
    const linkedAccount = g.linkedAccountId ? state.accounts.find(a => a.id === g.linkedAccountId) : null;
    const currentAmount = linkedAccount ? (linkedAccount.currentBalance || 0) : (g.current || 0);
    const pct = Math.min((currentAmount / g.target) * 100, 100);
    const isAchieved = currentAmount >= g.target;

    return `
      <div class="goal-card">
        <h3>${g.name} ${isAchieved ? '<i class="fas fa-check-circle" style="color:var(--income-color)"></i>' : ''}</h3>
        <p>Alcançado: ${formatCurrency(currentAmount)} / Meta: ${formatCurrency(g.target)}</p>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span style="font-size:0.85rem; font-weight:600; color:var(--primary-600);">${pct.toFixed(1)}% completo</span>
            ${linkedAccount ? `<span style="font-size:0.75rem; color:var(--text-secondary);"><i class="fas fa-link"></i> Conta: ${linkedAccount.name}</span>` : ''}
        </div>
        <div class="account-card-actions" style="margin-top:12px;">
          <button class="btn-icon" onclick="editGoal('${g.id}')" title="Editar"><i class="fas fa-pencil-alt"></i></button>
          <button class="btn-icon" onclick="removeGoal('${g.id}')" title="Excluir"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

// ============================
// Fixed Bills (Contas Fixas)
// ============================
function renderFixedBills() {
  const container = document.getElementById('fixed-bills-list');
  if (!container) return;

  if (state.fixedBills.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-check"></i><p>Nenhuma conta fixa cadastrada</p></div>';
    return;
  }

  container.innerHTML = state.fixedBills.map(b => {
    return `
      <div class="budget-card" style="margin-bottom:var(--space-sm);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h3 style="margin-bottom:4px;">${b.name}</h3>
            <p style="font-size:0.85rem;color:var(--text-secondary);">
              <i class="fas fa-money-bill-wave"></i> ${formatCurrency(b.amount)}
              &nbsp;•&nbsp; <i class="fas fa-calendar-day"></i> Dia ${b.dueDay} de cada mês
              ${b.category ? `&nbsp;•&nbsp; <i class="fas fa-tag"></i> ${b.category}` : ''}
            </p>
          </div>
          <div class="account-card-actions" style="margin:0;gap:4px;">
            <button class="btn btn-sm btn-primary" onclick="payFixedBill('${b.id}')" title="Registrar Pagamento" style="padding:6px 12px;font-size:0.75rem;">
              <i class="fas fa-check-circle"></i> Pagar
            </button>
            <button class="btn-icon" onclick="editFixedBill('${b.id}')" title="Editar"><i class="fas fa-pencil-alt"></i></button>
            <button class="btn-icon" onclick="removeFixedBill('${b.id}')" title="Excluir"><i class="fas fa-trash-alt"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================
// Payables (Contas a Pagar/Receber)
// ============================
window.switchPayableTab = function (tabId, btn) {
  document.querySelectorAll('.payables-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#payables-page .tab-content').forEach(tc => tc.classList.add('hidden'));
  document.getElementById(tabId + '-tab')?.classList.remove('hidden');
};

function renderPayables() {
  const overdueList = document.getElementById('payables-overdue-list');
  const todayList = document.getElementById('payables-today-list');
  const next7List = document.getElementById('payables-next7-list');
  const next30List = document.getElementById('payables-next30-list');

  if (!overdueList) return;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const todayTime = now.getTime();
  const next7Time = todayTime + (7 * 24 * 60 * 60 * 1000);
  const next30Time = todayTime + (30 * 24 * 60 * 60 * 1000);

  let pending = state.transactions.filter(t => !t.isPaid);
  if (state.filter === 'mine') pending = pending.filter(t => t.createdBy === state.user.uid);
  else if (state.filter === 'partner') pending = pending.filter(t => t.createdBy !== state.user.uid);

  // Sort by date ascending
  pending.sort((a, b) => {
    const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
    const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
    return da.getTime() - db.getTime();
  });

  const overdue = [];
  const today = [];
  const next7 = [];
  const next30 = [];

  const creditCardInvoices = [];
  
  const getCycleKey = (date) => {
    const m = date.toLocaleString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '');
    const y = date.getFullYear().toString().slice(2);
    return `${m} ${y}`;
  };

  pending.forEach(t => {
    const acc = state.accounts.find(a => a.id === t.accountId);
    if (acc && acc.type === 'cartao_credito') {
      return; // Ignora transações individuais de cartão
    }

    let d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    d.setHours(0, 0, 0, 0);
    const tTime = d.getTime();

    if (tTime < todayTime) overdue.push(t);
    else if (tTime === todayTime) today.push(t);
    else if (tTime <= next7Time) next7.push(t);
    else if (tTime <= next30Time) next30.push(t);
  });

  // Criar faturas a partir dos cálculos de saldo das contas
  state.accounts.filter(a => a.type === 'cartao_credito').forEach(acc => {
    const createVirtualInvoice = (debt, cycleEnd, isClosed) => {
      if (Math.abs(debt) < 0.01) return;
      
      const cycleKey = getCycleKey(cycleEnd);
      let dueDate = new Date(cycleEnd.getTime());
      dueDate.setDate(acc.dueDay || acc.closingDay);
      if ((acc.dueDay || acc.closingDay) < acc.closingDay) {
          dueDate.setMonth(dueDate.getMonth() + 1);
      }
      dueDate.setHours(0, 0, 0, 0);

      const inv = {
        _isCreditCardInvoice: true,
        accountId: acc.id,
        cycleKey: cycleKey,
        description: `Fatura ${acc.name} (${cycleKey})` + (isClosed ? ' - Fechada' : ''),
        category: acc.name,
        dueDate: dueDate,
        amount: Math.abs(debt),
        type: 'despesa',
        txCount: 'Várias'
      };
      
      const tTime = dueDate.getTime();
      if (tTime < todayTime) overdue.push(inv);
      else if (tTime === todayTime) today.push(inv);
      else if (tTime <= next7Time) next7.push(inv);
      else if (tTime <= next30Time) next30.push(inv);
    };

    if (acc._closedDebt) createVirtualInvoice(acc._closedDebt, acc._prevCycleEnd, true);
    if (acc._openDebt) createVirtualInvoice(acc._openDebt, acc._currentCycleEnd, false);
  });

  // Generate fixed bill reminders for current month
  const fixedBillReminders = generateFixedBillReminders(now, todayTime, next7Time, next30Time);

  // Merge reminders into the appropriate lists
  fixedBillReminders.overdue.forEach(r => overdue.push(r));
  fixedBillReminders.today.forEach(r => today.push(r));
  fixedBillReminders.next7.forEach(r => next7.push(r));
  fixedBillReminders.next30.forEach(r => next30.push(r));

  const renderList = (items, container) => {
    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:20px;font-size:0.85rem;"><p>Nenhuma transação neste período.</p></div>';
      return;
    }
    container.innerHTML = items.map(t => {
      if (t._isCreditCardInvoice) {
        const formattedDate = t.dueDate.toLocaleDateString('pt-BR');
        return `
        <div class="payable-item" style="cursor:pointer; transition:transform 0.2s;" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform='translateX(0)'" onclick="showInvoiceModal('${t.accountId}', '${t.cycleKey}')">
          <div class="tx-icon expense"><i class="fas fa-file-invoice-dollar"></i></div>
          <div class="tx-details" style="flex:1;">
            <div class="tx-desc" style="font-weight:600; color:var(--text-primary); display:flex; align-items:center;">
              ${t.description} 
              <span style="background:var(--primary-700,#7c3aed);color:#fff;padding:2px 6px;border-radius:4px;font-size:0.65rem;font-weight:bold;margin-left:8px;vertical-align:middle;"><i class="fas fa-credit-card" style="margin-right:2px;"></i>CARTÃO</span>
            </div>
            <div class="tx-meta" style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">
              <span><i class="fas fa-calendar-alt"></i> Vencimento: ${formattedDate}</span>
              <span style="margin-left:12px;"><i class="fas fa-receipt"></i> Múltiplas pendências</span>
            </div>
          </div>
          <div class="tx-amount expense" style="font-weight:bold; font-size:1.1rem; padding-right:16px;">- ${formatCurrency(t.amount)}</div>
          <div class="payable-actions" onclick="event.stopPropagation();" style="display:flex; align-items:center;">
             <button class="btn-pay" onclick="paySpecificInvoice('${t.accountId}', '${t.cycleKey}')" title="Marcar esta fatura como paga" style="padding:6px 12px; border-radius:8px; font-weight:600; font-size:0.8rem; background: rgba(0, 200, 83, 0.1); color: var(--income-color, #00C853); border: 1px solid rgba(0, 200, 83, 0.2); cursor:pointer;"><i class="fas fa-check-circle" style="margin-right:4px;"></i> Pagar Fatura</button>
          </div>
        </div>`;
      }

      const isReminder = t._isFixedBillReminder;
      const typeClass = t.type === 'receita' ? 'income' : 'expense';
      const icon = isReminder ? '<i class="fas fa-calendar-check"></i>' : (t.type === 'receita' ? '<i class="fas fa-arrow-down"></i>' : '<i class="fas fa-arrow-up"></i>');
      const sign = t.type === 'receita' ? '+' : '-';
      let formattedDate = isReminder ? t._dueDateStr : (t.date?.toDate ? t.date.toDate() : new Date(t.date)).toLocaleDateString('pt-BR');

      const category = t.category || 'Outros';
      const fixedBadge = isReminder ? '<span class="fixed-bill-badge"><i class="fas fa-redo"></i> Conta Fixa</span>' : '';

      const actionButtons = isReminder
        ? `<div class="payable-actions">
             <button class="btn-pay" onclick="payFixedBill('${t._fixedBillId}')" title="Registrar Pagamento"><i class="fas fa-check-circle"></i> Pagar</button>
           </div>`
        : `<div class="payable-actions">
             <button class="btn-pay" onclick="markAsPaid('${t.id}')" title="Marcar como Pago"><i class="fas fa-check-circle"></i> Pago</button>
             <button class="btn-edit-payable" onclick="editTransaction('${t.id}')" title="Editar (ajustar valor/juros)"><i class="fas fa-pencil-alt"></i> Editar</button>
           </div>`;

      return `
        <div class="payable-item">
          <div class="tx-icon ${isReminder ? '' : typeClass}" style="${isReminder ? 'color:var(--primary-600);' : ''}">${icon}</div>
          <div class="tx-details" style="flex:1;">
            <div class="tx-desc" style="font-weight:600;">${t.description || t.name} ${fixedBadge}</div>
            <div class="tx-meta" style="font-size:0.75rem; color:var(--text-secondary);">
              <span><i class="fas fa-calendar-alt"></i> ${formattedDate}</span>
              <span style="margin-left:8px;"><i class="fas fa-tag"></i> ${category}</span>
            </div>
          </div>
          <div class="tx-amount ${typeClass}" style="font-weight:bold;">${sign} ${formatCurrency(t.amount)}</div>
          ${actionButtons}
        </div>
      `;
    }).join('');
  };

  renderList(overdue, overdueList);
  renderList(today, todayList);
  renderList(next7, next7List);
  renderList(next30, next30List);
}

// Generate reminders for fixed bills that don't have a matching transaction this month
function generateFixedBillReminders(now, todayTime, next7Time, next30Time) {
  const result = { overdue: [], today: [], next7: [], next30: [] };
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  state.fixedBills.forEach(fb => {
    // Check if there's already a paid transaction matching this fixed bill this month
    const alreadyPaid = state.transactions.some(t => {
      if (t.fixedBillId === fb.id && t.isPaid) {
        const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        return td.getMonth() === currentMonth && td.getFullYear() === currentYear;
      }
      // Also match by name similarity
      if (t.isPaid && t.description && fb.name) {
        const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        if (td.getMonth() === currentMonth && td.getFullYear() === currentYear) {
          return t.description.toLowerCase().includes(fb.name.toLowerCase()) ||
            fb.name.toLowerCase().includes(t.description.toLowerCase());
        }
      }
      return false;
    });

    if (alreadyPaid) return;

    // Create the due date for this month
    const dueDay = Math.min(fb.dueDay, new Date(currentYear, currentMonth + 1, 0).getDate());
    const dueDate = new Date(currentYear, currentMonth, dueDay);
    dueDate.setHours(0, 0, 0, 0);
    const dueTime = dueDate.getTime();

    const reminder = {
      _isFixedBillReminder: true,
      _fixedBillId: fb.id,
      _dueDateStr: dueDate.toLocaleDateString('pt-BR'),
      name: fb.name,
      description: fb.name,
      amount: fb.amount,
      category: fb.category || 'Moradia',
      type: 'despesa'
    };

    if (dueTime < todayTime) result.overdue.push(reminder);
    else if (dueTime === todayTime) result.today.push(reminder);
    else if (dueTime <= next7Time) result.next7.push(reminder);
    else if (dueTime <= next30Time) result.next30.push(reminder);
  });

  return result;
}

// Mark a transaction as paid directly
window.markAsPaid = async (id) => {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;

  tx.isPaid = true;
  await saveTransaction({ ...tx, isPaid: true }, id);
  showToast('Pago!', `${tx.description} marcada como paga`, 'success');
  await loadAllData();
};

// ============================
// Reports
// ============================
function renderReports() {
  const ctx = document.getElementById('reports-chart');
  if (!ctx) return;

  const summaryBody = document.getElementById('summary-table-body');
  const incomeSummaryBody = document.getElementById('income-summary-table-body');

  if (state.charts.reports) state.charts.reports.destroy();
  if (state.charts.reportsIncome) state.charts.reportsIncome.destroy();

  // Populate year/month dropdowns
  populateReportFilters();

  // Get selected year/month
  const yearSelect = document.getElementById('report-year-filter');
  const monthSelect = document.getElementById('report-month-filter');
  const selectedYear = yearSelect ? yearSelect.value : new Date().getFullYear().toString();
  const selectedMonth = monthSelect ? monthSelect.value : 'all';

  // Filter all transactions (not just expenses)
  let allTxs = state.transactions.filter(t => t.category !== 'Transferência Interna');
  if (state.filter === 'mine') allTxs = allTxs.filter(t => t.createdBy === state.user.uid);
  else if (state.filter === 'partner') allTxs = allTxs.filter(t => t.createdBy !== state.user.uid);

  const periodTxs = allTxs.filter(t => {
    const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    const tYear = td.getFullYear();
    const tMonth = td.getMonth();

    const yearMatch = (selectedYear === 'all' || tYear === parseInt(selectedYear));
    const monthMatch = (selectedMonth === 'all' || tMonth === parseInt(selectedMonth));

    return yearMatch && monthMatch;
  });

  const periodExpenses = periodTxs.filter(t => t.type === 'despesa');
  const periodIncome = periodTxs.filter(t => t.type === 'receita');

  // Calculate totals
  let totalExpenses = 0;
  const expCatMap = {};
  periodExpenses.forEach(t => {
    const cat = t.category || 'Outros';
    expCatMap[cat] = (expCatMap[cat] || 0) + t.amount;
    totalExpenses += t.amount;
  });

  let totalIncome = 0;
  const incCatMap = {};
  periodIncome.forEach(t => {
    const cat = t.category || 'Outros';
    incCatMap[cat] = (incCatMap[cat] || 0) + t.amount;
    totalIncome += t.amount;
  });

  // Update summary cards
  const incomeEl = document.getElementById('report-total-income');
  const expenseEl = document.getElementById('report-total-expense');
  const balanceEl = document.getElementById('report-period-balance');
  const countEl = document.getElementById('report-tx-count');

  if (incomeEl) incomeEl.textContent = formatCurrency(totalIncome);
  if (expenseEl) expenseEl.textContent = formatCurrency(totalExpenses);
  if (balanceEl) {
    const balance = totalIncome - totalExpenses;
    balanceEl.textContent = formatCurrency(balance);
    balanceEl.style.color = balance >= 0 ? 'var(--income-color)' : 'var(--expense-color)';
  }
  if (countEl) countEl.textContent = periodTxs.length;

  // Render expense summary table
  if (summaryBody) {
    if (totalExpenses === 0) {
      summaryBody.innerHTML = `<tr><td colspan="3" style="padding:16px 0;text-align:center;color:var(--text-secondary);">Nenhuma despesa no período.</td></tr>`;
    } else {
      const sorted = Object.entries(expCatMap).sort((a, b) => b[1] - a[1]);
      summaryBody.innerHTML = sorted.map(([cat, amt]) => {
        const pct = ((amt / totalExpenses) * 100).toFixed(1);
        return `
          <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:12px 0;">${cat}</td>
            <td style="padding:12px 0;">${formatCurrency(amt)}</td>
            <td style="padding:12px 0;"><span style="background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;font-size:0.8rem;">${pct}%</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render income summary table
  if (incomeSummaryBody) {
    if (totalIncome === 0) {
      incomeSummaryBody.innerHTML = `<tr><td colspan="3" style="padding:16px 0;text-align:center;color:var(--text-secondary);">Nenhuma receita no período.</td></tr>`;
    } else {
      const sorted = Object.entries(incCatMap).sort((a, b) => b[1] - a[1]);
      incomeSummaryBody.innerHTML = sorted.map(([cat, amt]) => {
        const pct = ((amt / totalIncome) * 100).toFixed(1);
        return `
          <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:12px 0;">${cat}</td>
            <td style="padding:12px 0;color:var(--income-color);">${formatCurrency(amt)}</td>
            <td style="padding:12px 0;"><span style="background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;font-size:0.8rem;">${pct}%</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render expense doughnut chart
  if (totalExpenses > 0) {
    const labels = Object.keys(expCatMap);
    const data = Object.values(expCatMap);
    const colors = labels.map((_, i) => `hsl(${i * (360 / Math.max(labels.length, 1))}, 70%, 55%)`);

    state.charts.reports = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#fff' } }
        }
      }
    });
  }

  // Render income doughnut chart
  const incomeCtx = document.getElementById('reports-income-chart');
  if (incomeCtx && totalIncome > 0) {
    const labels = Object.keys(incCatMap);
    const data = Object.values(incCatMap);
    const colors = labels.map((_, i) => `hsl(${120 + i * (240 / Math.max(labels.length, 1))}, 65%, 50%)`);

    state.charts.reportsIncome = new Chart(incomeCtx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#fff' } }
        }
      }
    });
  }

  // Render Methods Summary
  const methodsContainer = document.getElementById('methods-summary-list');
  if (methodsContainer && totalExpenses > 0) {
    const methodsMap = {};
    periodExpenses.forEach(t => {
      const pm = t.paymentMethod || 'outros';
      methodsMap[pm] = (methodsMap[pm] || 0) + t.amount;
    });

    const methodLabels = { pix: 'PIX', credito: 'Crédito', debito: 'Débito', transferencia: 'TED/DOC', outros: 'Outros' };
    const methodColors = { pix: '#10b981', credito: '#8b5cf6', debito: '#f59e0b', transferencia: '#3b82f6', outros: '#6b7280' };
    const methodIcons = { pix: 'fa-qrcode', credito: 'fa-credit-card', debito: 'fa-wallet', transferencia: 'fa-exchange-alt', outros: 'fa-money-bill' };

    const sortedMethods = Object.entries(methodsMap).sort((a, b) => b[1] - a[1]);

    methodsContainer.innerHTML = sortedMethods.map(([method, amt]) => {
      const pct = (amt / totalExpenses * 100).toFixed(1);
      const color = methodColors[method] || '#6b7280';
      const label = methodLabels[method] || method;
      const icon = methodIcons[method] || 'fa-tag';

      return `
        <div style="background:var(--bg-tertiary);border-radius:var(--border-radius);padding:var(--space-md);display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:8px;">
              <i class="fas ${icon}" style="color:${color};font-size:1.1rem;"></i>
              <span style="font-weight:600;font-size:0.9rem;">${label}</span>
            </div>
            <span style="font-weight:bold;color:var(--expense-color);">- ${formatCurrency(amt)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-secondary);">
            <span>Fatia dos gastos</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-bar" style="background:var(--bg-secondary);height:6px;border-radius:3px;">
            <div style="width:${pct}%;background:${color};height:100%;border-radius:3px;"></div>
          </div>
        </div>
      `;
    }).join('');
  } else if (methodsContainer) {
    methodsContainer.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>Sem gastos no período.</p></div>';
  }

  renderCashflowProjection();
}

// Populate report year/month dropdowns from transaction data
function populateReportFilters() {
  const yearSelect = document.getElementById('report-year-filter');
  const monthSelect = document.getElementById('report-month-filter');
  if (!yearSelect || !monthSelect) return;

  // Gather years from transactions (excluding future years)
  const years = new Set();
  const now = new Date();
  const currYear = now.getFullYear();
  years.add(currYear);

  state.transactions.forEach(t => {
    const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    const y = td.getFullYear();
    if (y <= currYear) years.add(y);
  });

  const sortedYears = [...years].sort((a, b) => b - a);
  const currentYearVal = yearSelect.value || currYear.toString();

  yearSelect.innerHTML = '<option value="all"' + (currentYearVal === 'all' ? ' selected' : '') + '>Todos os Anos</option>' +
    sortedYears.map(y =>
      `<option value="${y}" ${String(y) === currentYearVal ? 'selected' : ''}>${y}</option>`
    ).join('');

  // Month dropdown
  const currentMonth = monthSelect.value || 'all';
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  monthSelect.innerHTML = '<option value="all"' + (currentMonth === 'all' ? ' selected' : '') + '>Todos os Meses</option>' +
    monthNames.map((name, i) =>
      `<option value="${i}" ${currentMonth === String(i) ? 'selected' : ''}>${name}</option>`
    ).join('');
}

// ============================
// Categories Page
// ============================
function getCategoryEmoji(cat) {
  const map = {
    'alimentação': '🍽️', 'transporte': '🚗', 'compras online': '🛒',
    'lazer/assinaturas': '🎬', 'saúde': '💊', 'educação': '📚',
    'moradia': '🏠', 'beleza': '💅', 'pets': '🐾',
    'investimentos': '📈', 'taxas/encargos': '🏦', 'salário': '💰',
    'importado': '📥', 'transferência interna': '🔄', 'outros': '📦'
  };
  return map[cat.toLowerCase()] || '🏷️';
}

function renderCategories() {
  const summaryContainer = document.getElementById('categories-summary');
  const listContainer = document.getElementById('categories-list');
  if (!summaryContainer || !listContainer) return;

  // Get filter type (all, despesa, receita)
  const activeFilter = document.querySelector('.cat-pill.active')?.dataset.catFilter || 'all';
  const periodSelect = document.getElementById('cat-period-filter');
  const period = periodSelect ? periodSelect.value : 'current-year';

  // Build date range
  const now = new Date();
  let start, end;
  if (period === 'current-month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (period === 'last-month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  } else if (period === 'current-year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  } else {
    start = new Date(2000, 0, 1);
    end = new Date(2099, 11, 31, 23, 59, 59);
  }

  // Filter transactions
  let txs = state.transactions.filter(t => {
    const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    return td >= start && td <= end && t.category !== 'Transferência Interna';
  });

  if (activeFilter !== 'all') {
    txs = txs.filter(t => t.type === activeFilter);
  }

  // Aggregate by category
  const catData = {};
  txs.forEach(t => {
    const cat = t.category || 'Outros';
    if (!catData[cat]) catData[cat] = { expense: 0, income: 0, count: 0 };
    if (t.type === 'despesa') catData[cat].expense += t.amount;
    else if (t.type === 'receita') catData[cat].income += t.amount;
    catData[cat].count++;
  });

  const entries = Object.entries(catData);
  const totalCategories = entries.length;
  const totalExpense = entries.reduce((s, [, d]) => s + d.expense, 0);
  const totalIncome = entries.reduce((s, [, d]) => s + d.income, 0);

  // Sort by total amount
  entries.sort((a, b) => {
    const totalA = a[1].expense + a[1].income;
    const totalB = b[1].expense + b[1].income;
    return totalB - totalA;
  });

  const maxAmount = entries.length > 0 ? Math.max(...entries.map(([, d]) => d.expense + d.income)) : 1;

  // Find most used category
  const mostUsed = entries.length > 0 ? entries.reduce((best, curr) => curr[1].count > best[1].count ? curr : best) : null;

  // Count auto-categorizeable: 'Importado' + 'Transferência' (from OFX imports, not manual internal transfers)
  const autoCatCandidates = state.transactions.filter(t => 
    t.category === 'Importado' || 
    (t.category === 'Transferência' && !(t.description || '').startsWith('➡️') && !(t.description || '').startsWith('⬅️'))
  );
  const importadoCount = autoCatCandidates.length;

  // Render summary cards
  summaryContainer.innerHTML = `
    <div class="cat-summary-card">
      <div class="cat-summary-icon"><i class="fas fa-tags"></i></div>
      <div class="cat-summary-content">
        <span class="cat-summary-label">Total Categorias</span>
        <span class="cat-summary-value">${totalCategories}</span>
      </div>
    </div>
    <div class="cat-summary-card">
      <div class="cat-summary-icon" style="background:var(--expense-bg);color:var(--expense-color);"><i class="fas fa-arrow-down"></i></div>
      <div class="cat-summary-content">
        <span class="cat-summary-label">Total Despesas</span>
        <span class="cat-summary-value text-expense">${formatCurrency(totalExpense)}</span>
      </div>
    </div>
    <div class="cat-summary-card">
      <div class="cat-summary-icon" style="background:var(--income-bg);color:var(--income-color);"><i class="fas fa-arrow-up"></i></div>
      <div class="cat-summary-content">
        <span class="cat-summary-label">Total Receitas</span>
        <span class="cat-summary-value text-income">${formatCurrency(totalIncome)}</span>
      </div>
    </div>
    ${mostUsed ? `
    <div class="cat-summary-card">
      <div class="cat-summary-icon" style="background:var(--savings-bg);color:var(--savings-color);"><i class="fas fa-fire"></i></div>
      <div class="cat-summary-content">
        <span class="cat-summary-label">Mais Usada</span>
        <span class="cat-summary-value" style="font-size:0.95rem;">${getCategoryEmoji(mostUsed[0])} ${mostUsed[0]}</span>
      </div>
    </div>` : ''}
  `;

  // Render list
  if (entries.length === 0) {
    listContainer.innerHTML = '<div class="empty-state"><i class="fas fa-tags"></i><p>Nenhuma categoria encontrada no período.</p></div>';
    return;
  }

  listContainer.innerHTML = entries.map(([cat, data]) => {
    const total = data.expense + data.income;
    const barPct = (total / maxAmount) * 100;
    const isExpense = data.expense > data.income;
    const barColor = isExpense ? 'var(--expense-color)' : 'var(--income-color)';
    const displayAmount = isExpense ? data.expense : data.income;
    const typeLabel = data.expense > 0 && data.income > 0
      ? `Despesas: ${formatCurrency(data.expense)} / Receitas: ${formatCurrency(data.income)}`
      : `${data.count} transações`;

    return `
      <div class="category-item">
        <span class="cat-emoji">${getCategoryEmoji(cat)}</span>
        <div class="cat-info">
          <div class="cat-name">${cat}${cat === 'Importado' ? ' <span style="font-size:0.7rem;color:var(--warning-color);">(auto-categorizar?)</span>' : ''}</div>
          <div class="cat-meta">${typeLabel}</div>
        </div>
        <div class="cat-bar-wrapper">
          <div class="cat-bar">
            <div class="cat-bar-fill" style="width:${barPct}%;background:${barColor};"></div>
          </div>
        </div>
        <span class="cat-amount ${isExpense ? 'text-expense' : 'text-income'}">${formatCurrency(displayAmount)}</span>
      </div>
    `;
  }).join('');

  // Show/hide AI button based on importado count
  const aiBtn = document.getElementById('ai-auto-categorize-btn');
  if (aiBtn) {
    if (importadoCount > 0) {
      aiBtn.style.display = '';
      aiBtn.innerHTML = `<i class="fas fa-magic"></i> Auto Categorizar (${importadoCount} pendentes)`;
    } else {
      aiBtn.style.display = 'none';
    }
  }
}

// ============================
// Batch Categorize
// ============================
let _batchSearchResults = [];

function openBatchCategorizeModal() {
  // Reset modal state
  const searchInput = document.getElementById('batch-search-input');
  const resultsInfo = document.getElementById('batch-results-info');
  const resultsContainer = document.getElementById('batch-results-container');
  const actionPanel = document.getElementById('batch-action-panel');
  const emptyState = document.getElementById('batch-empty-state');
  const newCatInput = document.getElementById('batch-new-category');

  if (searchInput) searchInput.value = '';
  if (newCatInput) newCatInput.value = '';
  if (resultsInfo) resultsInfo.classList.add('hidden');
  if (resultsContainer) resultsContainer.classList.add('hidden');
  if (actionPanel) actionPanel.classList.add('hidden');
  if (emptyState) emptyState.style.display = '';
  _batchSearchResults = [];

  populateCategoryDatalist();
  openModal('batch-categorize-modal');

  // Focus search after modal opens
  setTimeout(() => searchInput?.focus(), 200);
}

function searchBatchTransactions(query) {
  const resultsInfo = document.getElementById('batch-results-info');
  const resultsContainer = document.getElementById('batch-results-container');
  const actionPanel = document.getElementById('batch-action-panel');
  const emptyState = document.getElementById('batch-empty-state');
  const tbody = document.getElementById('batch-results-tbody');
  const countEl = document.getElementById('batch-results-count');
  const applyCountEl = document.getElementById('batch-apply-count');

  if (!query || query.length < 2) {
    if (resultsInfo) resultsInfo.classList.add('hidden');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    if (actionPanel) actionPanel.classList.add('hidden');
    if (emptyState) emptyState.style.display = '';
    _batchSearchResults = [];
    return;
  }

  const q = query.toLowerCase();
  _batchSearchResults = state.transactions.filter(t =>
    (t.description || '').toLowerCase().includes(q)
  );

  if (_batchSearchResults.length === 0) {
    if (resultsInfo) resultsInfo.classList.add('hidden');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    if (actionPanel) actionPanel.classList.add('hidden');
    if (emptyState) {
      emptyState.style.display = '';
      emptyState.innerHTML = `
        <i class="fas fa-search" style="font-size:2rem;margin-bottom:var(--space-sm);opacity:0.5;"></i>
        <p>Nenhuma transação encontrada com "${query}".</p>
      `;
    }
    return;
  }

  // Calculate total
  const totalAmount = _batchSearchResults.reduce((sum, t) => {
    return t.type === 'receita' ? sum + t.amount : sum - t.amount;
  }, 0);

  if (emptyState) emptyState.style.display = 'none';
  if (resultsInfo) {
    resultsInfo.classList.remove('hidden');
    resultsInfo.style.display = 'flex';
  }
  if (resultsContainer) resultsContainer.classList.remove('hidden');
  if (actionPanel) actionPanel.classList.remove('hidden');

  if (countEl) {
    countEl.innerHTML = `<i class="fas fa-check-circle" style="color:var(--success-color);margin-right:4px;"></i>${_batchSearchResults.length} transações encontradas — Total: ${formatCurrency(Math.abs(totalAmount))}`;
  }
  if (applyCountEl) applyCountEl.textContent = _batchSearchResults.length;

  // Render results table
  if (tbody) {
    const sorted = [..._batchSearchResults].sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
    tbody.innerHTML = sorted.map(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return `
        <tr>
          <td><input type="checkbox" class="batch-tx-checkbox" data-tx-id="${t.id}" checked></td>
          <td style="white-space:nowrap;font-size:0.8rem;">${d.toLocaleDateString('pt-BR')}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.85rem;" title="${t.description}">${t.description}</td>
          <td><span style="font-size:0.75rem;padding:2px 8px;border-radius:12px;background:var(--bg-tertiary);">${t.category || 'Sem categoria'}</span></td>
          <td class="${t.type}" style="white-space:nowrap;font-size:0.85rem;">${formatCurrency(t.amount)}</td>
        </tr>
      `;
    }).join('');
  }

  // Check all by default
  const checkAll = document.getElementById('batch-check-all');
  if (checkAll) checkAll.checked = true;

  updateBatchApplyCount();
}

function updateBatchApplyCount() {
  const checked = document.querySelectorAll('.batch-tx-checkbox:checked');
  const applyCountEl = document.getElementById('batch-apply-count');
  if (applyCountEl) applyCountEl.textContent = checked.length;
}

async function applyBatchCategory() {
  const newCategory = document.getElementById('batch-new-category')?.value?.trim();
  if (!newCategory) {
    showToast('Categoria obrigatória', 'Informe a nova categoria para aplicar.', 'warning');
    return;
  }

  const checkedBoxes = document.querySelectorAll('.batch-tx-checkbox:checked');
  const selectedIds = Array.from(checkedBoxes).map(cb => cb.dataset.txId);

  if (selectedIds.length === 0) {
    showToast('Nenhuma selecionada', 'Selecione pelo menos uma transação.', 'warning');
    return;
  }

  const btn = document.getElementById('batch-apply-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aplicando...';
  }

  try {
    let updated = 0;
    for (const txId of selectedIds) {
      const tx = state.transactions.find(t => t.id === txId);
      if (tx) {
        await saveTransaction({ category: newCategory }, txId);
        tx.category = newCategory;
        updated++;
      }
    }

    showToast(
      `${updated} transações atualizadas!`,
      `Categoria alterada para "${newCategory}".`,
      'success'
    );

    closeModal('batch-categorize-modal');
    await loadAllData();
  } catch (err) {
    console.error('Batch categorize error:', err);
    showToast('Erro', 'Não foi possível aplicar a categoria em lote.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-double"></i> Aplicar Categoria a <span id="batch-apply-count">0</span> transações';
    }
  }
}

// ============================
// AI Auto-Categorize
// ============================
async function handleAIAutoCategorize() {
  // Include 'Importado' AND 'Transferência' (from OFX imports, not manual internal transfers)
  const importedTxs = state.transactions.filter(t => 
    t.category === 'Importado' || 
    (t.category === 'Transferência' && !(t.description || '').startsWith('➡️') && !(t.description || '').startsWith('⬅️'))
  );
  if (importedTxs.length === 0) {
    showToast('Nada para categorizar', 'Não há transações com categoria "Importado" ou "Transferência" importada.', 'info');
    return;
  }

  const geminiKey = getGeminiKey();
  const openaiKey = getOpenAIKey();

  if (!geminiKey && !openaiKey) {
    showToast('Chave IA necessária', 'Configure uma chave Gemini ou OpenAI no Dashboard → Chat → Configurações.', 'warning');
    return;
  }

  const btn = document.getElementById('ai-auto-categorize-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Categorizando...';
  }

  try {
    const existingCats = [...new Set(state.transactions.map(t => t.category).filter(c => c && c !== 'Importado'))];
    let totalUpdated = 0;

    // Build all description lines with global indices
    const allLines = importedTxs.map((t, i) => `${i + 1}. "${t.description}" (R$${t.amount.toFixed(2)}, ${t.type})`);

    // Split into chunks of ~10000 characters without breaking mid-line
    const CHUNK_CHAR_LIMIT = 10000;
    const chunks = [];
    let currentChunk = [];
    let currentLen = 0;

    for (const line of allLines) {
      const lineLen = line.length + 1; // +1 for \n
      if (currentChunk.length > 0 && currentLen + lineLen > CHUNK_CHAR_LIMIT) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
        currentLen = 0;
      }
      currentChunk.push(line);
      currentLen += lineLen;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk.join('\n'));

    console.log(`AI categorize: ${importedTxs.length} transações em ${chunks.length} chunk(s)`);

    // Helper: call AI with retry on 429
    async function callAIWithRetry(prompt, attempt = 0) {
      const MAX_RETRIES = 5;
      const WAIT_SECONDS = [15, 30, 60, 90, 120];

      let response;
      if (geminiKey) {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 34096 }
            })
          }
        );
        if (response.status === 429 && attempt < MAX_RETRIES) {
          const wait = (WAIT_SECONDS[attempt] || 60) * 1000;
          console.warn(`429 rate limit — aguardando ${wait / 1000}s antes de tentar novamente...`);
          if (btn) btn.innerHTML = `<i class="fas fa-clock"></i> Rate limit — aguardando ${wait / 1000}s...`;
          await new Promise(r => setTimeout(r, wait));
          return callAIWithRetry(prompt, attempt + 1);
        }
        if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else if (openaiKey) {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Você é um categorizador financeiro. Responda apenas com JSON compacto, sem markdown.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3, max_tokens: 34096
          })
        });
        if (response.status === 429 && attempt < MAX_RETRIES) {
          const wait = (WAIT_SECONDS[attempt] || 60) * 1000;
          console.warn(`429 rate limit — aguardando ${wait / 1000}s...`);
          if (btn) btn.innerHTML = `<i class="fas fa-clock"></i> Rate limit — aguardando ${wait / 1000}s...`;
          await new Promise(r => setTimeout(r, wait));
          return callAIWithRetry(prompt, attempt + 1);
        }
        if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
      }
      return '';
    }

    // Process chunks sequentially
    for (let ci = 0; ci < chunks.length; ci++) {
      if (btn) {
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Categorizando... (chunk ${ci + 1}/${chunks.length})`;
      }

      const prompt = `Categorize estas transações financeiras brasileiras. Use as categorias existentes quando possível: ${existingCats.join(', ')}.
Se nenhuma servir, crie uma curta em português.
NOTA: Transações que contêm "Transferência enviada pelo Pix" ou similares são pagamentos PIX a terceiros — NÃO categorize como "Transferência" ou "Transferência Interna". Analise o NOME do destinatário para determinar a categoria real (ex: academia = Saúde, restaurante = Alimentação, etc).

Transações:
${chunks[ci]}

Responda SOMENTE com JSON compacto, sem formatação markdown, sem code blocks:
[{"idx":1,"category":"Nome"},...]
Os idx correspondem aos números das transações acima.`;

      // Delay between chunks to avoid rate limits (skip first)
      if (ci > 0) await new Promise(r => setTimeout(r, 2000));

      let responseText;
      try {
        responseText = await callAIWithRetry(prompt);
      } catch (apiErr) {
        console.error(`Chunk ${ci + 1} API error:`, apiErr);
        continue;
      }

      // Parse — strip markdown fences, thinking tags, etc.
      let cleanedText = responseText
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();

      const jsonStart = cleanedText.indexOf('[');
      const jsonEnd = cleanedText.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) {
        console.error('AI raw response:', responseText);
        console.warn(`Chunk ${ci + 1} sem JSON válido — pulando`);
        continue;
      }

      let suggestions;
      try {
        suggestions = JSON.parse(cleanedText.substring(jsonStart, jsonEnd + 1));
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr);
        console.warn(`Chunk ${ci + 1} JSON malformado — pulando`);
        continue;
      }

      for (const sug of suggestions) {
        const idx = sug.idx - 1;
        if (idx >= 0 && idx < importedTxs.length && sug.category) {
          const tx = importedTxs[idx];
          await saveTransaction({ category: sug.category }, tx.id);
          tx.category = sug.category;
          if (!existingCats.includes(sug.category)) existingCats.push(sug.category);
          totalUpdated++;
        }
      }

      // Refresh UI after each chunk so progress is visible and saved
      renderCategories();
      if (chunks.length > 1) {
        showToast(
          `Chunk ${ci + 1}/${chunks.length} concluído`,
          `${totalUpdated} categorizadas até agora.`,
          'success'
        );
      }
    }

    showToast(
      `${totalUpdated} transações categorizadas!`,
      `IA categorizou ${totalUpdated} de ${importedTxs.length} transações.`,
      'success'
    );

    await loadAllData();
  } catch (err) {
    console.error('AI Auto-categorize error:', err);
    showToast('Erro na categorização', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-magic"></i> Auto Categorizar (IA)';
    }
  }
}


function renderCashflowProjection() {
  const ctx = document.getElementById('cashflow-projection-chart');
  if (!ctx || !state.charts) return;

  if (state.charts.cashflow) state.charts.cashflow.destroy();

  // Only include liquid accounts (exclude credit cards)
  let saldo = state.accounts
    .filter(acc => acc.type !== 'cartao_credito')
    .reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);

  const futureDays = 30;
  let labels = [];
  let saldos = [];

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let allTx = state.transactions;
  if (state.filter === 'mine') allTx = allTx.filter(t => t.createdBy === state.user.uid);
  else if (state.filter === 'partner') allTx = allTx.filter(t => t.createdBy !== state.user.uid);

  const pendingTx = allTx.filter(t => !t.isPaid);

  // Get fixed bill reminders for the next 30 days
  const todayTime = now.getTime();
  const next30Time = todayTime + (31 * 24 * 60 * 60 * 1000);
  const fbReminders = generateFixedBillReminders(now, todayTime, todayTime - 1, next30Time);
  const allReminders = [
    ...fbReminders.overdue,
    ...fbReminders.today,
    ...fbReminders.next7,
    ...fbReminders.next30
  ];

  for (let i = 0; i <= futureDays; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dTimeStart = d.getTime();
    const dTimeEnd = dTimeStart + (24 * 60 * 60 * 1000) - 1;

    // Transactions for this day
    const dayTxs = pendingTx.filter(t => {
      const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      const tt = td.setHours(0, 0, 0, 0);
      return tt === dTimeStart;
    });

    dayTxs.forEach(t => {
      if (t.type === 'receita') saldo += t.amount;
      else if (t.type === 'despesa') saldo -= t.amount;
    });

    // Fixed bills for this day (reminders)
    const dayReminders = allReminders.filter(r => {
      // Reminder date is a string in pt-BR
      const parts = r._dueDateStr.split('/');
      const rd = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return rd.getTime() === dTimeStart;
    });

    dayReminders.forEach(r => {
      if (r.type === 'receita') saldo += r.amount;
      else if (r.type === 'despesa') saldo -= r.amount;
    });

    labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }));
    saldos.push(saldo);
  }

  state.charts.cashflow = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Saldo Previsto',
        data: saldos,
        borderColor: getComputedStyle(document.body).getPropertyValue('--primary-color').trim() || '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// ============================
// Profile Page
// ============================
function renderProfile() {
  document.getElementById('profile-name').value = state.profile?.name || '';
  document.getElementById('profile-email').value = state.profile?.email || '';

  // Profile photo
  const photoUrl = state.profile?.photoUrl;
  const photoImg = document.getElementById('profile-photo-img');
  const photoPlaceholder = document.getElementById('profile-photo-placeholder');
  const photoInitial = document.getElementById('profile-photo-initial');
  const removeBtn = document.getElementById('profile-photo-remove-btn');

  if (photoUrl) {
    photoImg.src = photoUrl;
    photoImg.classList.remove('hidden');
    photoPlaceholder.style.display = 'none';
    if (removeBtn) removeBtn.style.display = '';
  } else {
    photoImg.classList.add('hidden');
    photoImg.src = '';
    photoPlaceholder.style.display = '';
    if (removeBtn) removeBtn.style.display = 'none';
  }
  if (photoInitial) {
    photoInitial.textContent = (state.profile?.name || 'U')[0].toUpperCase();
  }

  // Sidebar
  document.getElementById('sidebar-name').textContent = state.profile?.name || 'Usuário';
  document.getElementById('sidebar-role').textContent = state.profile?.role === 'admin' ? 'Administrador(a)' : 'Membro';
  
  const sidebarAvatar = document.getElementById('sidebar-avatar');
  if (photoUrl) {
    // Show photo in sidebar avatar
    let img = sidebarAvatar.querySelector('.sidebar-avatar-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'sidebar-avatar-img';
      img.alt = 'Foto';
      sidebarAvatar.appendChild(img);
    }
    img.src = photoUrl;
    sidebarAvatar.textContent = '';
    sidebarAvatar.appendChild(img);
  } else {
    // Show initial letter
    const existingImg = sidebarAvatar.querySelector('.sidebar-avatar-img');
    if (existingImg) existingImg.remove();
    sidebarAvatar.textContent = (state.profile?.name || 'U')[0].toUpperCase();
  }

  // Family section
  renderFamilySection();
}

function renderFamilySection() {
  const inviteArea = document.getElementById('family-invite-area');
  const membersArea = document.getElementById('family-members-area');

  if (state.family) {
    inviteArea.innerHTML = `
      <div class="invite-section">
        <h4>🔗 Convide seu parceiro(a)</h4>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px;">Compartilhe este código:</p>
        <div class="invite-code-display">${state.family.inviteCode}</div>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${state.family.inviteCode}'); showToast('Copiado!','','success')">
          <i class="fas fa-copy"></i> Copiar Código
        </button>
      </div>
    `;

    const members = state.family.members || [];
    membersArea.innerHTML = `
      <h4 style="margin-bottom:12px;">👥 Membros (${members.length})</h4>
      ${members.map(uid => {
      const profile = state.familyProfiles?.[uid] || { name: 'Desconhecido', email: '' };
      const isMe = uid === state.user.uid;
      const initial = (profile.name || '?')[0].toUpperCase();
      const avatarContent = profile.photoUrl 
        ? `<img src="${profile.photoUrl}" alt="${profile.name}" class="member-avatar-img">` 
        : '';
      return `
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px;margin-bottom:8px;">
            <div class="user-avatar" style="width:40px;height:40px;font-size:1rem;position:relative;overflow:hidden;">${avatarContent || initial}</div>
            <div style="display:flex;flex-direction:column;">
              <span style="font-size:0.95rem;font-weight:600;">${profile.name} ${isMe ? '(você)' : ''}</span>
              <span style="font-size:0.8rem;color:var(--text-secondary);">${profile.email}</span>
            </div>
          </div>
        `;
    }).join('')}
    `;
  }
}

// ============================
// UI Navigation
// ============================
function initNavigation() {
  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
      // Close mobile sidebar
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.add('hidden');
    });
  });

  // Mobile menu toggle
  document.getElementById('menu-toggle-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('hidden');
  });

  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.add('hidden');
  });

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('nossagrana_theme', next);
  });

  // Couple filter
  document.querySelectorAll('.couple-filter .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.couple-filter .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderDashboard();
      renderReports();
    });
  });

  // FAB + Add buttons
  document.getElementById('fab-btn')?.addEventListener('click', openTransactionModal);
  document.getElementById('add-transaction-btn')?.addEventListener('click', openTransactionModal);
  document.getElementById('add-account-btn')?.addEventListener('click', () => {
    document.getElementById('account-form')?.reset();
    document.getElementById('acc-id').value = '';
    openModal('account-modal');
  });
  document.getElementById('add-budget-btn')?.addEventListener('click', () => {
    document.getElementById('budget-form')?.reset();
    document.getElementById('budget-id').value = '';
    document.getElementById('budget-modal-title').textContent = 'Novo Orçamento';
    openModal('budget-modal');
  });

  document.getElementById('add-goal-btn')?.addEventListener('click', () => {
    document.getElementById('goal-form')?.reset();
    document.getElementById('goal-id').value = '';
    document.getElementById('goal-modal-title').textContent = 'Nova Meta';

    const select = document.getElementById('goal-linked-account');
    if (select) {
      select.innerHTML = '<option value="">Nenhuma (usar valor manual)</option>';
      state.accounts.forEach(acc => {
        select.innerHTML += `<option value="${acc.id}">${accLabel(acc)}</option>`;
      });
    }

    openModal('goal-modal');
  });

  document.addEventListener('open-account-modal', () => {
    document.getElementById('account-form')?.reset();
    document.getElementById('acc-id').value = '';
    openModal('account-modal');
  });

  // Transaction form
  document.getElementById('transaction-form')?.addEventListener('submit', handleTransactionForm);
  document.getElementById('tx-type-selector')?.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    document.querySelectorAll('#tx-type-selector .sg-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    const txType = e.target.dataset.value;
    document.getElementById('tx-type').value = txType;
    // Update "Já foi pago" / "Já foi recebido" label
    const paidLabel = document.querySelector('label[for="tx-paid"]');
    if (paidLabel) {
      paidLabel.textContent = txType === 'receita' ? 'Já foi recebido' : 'Já foi pago';
    }

    // Toggle target account field
    const targetGroup = document.getElementById('tx-target-account-group');
    if (targetGroup) {
      if (txType === 'transferencia') {
        targetGroup.classList.remove('hidden');
        // Populate target account dropdown
        const targetSelect = document.getElementById('tx-target-account');
        if (targetSelect) {
          targetSelect.innerHTML = '<option value="">Selecione a conta de destino</option>';
          state.accounts.forEach(acc => {
            targetSelect.innerHTML += `<option value="${acc.id}">${accLabel(acc)}</option>`;
          });
        }
        // Force specific category
        document.getElementById('tx-category').value = 'Transferência Interna';
        if (document.getElementById('tx-description').value === '') {
          document.getElementById('tx-description').value = 'Transferência entre contas';
        }
      } else {
        targetGroup.classList.add('hidden');
      }
    }
  });

  // Installment toggle
  document.getElementById('tx-installment-toggle')?.addEventListener('change', (e) => {
    const panel = document.getElementById('tx-installment-panel');
    if (panel) panel.classList.toggle('hidden', !e.target.checked);
  });

  // Fixed bill toggle
  document.getElementById('tx-fixed-bill-toggle')?.addEventListener('change', (e) => {
    const panel = document.getElementById('tx-fixed-bill-panel');
    if (panel) panel.classList.toggle('hidden', !e.target.checked);
  });

  // Fixed bill select auto-fill
  document.getElementById('tx-fixed-bill-select')?.addEventListener('change', (e) => {
    const fbId = e.target.value;
    if (!fbId) return;
    const fb = state.fixedBills.find(b => b.id === fbId);
    if (!fb) return;
    document.getElementById('tx-description').value = fb.name;
    document.getElementById('tx-category').value = fb.category || 'Moradia';
    
    // Apenas sobrescreve o valor se for uma nova transação. Se for edição de um OFX, mantém o valor original (com multas/descontos)
    const isEdit = !!document.getElementById('tx-id').value;
    if (!isEdit) {
      document.getElementById('tx-amount').value = fb.amount;
    }
    // Set type to despesa
    document.getElementById('tx-type').value = 'despesa';
    document.querySelectorAll('#tx-type-selector .sg-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('#tx-type-selector [data-value="despesa"]')?.classList.add('active');
  });

  // Account form
  document.getElementById('account-form')?.addEventListener('submit', handleAccountForm);

  // Budget form
  document.getElementById('budget-form')?.addEventListener('submit', handleBudgetForm);

  // Goal form
  document.getElementById('goal-form')?.addEventListener('submit', handleGoalForm);

  // Reports filter
  // Reports year/month filters
  document.getElementById('report-year-filter')?.addEventListener('change', renderReports);
  document.getElementById('report-month-filter')?.addEventListener('change', renderReports);

  // Categories page filters
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderCategories();
    });
  });
  document.getElementById('cat-period-filter')?.addEventListener('change', renderCategories);
  document.getElementById('ai-auto-categorize-btn')?.addEventListener('click', handleAIAutoCategorize);
  document.getElementById('batch-categorize-btn')?.addEventListener('click', openBatchCategorizeModal);

  // Batch categorize modal events
  const batchSearchInput = document.getElementById('batch-search-input');
  let _batchSearchTimeout = null;
  batchSearchInput?.addEventListener('input', (e) => {
    clearTimeout(_batchSearchTimeout);
    _batchSearchTimeout = setTimeout(() => searchBatchTransactions(e.target.value.trim()), 300);
  });

  document.getElementById('batch-check-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.batch-tx-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateBatchApplyCount();
  });

  document.getElementById('batch-select-all-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.batch-tx-checkbox').forEach(cb => cb.checked = true);
    const checkAll = document.getElementById('batch-check-all');
    if (checkAll) checkAll.checked = true;
    updateBatchApplyCount();
  });

  document.getElementById('batch-deselect-all-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.batch-tx-checkbox').forEach(cb => cb.checked = false);
    const checkAll = document.getElementById('batch-check-all');
    if (checkAll) checkAll.checked = false;
    updateBatchApplyCount();
  });

  document.getElementById('batch-apply-btn')?.addEventListener('click', applyBatchCategory);

  // Delegate change events for batch checkboxes (dynamic elements)
  document.getElementById('batch-results-tbody')?.addEventListener('change', (e) => {
    if (e.target.classList.contains('batch-tx-checkbox')) {
      updateBatchApplyCount();
    }
  });

  // Profile form
  document.getElementById('profile-form')?.addEventListener('submit', handleProfileForm);

  // Profile photo upload
  document.getElementById('profile-photo-wrapper')?.addEventListener('click', () => {
    document.getElementById('profile-photo-input')?.click();
  });
  document.getElementById('profile-photo-input')?.addEventListener('change', handleProfilePhotoUpload);
  document.getElementById('profile-photo-remove-btn')?.addEventListener('click', handleProfilePhotoRemove);

  // Change password form
  document.getElementById('change-password-form')?.addEventListener('submit', handleChangePasswordForm);

  // Tools - Compound Interest
  document.getElementById('compound-interest-form')?.addEventListener('submit', handleCompoundInterest);

  // Fixed Bill form
  document.getElementById('fixed-bill-form')?.addEventListener('submit', handleFixedBillForm);
  document.getElementById('add-fixed-bill-btn')?.addEventListener('click', () => {
    document.getElementById('fixed-bill-form')?.reset();
    document.getElementById('fb-id').value = '';
    document.getElementById('fb-category').value = 'Moradia';
    document.getElementById('fixed-bill-modal-title').textContent = 'Nova Conta Fixa';
    openModal('fixed-bill-modal');
  });

  // CSV Export
  document.getElementById('export-transactions-csv')?.addEventListener('click', exportTransactionsCSV);
  document.getElementById('export-accounts-csv')?.addEventListener('click', exportAccountsCSV);
  document.getElementById('export-goals-csv')?.addEventListener('click', exportGoalsCSV);

  // Pagination Events
  document.getElementById('tx-rows-per-page')?.addEventListener('change', (e) => {
    state.txPagination.rowsPerPage = e.target.value;
    state.txPagination.currentPage = 1;
    renderTransactions();
  });

  document.getElementById('tx-search')?.addEventListener('input', (e) => {
    state.txSearchQuery = e.target.value;
    state.txPagination.currentPage = 1; // Reset to page 1 when searching
    renderTransactions();
  });

  // Filter dropdowns
  ['tx-filter-category', 'tx-filter-account', 'tx-filter-who'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      state.txPagination.currentPage = 1;
      renderTransactions();
    });
  });

  document.getElementById('tx-show-future')?.addEventListener('change', (e) => {
    state.txShowFuture = e.target.checked;
    state.txPagination.currentPage = 1;
    renderTransactions();
  });

  document.getElementById('tx-date')?.addEventListener('change', (e) => {
    const selectedDate = new Date(e.target.value);
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const isFuture = selectedDate > now;
    const paidCheckbox = document.getElementById('tx-paid');
    if (paidCheckbox) {
      paidCheckbox.checked = !isFuture;
    }
  });

  document.getElementById('tx-prev-page')?.addEventListener('click', () => {
    if (state.txPagination.currentPage > 1) {
      state.txPagination.currentPage--;
      renderTransactions();
      document.querySelector('.table-container')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.getElementById('tx-next-page')?.addEventListener('click', () => {
    const totalItems = state.transactions.length;
    const rowsPerPage = state.txPagination.rowsPerPage === 'all' ? totalItems : parseInt(state.txPagination.rowsPerPage);
    const totalPages = Math.ceil(totalItems / rowsPerPage);

    if (state.txPagination.currentPage < totalPages) {
      state.txPagination.currentPage++;
      renderTransactions();
      document.querySelector('.table-container')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Danger Zone & Tools
  document.getElementById('btn-reset-data')?.addEventListener('click', handleResetData);
  document.getElementById('btn-delete-account')?.addEventListener('click', handleDeleteAccount);
  document.getElementById('btn-remove-duplicates')?.addEventListener('click', handleRemoveDuplicates);
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById(page + '-page')?.classList.remove('hidden');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[data-page="${page}"]`)?.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', transactions: 'Transações', accounts: 'Contas',
    categories: 'Categorias', planning: 'Planejamento Financeiro', payables: 'Contas a Pagar',
    reports: 'Relatórios', import: 'Importar Extrato', tools: 'Ferramentas', profile: 'Perfil & Família',
    chat: 'Assistente IA'
  };
  document.getElementById('page-title').textContent = titles[page] || page;

  // Render chat container conditionally
  const chatContainer = document.getElementById('chat-container');
  if (chatContainer) {
    if (page === 'chat') {
      document.getElementById('chat-page-wrapper')?.appendChild(chatContainer);
      chatContainer.classList.add('chat-full-page');
    } else {
      document.getElementById('dashboard-chat-wrapper')?.appendChild(chatContainer);
      chatContainer.classList.remove('chat-full-page');
    }
  }
}

// ============================
// Form Handlers
// ============================
function handleCompoundInterest(e) {
  e.preventDefault();

  const initial = parseFloat(document.getElementById('initial-amount').value) || 0;
  const monthly = parseFloat(document.getElementById('monthly-contribution').value) || 0;
  const rateInput = parseFloat(document.getElementById('interest-rate').value) || 0;
  const rateType = document.getElementById('interest-rate-type').value;
  const periodInput = parseFloat(document.getElementById('period-years').value) || 0;
  const periodType = document.getElementById('period-type').value;

  let rateMonthly;
  if (rateType === 'ano') {
    rateMonthly = Math.pow(1 + (rateInput / 100), 1 / 12) - 1;
  } else {
    rateMonthly = rateInput / 100;
  }

  const months = periodType === 'anos' ? Math.floor(periodInput * 12) : Math.floor(periodInput);

  let finalAmount = initial;
  let totalInvested = initial;

  for (let i = 0; i < months; i++) {
    finalAmount = finalAmount * (1 + rateMonthly) + monthly;
    totalInvested += monthly;
  }

  const totalInterest = finalAmount - totalInvested;

  document.getElementById('total-invested').textContent = formatCurrency(totalInvested);
  document.getElementById('total-interest').textContent = formatCurrency(totalInterest);
  document.getElementById('final-amount').textContent = formatCurrency(finalAmount);

  document.getElementById('calculator-results').classList.remove('hidden');
}

function accLabel(acc) {
  return acc.ownerTag ? `${acc.name} (${acc.ownerTag})` : acc.name;
}

function openTransactionModal() {
  const form = document.getElementById('transaction-form');
  form.reset();
  delete form.dataset.fixedBillId;
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-date').value = todayString();
  document.getElementById('tx-type').value = 'despesa';
  document.getElementById('tx-paid').checked = true; // Por padrão hoje é pago
  document.getElementById('transaction-modal-title').textContent = 'Nova Transação';

  // Populate account dropdown
  const select = document.getElementById('tx-account');
  select.innerHTML = '<option value="">Selecione</option>';
  state.accounts.forEach(acc => {
    select.innerHTML += `<option value="${acc.id}">${accLabel(acc)}</option>`;
  });

  // Reset type selector
  document.querySelectorAll('#tx-type-selector .sg-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#tx-type-selector [data-value="despesa"]')?.classList.add('active');

  // Populate category datalist with existing + default suggestions
  populateCategoryDatalist();

  // Populate fixed bill dropdown
  populateFixedBillDropdown();

  // Reset fixed bill panel
  const fbPanel = document.getElementById('tx-fixed-bill-panel');
  const fbToggle = document.getElementById('tx-fixed-bill-toggle');
  if (fbPanel) fbPanel.classList.add('hidden');
  if (fbToggle) fbToggle.checked = false;

  openModal('transaction-modal');
}

function populateCategoryDatalist() {
  const datalist = document.getElementById('category-suggestions');
  if (!datalist) return;

  // Collect existing categories
  const existingCats = new Set();
  state.transactions.forEach(t => {
    if (t.category) existingCats.add(t.category);
  });
  state.budgets.forEach(b => {
    if (b.category) existingCats.add(b.category);
  });
  state.fixedBills.forEach(fb => {
    if (fb.category) existingCats.add(fb.category);
  });

  // Default suggestions
  const defaults = [
    'Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação',
    'Lazer', 'Roupas', 'Assinaturas', 'Pets', 'Investimentos',
    'Salário', 'Freelance', 'Presentes', 'Viagem', 'Beleza',
    'Supermercado', 'Restaurante', 'Combustível', 'Farmácia',
    'Internet', 'Telefone', 'Luz', 'Água', 'Gás'
  ];

  defaults.forEach(d => existingCats.add(d));

  const sorted = [...existingCats].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  datalist.innerHTML = sorted.map(c => `<option value="${c}">`).join('');
}

function populateFixedBillDropdown() {
  const select = document.getElementById('tx-fixed-bill-select');
  if (!select) return;

  select.innerHTML = '<option value="">Nenhuma</option>';
  state.fixedBills.forEach(fb => {
    select.innerHTML += `<option value="${fb.id}">${fb.name} — ${formatCurrency(fb.amount)} (Dia ${fb.dueDay})</option>`;
  });
}

async function handleTransactionForm(e) {
  e.preventDefault();
  const id = document.getElementById('tx-id').value;
  const dateStr = document.getElementById('tx-date').value;
  let baseDate = new Date();
  if (dateStr) {
    const [year, month, day] = dateStr.split('-');
    baseDate = new Date(year, parseInt(month) - 1, day);
  } else {
    baseDate = new Date();
  }
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const description = document.getElementById('tx-description').value.trim();
  const category = document.getElementById('tx-category').value.trim();
  const type = document.getElementById('tx-type').value;
  const accountId = document.getElementById('tx-account').value;
  let isPaid = document.getElementById('tx-paid').checked;

  const targetAcc = state.accounts.find(a => a.id === accountId);
  if (targetAcc && targetAcc.type === 'cartao_credito') {
    isPaid = false;
  }

  if (!description || !amount || !category) {
    showToast('Campos obrigatórios', 'Preencha descrição, valor e categoria', 'warning');
    return;
  }

  // Fixed bill link
  let fixedBillId = document.getElementById('tx-fixed-bill-toggle')?.checked
    ? (document.getElementById('tx-fixed-bill-select')?.value || null)
    : null;
    
  // Support for direct fixed bill payments via the Pagar button fallback
  if (!fixedBillId && document.getElementById('transaction-form').dataset.fixedBillId) {
    fixedBillId = document.getElementById('transaction-form').dataset.fixedBillId;
  }

  // Installment logic
  const isInstallment = document.getElementById('tx-installment-toggle')?.checked;
  let installments = 1;
  let installmentAmount = amount;
  let interestRate = 0;

  if (isInstallment && !id) {
    installments = parseInt(document.getElementById('tx-installments')?.value) || 1;
    const amountMode = document.getElementById('tx-amount-mode')?.value || 'per_installment';
    interestRate = parseFloat(document.getElementById('tx-interest')?.value) || 0;

    if (amountMode === 'total') {
      // Amount entered is the total → divide by installments
      installmentAmount = amount / installments;
    } else {
      // Amount entered is per installment ("10x de 29,90")
      installmentAmount = amount;
    }
  }

  // Save each installment
  for (let i = 0; i < installments; i++) {
    const installDate = i === 0 ? baseDate : addMonths(baseDate, i);
    let thisAmount = installmentAmount;

    // Apply compound interest if set
    if (interestRate > 0 && i > 0) {
      thisAmount = installmentAmount * Math.pow(1 + interestRate / 100, i);
    }
    thisAmount = Math.round(thisAmount * 100) / 100;

    const descFinal = installments > 1
      ? `[Parcela ${i + 1}/${installments}] ${description}`
      : description;

    if (type === 'transferencia' && !id) {
      const targetAccountId = document.getElementById('tx-target-account').value;
      if (!targetAccountId) {
        showToast('Conta de destino necessária', 'Selecione para onde o dinheiro vai', 'warning');
        return;
      }

      const originAcc = state.accounts.find(a => a.id === accountId);
      const targetAcc = state.accounts.find(a => a.id === targetAccountId);

      // 1. Despesa na Origem (Atribuído ao dono da conta de origem)
      const outCreatedBy = originAcc?.createdBy || state.user.uid;
      const outCreatedByName = state.familyProfiles?.[outCreatedBy]?.name || state.profile?.name || 'Usuário';

      const outData = {
        familyId: state.familyId,
        createdBy: outCreatedBy,
        createdByName: outCreatedByName,
        type: 'despesa',
        description: `➡️ Transf: ${description}`,
        amount: thisAmount,
        date: db ? firebase.firestore.Timestamp.fromDate(installDate) : { seconds: Math.floor(installDate.getTime() / 1000), toDate: () => installDate },
        category: 'Transferência Interna',
        accountId,
        isPaid: true
      };
      await saveTransaction(outData, null);

      // 2. Receita no Destino (Atribuído ao dono da conta de destino)
      const inCreatedBy = targetAcc?.createdBy || state.user.uid;
      const inCreatedByName = state.familyProfiles?.[inCreatedBy]?.name || state.profile?.name || 'Usuário';

      const inData = {
        familyId: state.familyId,
        createdBy: inCreatedBy,
        createdByName: inCreatedByName,
        type: 'receita',
        description: `⬅️ Transf: ${description}`,
        amount: thisAmount,
        date: db ? firebase.firestore.Timestamp.fromDate(installDate) : { seconds: Math.floor(installDate.getTime() / 1000), toDate: () => installDate },
        category: 'Transferência Interna',
        accountId: targetAccountId,
        isPaid: true
      };
      await saveTransaction(inData, null);
    } else {
      const data = {
        familyId: state.familyId,
        createdBy: state.user.uid,
        createdByName: state.profile?.name || 'Usuário',
        type: type === 'transferencia' ? 'despesa' : type, // Fallback safe
        description: descFinal,
        amount: thisAmount,
        date: db ? firebase.firestore.Timestamp.fromDate(installDate) : { seconds: Math.floor(installDate.getTime() / 1000), toDate: () => installDate },
        category,
        accountId,
        isPaid: i === 0 ? isPaid : false,
        installmentInfo: installments > 1 ? { current: i + 1, total: installments, originalAmount: amount } : null,
        fixedBillId: fixedBillId || null
      };

      await saveTransaction(data, (i === 0 && id) ? id : null);
    }
  }

  closeModal('transaction-modal');
  const totalStr = installments > 1
    ? `${installments}x de ${formatCurrency(installmentAmount)}`
    : formatCurrency(amount);
  showToast(
    id ? 'Transação atualizada!' : (installments > 1 ? 'Parcelas criadas!' : 'Transação adicionada!'),
    `${totalStr} • ${category}`,
    'success'
  );
  await loadAllData();

  // Trigger Intelligent categorization if user manually linked a Fixed Bill via Edit Form
  if (id && fixedBillId && type === 'despesa') {
    const fb = state.fixedBills.find(f => f.id === fixedBillId);
    const origTx = state.transactions.find(t => t.id === id);
    const searchDesc = origTx ? origTx.description : description;
    
    if (fb && searchDesc) {
      setTimeout(() => {
        checkBulkReconciliation(fb, searchDesc, amount);
      }, 500);
    }
  }
}

window.calibrateCreditCard = function() {
  const type = document.getElementById('acc-type').value;
  const accId = document.getElementById('acc-id').value;
  
  if (type !== 'cartao_credito') {
    showToast('Ação inválida', 'Calibração automática disponível apenas para Cartão de Crédito.', 'info');
    return;
  }

  const creditLimit = parseFloat(document.getElementById('acc-credit-limit').value) || 0;
  if (creditLimit <= 0) {
    showToast('Limite necessário', 'Preencha o Limite Total do cartão para calibrar.', 'warning');
    return;
  }
  
  const bankAvailable = prompt("Qual o seu 'Limite Disponível' no app do banco agora?");
  if (bankAvailable === null || bankAvailable === "") return;
  
  const bankAvailableVal = parseFloat(bankAvailable.replace(',', '.'));
  if (isNaN(bankAvailableVal)) {
    showToast('Valor inválido', 'Digite apenas números para o saldo disponível.', 'error');
    return;
  }

  // Calcula a dívida atual no app (soma de todas as despesas não pagas)
  // No model do NossaGrana, a dívida é mostrada como saldo negativo.
  // Calcula a dívida atual no app (soma de todas as despesas não pagas)
  const txs = state.transactions.filter(t => t.accountId === accId && !t.isPaid);
  const appTransactionsBalance = txs.reduce((sum, t) => {
    return t.type === 'receita' ? sum + t.amount : sum - t.amount;
  }, 0);

  // Pega o que o usuário já colocou no campo "Saldo Inicial"
  const initialBalanceVal = parseFloat(document.getElementById('acc-initial-balance').value.replace(',', '.')) || 0;

  // Alvo: O saldo que o app deve ter para bater com o disponível do banco
  // Ex: 100 de disponível - 1000 de limite = -900 de saldo (dívida)
  const targetBalance = bankAvailableVal - creditLimit;
  
  // O quanto já temos sem o ajuste
  const currentBalanceWithoutAdjustment = initialBalanceVal + appTransactionsBalance;

  // O ajuste necessário para sair do atual e chegar no alvo
  const neededAdjustment = targetBalance - currentBalanceWithoutAdjustment;

  document.getElementById('acc-initial-adjustment').value = neededAdjustment.toFixed(2);
  const txAdjField = document.getElementById('acc-initial-adjustment-tx');
  if (txAdjField) txAdjField.value = neededAdjustment.toFixed(2);
  showToast('Calibrado!', `Ajuste de ${formatCurrency(neededAdjustment)} aplicado para bater o banco.`, 'success');
};

window.markAllOldAsPaid = async function() {
  const accId = document.getElementById('acc-id').value;
  if (!accId) {
    showToast('Atenção', 'Abra uma conta existente para marcar o histórico como pago.', 'warning');
    return;
  }

  const acc = state.accounts.find(a => a.id === accId);
  const closingDay = acc?.closingDay || 14;
  
  const now = new Date();
  let limitDate;
  if (now.getDate() >= closingDay) {
    limitDate = new Date(now.getFullYear(), now.getMonth(), closingDay);
  } else {
    limitDate = new Date(now.getFullYear(), now.getMonth() - 1, closingDay);
  }

  const msg = `Deseja marcar todas as transações de "${acc.name}" anteriores a ${limitDate.toLocaleDateString('pt-BR')} como PAGAS?\n\nIsso remove o peso delas do "Limite Disponível" atual se você já as pagou no boleto do banco.`;
  
  if (!confirm(msg)) return;

  try {
    const txsToUpdate = state.transactions.filter(t => t.accountId === accId && !t.isPaid && (t.date?.toDate ? t.date.toDate() : new Date(t.date)) < limitDate);
    
    if (txsToUpdate.length === 0) {
      showToast('Nada para alterar', 'Todas as transações antigas já constam como pagas.', 'info');
      return;
    }

    const batch = db.batch();
    txsToUpdate.forEach(t => {
      batch.update(db.collection('transactions').doc(t.id), { isPaid: true });
    });

    await batch.commit();
    showToast('Sucesso!', `${txsToUpdate.length} transações marcadas como pagas.`, 'success');
    
    // Auto-recalibrate after payment
    window.calibrateCreditCard();
  } catch (err) {
    console.error('Error marking old as paid:', err);
    showToast('Erro', 'Não foi possível atualizar o histórico.', 'error');
  }
};

/**
 * Auditoria de Parcelas: Varre o histórico em busca de sequências de parcelas incompletas
 * e oferece para gerar as futuras automaticamente.
 */
window.auditCreditCardInstallments = async function() {
  const accId = document.getElementById('acc-id').value;
  if (!accId) {
    showToast('Atenção', 'Salve a conta primeiro.', 'warning');
    return;
  }

  const accTxs = state.transactions.filter(t => t.accountId === accId);
  const groups = {}; // keyed by base name

  // Regex robusto para capturar Parcela X/Y ou apenas X/Y no final da descrição
  const installmentRegex = /(.*?)(?:\s+-\s+)?(?:\s+)?(?:Parcela\s+)?(\d+)\/(\d+)$/i;

  accTxs.forEach(t => {
    const match = t.description.match(installmentRegex);
    if (match) {
      const baseName = match[1].trim();
      const current = parseInt(match[2]);
      const total = parseInt(match[3]);
      const amount = t.amount;

      if (!groups[baseName]) {
        groups[baseName] = { baseName, total, amount, installments: {}, firstDate: null };
      }
      groups[baseName].installments[current] = t;
      
      const tDate = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      if (!groups[baseName].firstDate || (current === 1)) {
        // Tenta achar a data base correta (aproximada se não tiver a 1)
        const baseDate = new Date(tDate);
        baseDate.setMonth(baseDate.getMonth() - (current - 1));
        groups[baseName].firstDate = baseDate;
      }
    }
  });

  // Coleta possíveis estornos para filtrar grupos cancelados
  const estornos = accTxs.filter(t => 
    t.type === 'receita' && 
    (t.description.toLowerCase().includes('estorno') || 
     t.description.toLowerCase().includes('reembolso') || 
     t.description.toLowerCase().includes('cancelado'))
  );

  const missingTasks = [];
  Object.values(groups).forEach(g => {
    // Verifica se esse grupo de parcelas possui um estorno correspondente
    const hasBeenRefunded = estornos.some(e => {
      const eDesc = e.description.toLowerCase();
      const gName = g.baseName.toLowerCase();
      return eDesc.includes(gName) || gName.includes(eDesc.replace(/estorno de |reembolso de |cancelamento de /i, '').trim());
    });

    if (hasBeenRefunded) return;

    let missingFound = false;
    for (let i = 1; i <= g.total; i++) {
      if (!g.installments[i]) {
        missingFound = true;
        break;
      }
    }

    if (missingFound) {
      const missingNumbers = [];
      for (let i = 1; i <= g.total; i++) {
        if (!g.installments[i]) missingNumbers.push(i);
      }
      missingTasks.push({ ...g, missingNumbers });
    }
  });

  if (missingTasks.length === 0) {
    showToast('Histórico íntegro', 'Não encontramos buracos ou parcelas futuras faltando nas suas faturas.', 'success');
    return;
  }

  // Montar lista de sugestões
  let report = "Encontramos parcelas futuras ou faltantes:\n\n";
  missingTasks.forEach(g => {
    report += `• ${g.baseName.replace('Cartão - ', '')}: faltam as parcelas [${g.missingNumbers.join(', ')}] de ${g.total}\n`;
  });
  report += "\nDeseja gerar essas transações agora para bater com o limite disponível do banco?";

  if (!confirm(report)) return;

  try {
    const batch = db.batch();
    let createdCount = 0;

    missingTasks.forEach(g => {
      g.missingNumbers.forEach(n => {
        const dueDate = new Date(g.firstDate);
        dueDate.setMonth(dueDate.getMonth() + (n - 1));

        const newTx = {
          familyId: state.familyId,
          createdBy: state.user.uid,
          createdByName: state.profile.name,
          type: 'despesa',
          amount: g.amount,
          category: g.installments[Object.keys(g.installments)[0]]?.category || 'Importado',
          description: `${g.baseName} - ${n}/${g.total}`,
          accountId: accId,
          date: db ? firebase.firestore.Timestamp.fromDate(dueDate) : { seconds: Math.floor(dueDate.getTime() / 1000), toDate: () => dueDate },
          isPaid: false,
          source: 'audit_generator',
          paymentMethod: 'credito'
        };

        const docRef = db.collection('transactions').doc();
        batch.set(docRef, newTx);
        createdCount++;
      });
    });

    await batch.commit();
    showToast('Sucesso!', `${createdCount} parcelas sincronizadas. Recalculando saldo...`, 'success');
    
    // Trigger Recalculation
    window.calibrateCreditCard();
  } catch (err) {
    console.error('Error generating installments:', err);
    showToast('Erro', 'Falha ao sincronizar parcelas futuras.', 'error');
  }
};

async function handleAccountForm(e) {
  e.preventDefault();
  const id = document.getElementById('acc-id').value;
  const type = document.getElementById('acc-type').value;
  const data = {
    familyId: state.familyId,
    createdBy: state.user.uid,
    name: document.getElementById('acc-name').value.trim(),
    ownerTag: document.getElementById('acc-owner-tag')?.value.trim() || '',
    type,
    initialBalance: parseFloat(document.getElementById('acc-initial-balance').value) || 0,
    creditLimit: type === 'cartao_credito' ? (parseFloat(document.getElementById('acc-credit-limit').value) || 0) : null,
    closingDay: type === 'cartao_credito' ? (parseInt(document.getElementById('acc-closing-day').value) || null) : null,
    dueDay: type === 'cartao_credito' ? (parseInt(document.getElementById('acc-due-day').value) || null) : null,
    initialAdjustment: parseFloat(document.getElementById('acc-initial-adjustment').value) || 0
  };

  const savedId = await saveAccount(data, id || null);
  closeModal('account-modal');
  showToast('Conta salva!', data.name, 'success');
  await loadAllData();

  const importSelect = document.getElementById('import-account-select');
  if (importSelect && !document.getElementById('import-preview')?.classList.contains('hidden')) {
    importSelect.innerHTML = '<option value="">Selecione uma conta...</option>' +
      state.accounts.map(a => `<option value="${a.id}">${accLabel(a)}</option>`).join('');
    importSelect.value = savedId;
  }
}

async function handleBudgetForm(e) {
  e.preventDefault();
  const id = document.getElementById('budget-id').value;
  const data = {
    familyId: state.familyId,
    category: document.getElementById('budget-category').value.trim(),
    limit: parseFloat(document.getElementById('budget-limit').value)
  };
  await saveBudget(data, id || null);
  closeModal('budget-modal');
  showToast('Orçamento salvo!', data.category, 'success');
  await loadAllData();
}

async function handleGoalForm(e) {
  e.preventDefault();
  const id = document.getElementById('goal-id').value;
  const linkedAccountId = document.getElementById('goal-linked-account')?.value || null;
  const data = {
    familyId: state.familyId,
    name: document.getElementById('goal-name').value.trim(),
    target: parseFloat(document.getElementById('goal-target').value),
    current: parseFloat(document.getElementById('goal-current').value) || 0,
    linkedAccountId
  };
  await saveGoal(data, id || null);
  closeModal('goal-modal');
  showToast('Meta salva!', data.name, 'success');
  await loadAllData();
}

async function handleProfileForm(e) {
  e.preventDefault();
  const name = document.getElementById('profile-name').value.trim();
  await saveUserProfile(state.user.uid, { name });
  state.profile.name = name;
  renderProfile();
  showToast('Perfil atualizado!', '', 'success');
}

// ---- Profile Photo Upload ----
async function handleProfilePhotoUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Validate file type
  if (!file.type.startsWith('image/')) {
    showToast('Arquivo inválido', 'Selecione um arquivo de imagem (JPG, PNG, etc).', 'error');
    return;
  }

  // Validate file size (max 5MB before compression)
  if (file.size > 5 * 1024 * 1024) {
    showToast('Arquivo muito grande', 'A imagem deve ter no máximo 5MB.', 'error');
    return;
  }

  try {
    showToast('Processando...', 'Redimensionando e salvando sua foto.', 'info');

    const dataUrl = await resizeAndCompressImage(file, 256, 0.8);

    await saveUserProfile(state.user.uid, { photoUrl: dataUrl });
    state.profile.photoUrl = dataUrl;

    // Also update in familyProfiles so sidebar + member list reflect immediately
    if (state.familyProfiles?.[state.user.uid]) {
      state.familyProfiles[state.user.uid].photoUrl = dataUrl;
    }

    renderProfile();
    showToast('Foto atualizada!', 'Sua foto de perfil foi salva com sucesso.', 'success');
  } catch (err) {
    console.error('Profile photo upload error:', err);
    showToast('Erro ao salvar foto', err.message, 'error');
  }

  // Reset file input so same file can be re-selected
  e.target.value = '';
}

async function handleProfilePhotoRemove() {
  try {
    await saveUserProfile(state.user.uid, { photoUrl: '' });
    state.profile.photoUrl = '';

    if (state.familyProfiles?.[state.user.uid]) {
      state.familyProfiles[state.user.uid].photoUrl = '';
    }

    renderProfile();
    showToast('Foto removida', 'Sua foto de perfil foi removida.', 'success');
  } catch (err) {
    console.error('Profile photo remove error:', err);
    showToast('Erro ao remover foto', err.message, 'error');
  }
}

/**
 * Resizes an image file to max dimensions and compresses as JPEG base64.
 * @param {File} file - The image file
 * @param {number} maxSize - Max width/height in pixels
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<string>} - Data URL string
 */
function resizeAndCompressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;

        // Scale down to fit within maxSize x maxSize
        if (w > maxSize || h > maxSize) {
          if (w > h) {
            h = Math.round(h * (maxSize / w));
            w = maxSize;
          } else {
            w = Math.round(w * (maxSize / h));
            h = maxSize;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

async function handleChangePasswordForm(e) {
  e.preventDefault();
  const pwd = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-new-password').value;

  if (pwd !== confirm) {
    showToast('Erro', 'As senhas não coincidem.', 'error');
    return;
  }
  if (pwd.length < 6) {
    showToast('Erro', 'A senha deve ter no mínimo 6 caracteres.', 'error');
    return;
  }

  if (!auth || !auth.currentUser) {
    showToast('Modo Demo', 'Alteração de senha não disponível no Modo Demo.', 'warning');
    return;
  }

  try {
    await auth.currentUser.updatePassword(pwd);
    showToast('Senha atualizada!', 'Sua senha foi alterada com sucesso.', 'success');
    document.getElementById('change-password-form').reset();
  } catch (err) {
    console.error(err);
    if (err.code === 'auth/requires-recent-login') {
      showToast('Login necessário', 'Saia e faça login novamente para alterar sua senha por segurança.', 'error');
    } else {
      showToast('Erro ao alterar senha', err.message, 'error');
    }
  }
}

// ============================
// Global Actions (called from onclick)
// ============================
window.editTransaction = (id) => {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  openTransactionModal();
  document.getElementById('tx-id').value = tx.id;
  document.getElementById('tx-description').value = tx.description;
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-category').value = tx.category;
  document.getElementById('tx-account').value = tx.accountId;
  document.getElementById('tx-type').value = tx.type;
  document.getElementById('tx-paid').checked = tx.isPaid;
  const d = tx.date?.toDate ? tx.date.toDate() : new Date(tx.date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  document.getElementById('tx-date').value = new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
  document.querySelectorAll('#tx-type-selector .sg-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`#tx-type-selector [data-value="${tx.type}"]`)?.classList.add('active');
  document.getElementById('transaction-modal-title').textContent = 'Editar Transação';
};

window.removeTransaction = async (id) => {
  if (!confirm('Excluir esta transação?')) return;
  await deleteTransaction(id);
  showToast('Transação excluída', '', 'success');
  await loadAllData();
};

window.editAccount = (id) => {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  document.getElementById('acc-id').value = acc.id;
  document.getElementById('acc-name').value = acc.name;
  if(document.getElementById('acc-owner-tag')) document.getElementById('acc-owner-tag').value = acc.ownerTag || '';
  document.getElementById('acc-type').value = acc.type;
  document.getElementById('acc-initial-balance').value = acc.initialBalance || 0;
  document.getElementById('acc-initial-adjustment').value = acc.initialAdjustment || 0;

  const limitField = document.getElementById('acc-credit-limit');
  const group = document.getElementById('acc-credit-group');
  const closingDayField = document.getElementById('acc-closing-day');
  const dueDayField = document.getElementById('acc-due-day');

  if (acc.type === 'cartao_credito') {
    if (group) group.classList.remove('hidden');
    if (limitField) limitField.value = acc.creditLimit || 0;
    if (closingDayField) closingDayField.value = acc.closingDay || '';
    if (dueDayField) dueDayField.value = acc.dueDay || '';
  } else {
    if (group) group.classList.add('hidden');
  }

  document.getElementById('account-modal-title').textContent = 'Editar Conta';
  openModal('account-modal');
};

document.getElementById('add-account-btn')?.addEventListener('click', () => {
  document.getElementById('account-form').reset();
  document.getElementById('acc-id').value = '';
  if(document.getElementById('acc-owner-tag')) document.getElementById('acc-owner-tag').value = '';
  document.getElementById('acc-initial-adjustment').value = 0;
  const txAdjField = document.getElementById('acc-initial-adjustment-tx');
  if (txAdjField) txAdjField.value = 0;
  document.getElementById('account-modal-title').textContent = 'Nova Conta';
  document.getElementById('acc-credit-group')?.classList.add('hidden');
  openModal('account-modal');
});

document.getElementById('acc-type')?.addEventListener('change', (e) => {
  const isCredit = e.target.value === 'cartao_credito';
  const group = document.getElementById('acc-credit-group');
  if (group) {
    if (isCredit) group.classList.remove('hidden');
    else group.classList.add('hidden');
  }
});

window.removeAccount = async (id) => {
  if (!confirm('Excluir esta conta? Transações NÃO serão apagadas.')) return;
  await deleteAccount(id);
  showToast('Conta excluída', '', 'success');
  await loadAllData();
};

window.editBudget = (id) => {
  const b = state.budgets.find(b => b.id === id);
  if (!b) return;
  document.getElementById('budget-id').value = b.id;
  document.getElementById('budget-category').value = b.category;
  document.getElementById('budget-limit').value = b.limit;
  document.getElementById('budget-modal-title').textContent = 'Editar Orçamento';
  openModal('budget-modal');
};

window.removeBudget = async (id) => {
  if (!confirm('Excluir este orçamento?')) return;
  await deleteBudget(id);
  showToast('Orçamento excluído', '', 'success');
  await loadAllData();
};

window.editGoal = (id) => {
  const g = state.goals.find(g => g.id === id);
  if (!g) return;

  document.getElementById('goal-id').value = g.id;
  document.getElementById('goal-name').value = g.name;
  document.getElementById('goal-target').value = g.target;
  document.getElementById('goal-current').value = g.current || 0;

  const select = document.getElementById('goal-linked-account');
  if (select) {
    select.innerHTML = '<option value="">Nenhuma (usar valor manual)</option>';
    state.accounts.forEach(acc => {
      select.innerHTML += `<option value="${acc.id}">${accLabel(acc)}</option>`;
    });
    select.value = g.linkedAccountId || '';
  }

  document.getElementById('goal-modal-title').textContent = 'Editar Meta';
  openModal('goal-modal');
};

window.removeGoal = async (id) => {
  if (!confirm('Excluir esta meta?')) return;
  await deleteGoal(id);
  showToast('Meta excluída', '', 'success');
  await loadAllData();
};

// ============================
// Fixed Bill Handlers
// ============================
async function handleFixedBillForm(e) {
  e.preventDefault();
  const id = document.getElementById('fb-id').value;
  const data = {
    familyId: state.familyId,
    name: document.getElementById('fb-name').value.trim(),
    amount: parseFloat(document.getElementById('fb-amount').value),
    dueDay: parseInt(document.getElementById('fb-due-day').value),
    category: document.getElementById('fb-category').value.trim() || 'Moradia'
  };
  await saveFixedBill(data, id || null);
  closeModal('fixed-bill-modal');
  showToast('Conta fixa salva!', data.name, 'success');
  await loadAllData();
}

window.editFixedBill = (id) => {
  const b = state.fixedBills.find(b => b.id === id);
  if (!b) return;
  document.getElementById('fb-id').value = b.id;
  document.getElementById('fb-name').value = b.name;
  document.getElementById('fb-amount').value = b.amount;
  document.getElementById('fb-due-day').value = b.dueDay;
  document.getElementById('fb-category').value = b.category || 'Moradia';
  document.getElementById('fixed-bill-modal-title').textContent = 'Editar Conta Fixa';
  openModal('fixed-bill-modal');
};

window.removeFixedBill = async (id) => {
  if (!confirm('Excluir esta conta fixa?')) return;
  await deleteFixedBill(id);
  showToast('Conta fixa excluída', '', 'success');
  await loadAllData();
};

window.payFixedBill = (id) => {
  const b = state.fixedBills.find(b => b.id === id);
  if (!b) return;

  const now = new Date();
  
  // Encontrar despesas candidatas não vinculadas (isPaid = pode ser qualquer coisa, num cenário ideal OFX importa como não pago ou pago dependendo do caso, mas geralmente não está vinculado a fixedBillId)
  // Vamos buscar transações do tipo "despesa" não vinculadas (sem fixedBillId) nos últimos 45 dias
  const candidates = state.transactions.filter(t => {
    if (t.type !== 'despesa') return false;
    if (t.fixedBillId) return false; // Já vinculado a uma conta fixa
    // Ignorar faturas de cartão de crédito virtuais ou pagamentos de fatura de cartão já consolidados
    if (t.categoryId === 'fatura_cartao' || t.description === 'Pagamento de Fatura') return false;

    const td = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    const diffDays = (td - now) / (1000 * 60 * 60 * 24);
    
    // Entre -45 dias (faturas antigas) e +15 dias (faturas futuras pagas antecipadamente)
    return diffDays >= -45 && diffDays <= 15;
  });

  if (candidates.length > 0) {
    // Organizar: Correspondência exata do valor no topo
    candidates.sort((t1, t2) => {
      const diff1 = Math.abs(t1.amount - b.amount);
      const diff2 = Math.abs(t2.amount - b.amount);
      if (diff1 < 0.1 && diff2 >= 0.1) return -1;
      if (diff2 < 0.1 && diff1 >= 0.1) return 1;
      
      const d1 = t1.date?.toDate ? t1.date.toDate() : new Date(t1.date);
      const d2 = t2.date?.toDate ? t2.date.toDate() : new Date(t2.date);
      return d2 - d1; // mais recentes primeiro
    });

    // Se temos candidatos fortemente relacionados (mesmo valor) ou simplesmente lançamentos não vinculados recentes, mostramos a opção
    showLinkTransactionModal(b, candidates);
    return;
  }

  // Se não tem candidatos recentes, abre direto o criador
  openNewTransactionForFixedBill(b);
};

window.openNewTransactionForFixedBill = (b) => {
  openTransactionModal();
  document.getElementById('tx-description').value = b.name;
  document.getElementById('tx-amount').value = b.amount;
  document.getElementById('tx-category').value = b.category || 'Moradia';
  document.getElementById('tx-type').value = 'despesa';
  document.getElementById('tx-date').value = todayString();
  document.querySelectorAll('#tx-type-selector .sg-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector('#tx-type-selector [data-value="despesa"]')?.classList.add('active');
  document.getElementById('transaction-modal-title').textContent = `Pagar: ${b.name}`;
  
  // Set the linked property so saving the transaction marks it for this bill
  document.getElementById('transaction-form').dataset.fixedBillId = b.id;
};

// UI Modal for Reconciliation (Link existing imported OFX or manual record)
window.showLinkTransactionModal = (fixedBill, candidates) => {
  const overlayId = 'link-tx-modal-overlay';
  if (document.getElementById(overlayId)) document.getElementById(overlayId).remove();

  let listHtml = candidates.slice(0, 10).map((t, index) => {
    const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    const dateStr = d.toLocaleDateString('pt-BR');
    const isExactMatch = Math.abs(t.amount - fixedBill.amount) < 0.1;
    const highlightTheme = isExactMatch ? 'border: 2px solid var(--income-color,#10B981); background: rgba(16, 185, 129, 0.05);' : 'border: 1px solid var(--border-color, rgba(255,255,255,0.1)); background: var(--bg-tertiary,rgba(255,255,255,0.03));';
    const tag = isExactMatch ? `<span style="background:var(--income-color,#10B981);color:#fff;padding:2px 8px;border-radius:12px;font-size:0.65rem;font-weight:bold;margin-left:8px;position:relative;top:-1px;">SUGESTÃO IDEAL</span>` : '';
    const acc = state.accounts.find(a => a.id === t.accountId);
    
    return `
      <div 
        style="${highlightTheme} border-radius:12px; padding:12px; margin-bottom:12px; cursor:pointer; transition: transform 0.2s; display:flex; align-items:center; justify-content:space-between;"
        onclick="confirmLinkTransaction('${fixedBill.id}', '${t.id}')"
        onmouseover="this.style.transform='translateX(4px)'"
        onmouseout="this.style.transform='translateX(0)'"
      >
        <div style="flex:1;">
          <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary);margin-bottom:4px;">
            ${t.description || 'Lançamento sem nome'} ${tag}
          </div>
          <div style="font-size:0.8rem;color:var(--text-secondary);display:flex;gap:12px;">
            <span><i class="fas fa-calendar-day"></i> ${dateStr}</span>
            <span><i class="fas fa-wallet"></i> ${acc ? acc.name : 'Conta desconhecida'}</span>
            ${t.fitid ? `<span style="color:var(--primary-color);"><i class="fas fa-file-import"></i> OFX</span>` : ''}
          </div>
        </div>
        <div style="font-weight:bold; font-size:1.1rem; color:var(--expense-color);">
          R$ ${formatCurrency(t.amount)}
        </div>
      </div>
    `;
  }).join('');

  const modalHtml = `
    <div id="${overlayId}" style="position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="background:var(--bg-secondary,#1e1e2e);border-radius:16px;width:100%;max-width:600px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.5);">
        
        <div style="padding:20px;border-bottom:1px solid var(--border-color,rgba(255,255,255,0.1));display:flex;justify-content:space-between;align-items:center;">
          <div>
            <h2 style="margin:0;font-size:1.3rem;"><i class="fas fa-link" style="color:var(--primary-color);"></i> Vincular Pagamento</h2>
            <p style="margin:4px 0 0 0;font-size:0.85rem;color:var(--text-secondary);">Encontramos despesas recentes soltas. Alguma delas é o seu pagamento da conta <strong>${fixedBill.name}</strong>?</p>
          </div>
          <button onclick="document.getElementById('${overlayId}').remove()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;font-size:1.2rem;padding:0;"><i class="fas fa-times"></i></button>
        </div>
        
        <div style="padding:20px;overflow-y:auto;flex:1;">
          ${listHtml}
        </div>
        
        <div style="padding:20px;border-top:1px solid var(--border-color,rgba(255,255,255,0.1));display:flex;justify-content:space-between;align-items:center;background:var(--bg-primary);">
          <span style="font-size:0.85rem;color:var(--text-secondary);">Nenhuma destas é a sua conta?</span>
          <button class="btn btn-primary" onclick="document.getElementById('${overlayId}').remove(); openNewTransactionForFixedBill(state.fixedBills.find(x => x.id === '${fixedBill.id}'));" style="background:var(--primary-600);font-weight:600;padding:8px 16px;">
            <i class="fas fa-plus"></i> Criar Novo Pagamento
          </button>
        </div>
        
      </div>
    </div>
  `;

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = modalHtml;
  document.body.appendChild(tempDiv.firstElementChild);
};

window.confirmLinkTransaction = async (fixedBillId, txId) => {
  const fb = state.fixedBills.find(f => f.id === fixedBillId);
  const tx = state.transactions.find(t => t.id === txId);
  if (!fb || !tx) return;

  // Guarda detalhes originais da transação caso queiramos categorizar as outras idênticas
  const originalDescription = tx.description;
  const originalAmount = tx.amount;

  const overlayId = 'link-tx-modal-overlay';
  if (document.getElementById(overlayId)) document.getElementById(overlayId).remove();

  // Show a temporary processing state
  showToast('Vinculando...', 'Atualizando lançamento escolhido...', 'info');

  try {
    const updatedTx = {
      ...tx,
      description: fb.name, 
      category: fb.category || 'Outros',
      fixedBillId: fb.id,
      isPaid: true
    };
    await saveTransaction(updatedTx, tx.id);
    showToast('Sucesso!', 'Pagamento vinculado e categorizado com sucesso!', 'success');
    await loadAllData();

    // Prompts intelligence for bulk reconciliation
    setTimeout(() => {
      checkBulkReconciliation(fb, originalDescription, originalAmount);
    }, 500);

  } catch (err) {
    console.error('Error linking transaction:', err);
    showToast('Erro', 'Não foi possível vincular o pagamento.', 'error');
  }
};

window.checkBulkReconciliation = async (fb, originalDescription, amount) => {
  if (!originalDescription) return;
  
  // Encontrar outras transações da mesma época que vieram com o mesmo nome
  const matches = state.transactions.filter(t => 
    t.type === 'despesa' && 
    !t.fixedBillId && 
    (t.description || '').toLowerCase() === originalDescription.toLowerCase()
  );

  // Sort them by date descending so the list looks organized
  matches.sort((a,b) => {
    const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
    const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
    return db - da;
  });

  if (matches.length > 0) {
    const overlayId = 'bulk-link-modal-overlay';
    if (document.getElementById(overlayId)) return; 

    // Build the list of checkboxes
    const listHtml = matches.map((t, i) => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return `
        <label style="display:flex;align-items:center;padding:12px;border-bottom:1px solid var(--border-color,rgba(255,255,255,0.05));cursor:pointer;gap:12px;transition:background 0.2s;" onmouseover="this.style.background='var(--bg-tertiary, rgba(255,255,255,0.03))'" onmouseout="this.style.background='transparent'">
          <input type="checkbox" checked value="${t.id}" class="bulk-match-checkbox" style="width:18px;height:18px;accent-color:var(--income-color,#10B981);">
          <div style="flex:1;">
            <div style="font-weight:500;">${d.toLocaleDateString('pt-BR')}</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);">${t.description}</div>
          </div>
          <div style="font-weight:bold;color:var(--expense-color);">R$ ${formatCurrency(t.amount)}</div>
        </label>`;
    }).join('');

    const modalHtml = `
      <div id="${overlayId}" style="position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
        <div style="background:var(--bg-secondary,#1e1e2e);border-radius:16px;width:100%;max-width:500px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.5); border: 2px solid var(--primary-color);">
          <div style="padding:20px;border-bottom:1px solid var(--border-color,rgba(255,255,255,0.1));">
            <h2 style="margin:0;font-size:1.3rem;color:var(--primary-color);"><i class="fas fa-magic"></i> Categorização Inteligente</h2>
          </div>
          <div style="padding:20px 20px 10px 20px;text-align:center;">
            <p style="margin:0 0 8px 0;font-size:1.05rem;line-height:1.5;">
              Encontramos <strong>${matches.length}</strong> outros lançamentos passados com o nome <em>"${originalDescription}"</em>.
            </p>
            <p style="margin:0;color:var(--text-secondary);font-size:0.95rem;">
              Desmarque aqueles que <strong>NÃO</strong> pertencem a <strong>${fb.name}</strong>:
            </p>
          </div>
          
          <div style="overflow-y:auto;flex:1;border-top:1px solid var(--border-color,rgba(255,255,255,0.05));border-bottom:1px solid var(--border-color,rgba(255,255,255,0.05));">
            ${listHtml}
          </div>

          <div style="padding:20px;display:flex;justify-content:space-between;gap:12px;background:var(--bg-primary);">
            <button class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('${overlayId}').remove()">Cancelar</button>
            <button class="btn btn-primary" style="flex:1;background:var(--income-color,#10B981);" onclick="executeBulkLink('${fb.id}')">
              <i class="fas fa-check-double"></i> Atualizar Selecionados
            </button>
          </div>
        </div>
      </div>
    `;
    const temp = document.createElement('div');
    temp.innerHTML = modalHtml;
    document.body.appendChild(temp.firstElementChild);
  }
};

window.executeBulkLink = async (fixedBillId) => {
  const overlay = document.getElementById('bulk-link-modal-overlay');
  if (!overlay) return;
  
  const selectedIds = Array.from(overlay.querySelectorAll('.bulk-match-checkbox:checked')).map(cb => cb.value);
  overlay.remove();

  if (selectedIds.length === 0) return;
  
  const fb = state.fixedBills.find(f => f.id === fixedBillId);
  if (!fb) return;

  showToast('Categorizando...', 'Atualizando transações em lote...', 'info');
  
  try {
    const promises = selectedIds.map(txId => {
      const tx = state.transactions.find(t => t.id === txId);
      if (!tx) return Promise.resolve();
      
      const updatedTx = {
        ...tx,
        description: fb.name, 
        category: fb.category || 'Outros',
        fixedBillId: fb.id,
        isPaid: true
      };
      return saveTransaction(updatedTx, tx.id);
    });
    
    await Promise.all(promises);
    showToast('Concluído!', `${selectedIds.length} lançamentos vinculados com sucesso!`, 'success');
    await loadAllData();
  } catch (e) {
    showToast('Erro', 'Ocorreu um erro ao categorizar.', 'error');
  }
};

// ============================
// CSV Export Functions
// ============================
function downloadCSV(filename, csvContent) {
  // BOM for UTF-8 encoding in Excel
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportTransactionsCSV() {
  if (state.transactions.length === 0) {
    showToast('Sem dados', 'Nenhuma transação para exportar.', 'warning');
    return;
  }
  const header = 'Data;Descrição;Categoria;Tipo;Valor;Conta;Pago;Criado por\n';
  const rows = state.transactions.map(t => {
    const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    const acc = state.accounts.find(a => a.id === t.accountId);
    return [
      d.toLocaleDateString('pt-BR'),
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${t.category}"`,
      t.type,
      t.amount.toFixed(2).replace('.', ','),
      `"${acc?.name || '-'}"`,
      t.isPaid ? 'Sim' : 'Não',
      `"${t.createdByName || '-'}"`
    ].join(';');
  }).join('\n');
  downloadCSV('nossagrana_transacoes.csv', header + rows);
  showToast('Exportado!', `${state.transactions.length} transações exportadas.`, 'success');
}

function exportAccountsCSV() {
  if (state.accounts.length === 0) {
    showToast('Sem dados', 'Nenhuma conta para exportar.', 'warning');
    return;
  }
  const header = 'Nome;Tipo;Saldo Inicial;Saldo Atual\n';
  const rows = state.accounts.map(a => {
    return [
      `"${a.name}"`,
      a.type,
      (a.initialBalance || 0).toFixed(2).replace('.', ','),
      (a.currentBalance || 0).toFixed(2).replace('.', ',')
    ].join(';');
  }).join('\n');
  downloadCSV('nossagrana_contas.csv', header + rows);
  showToast('Exportado!', `${state.accounts.length} contas exportadas.`, 'success');
}

function exportGoalsCSV() {
  if (state.goals.length === 0) {
    showToast('Sem dados', 'Nenhuma meta para exportar.', 'warning');
    return;
  }
  const header = 'Nome;Meta;Atual;Progresso;Conta Vinculada\n';
  const rows = state.goals.map(g => {
    const linkedAccount = g.linkedAccountId ? state.accounts.find(a => a.id === g.linkedAccountId) : null;
    const currentAmount = linkedAccount ? (linkedAccount.currentBalance || 0) : (g.current || 0);
    const pct = Math.min((currentAmount / g.target) * 100, 100).toFixed(1);
    return [
      `"${g.name}"`,
      g.target.toFixed(2).replace('.', ','),
      currentAmount.toFixed(2).replace('.', ','),
      `${pct}%`,
      `"${linkedAccount?.name || 'Manual'}"`
    ].join(';');
  }).join('\n');
  downloadCSV('nossagrana_metas.csv', header + rows);
  showToast('Exportado!', `${state.goals.length} metas exportadas.`, 'success');
}

// ============================
// Danger Zone Handlers
// ============================
async function handleResetData() {
  if (!confirm('⚠️ ATENÇÃO: Isso irá apagar TODAS as transações, contas, orçamentos, metas e contas fixas da família.\n\nEsta ação NÃO pode ser desfeita!\n\nDeseja continuar?')) return;
  if (!confirm('Tem certeza ABSOLUTA? Todos os dados financeiros serão perdidos permanentemente.')) return;

  try {
    await resetFamilyData(state.familyId);
    showToast('Dados limpos', 'Todos os dados financeiros foram removidos.', 'success');
    await loadAllData();
  } catch (err) {
    console.error(err);
    showToast('Erro', 'Não foi possível limpar os dados.', 'error');
  }
}

async function handleRemoveDuplicates() {
  await cleanCreditCardDuplicates(null);
}

async function handleDeleteAccount() {
  if (!confirm('⚠️ ATENÇÃO: Isso irá DELETAR PERMANENTEMENTE sua conta de usuário.\n\nSe você faz parte de um casal, seu parceiro(a) manterá o acesso.\n\nDeseja continuar?')) return;
  if (!confirm('Tem certeza ABSOLUTA? Sua conta será removida para sempre.')) return;

  try {
    if (auth && auth.currentUser) {
      // Remove user from family members
      if (state.family && state.family.members) {
        const newMembers = state.family.members.filter(uid => uid !== state.user.uid);
        await updateFamily(state.familyId, { members: newMembers });
      }
      await auth.currentUser.delete();
      showToast('Conta deletada', 'Sua conta foi removida.', 'success');
    } else {
      showToast('Modo Demo', 'Exclusão de conta não disponível no Modo Demo.', 'warning');
    }
  } catch (err) {
    console.error(err);
    if (err.code === 'auth/requires-recent-login') {
      showToast('Login necessário', 'Por segurança, saia e faça login novamente antes de deletar.', 'error');
    } else {
      showToast('Erro', 'Não foi possível deletar a conta.', 'error');
    }
  }
}

window.showInvoiceModal = function(accountId, forcedCycleKey = null) {
  const acc = state.accounts.find(a => a.id === accountId);
  if (!acc) return;

  const txs = [...state.transactions.filter(t => t.accountId === accountId)];
  
  // Incluir saldo inicial como despesa/receita invisível no passado
  const initialVal = (acc.initialBalance || 0) + (acc.initialAdjustment || 0);
  if (Math.abs(initialVal) > 0.01) {
    txs.push({
      id: 'initial_balance_dummy',
      description: 'Saldo Inicial Original',
      amount: Math.abs(initialVal),
      type: initialVal < 0 ? 'despesa' : 'receita',
      date: new Date(2000, 0, 1), // Muito no passado para cair na primeira fatura
      isPaid: false
    });
  }

  // Determinar faturas
  const invoices = {};
  const currentMonthDate = new Date();
  const closingDay = acc.closingDay || 1;
  const currentDay = currentMonthDate.getDate();

  const getCycleKey = (date) => {
    const m = date.toLocaleString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '');
    const y = date.getFullYear().toString().slice(2);
    return `${m} ${y}`;
  };

  const formatExtMonth = (date) => {
    const m = date.toLocaleString('pt-BR', { month: 'long' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  };

  txs.forEach(t => {
    const txDate = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    
    let cycleMonthDate = new Date(txDate.getFullYear(), txDate.getMonth(), closingDay);
    if (txDate.getDate() >= closingDay) {
        cycleMonthDate.setMonth(cycleMonthDate.getMonth() + 1);
    }
    
    const cycleKey = getCycleKey(cycleMonthDate);
    const timeValue = cycleMonthDate.getTime();

    if (!invoices[cycleKey]) {
      invoices[cycleKey] = {
        key: cycleKey,
        time: timeValue,
        txs: [],
        total: 0
      };
    }

    invoices[cycleKey].txs.push(t);
    
    let amt = t.amount;
    if (typeof amt === 'string') {
        amt = parseFloat(amt.replace(',', '.').replace(/[^0-9.-]/g, ''));
    }
    amt = Number(amt) || 0;
    
    // Identificar se a receita é um pagamento de fatura (para não subtrair do total de compras do mês)
    const descLower = (t.description || t.name || '').toLowerCase();
    const isPayment = t.type === 'receita' && (descLower.includes('pagamento') || descLower.includes('fatura') || descLower.includes('recebido'));
    
    // Para o histórico de faturas, mostramos o tamanho total da fatura (todas as despesas do mês)
    if (!isPayment) {
        // IMPORTANTE: Se não for estritamente 'receita', soma como despesa. 
        // Transações mal formadas ou antigas podem não ter t.type == 'despesa'
        const amountToSum = t.type === 'receita' ? -amt : amt;
        invoices[cycleKey].total += amountToSum;
    }
  });

  const baseCurrentCycle = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth(), closingDay);
  if (currentDay >= closingDay) baseCurrentCycle.setMonth(baseCurrentCycle.getMonth() + 1);
  const currentCycleTime = baseCurrentCycle.getTime();
  const currentCycleKey = getCycleKey(baseCurrentCycle);
  if (!invoices[currentCycleKey]) {
     invoices[currentCycleKey] = {
        key: currentCycleKey,
        time: currentCycleTime,
        txs: [],
        total: 0
     };
  }

  // Não sobrescrevemos o total com dívidas abertas/fechadas porque queremos
  // que a barra mostre o tamanho histórico exato da fatura, não o quanto falta pagar.


  let invoiceList = Object.values(invoices).sort((a, b) => a.time - b.time);
  
  const maxTotal = Math.max(...invoiceList.map(i => Math.abs(i.total)), 1);
  let selectedIdx = invoiceList.findIndex(i => i.key === currentCycleKey);
  if (forcedCycleKey) {
    const forcedIdx = invoiceList.findIndex(i => i.key === forcedCycleKey);
    if (forcedIdx !== -1) selectedIdx = forcedIdx;
  } else if (selectedIdx === -1) {
    selectedIdx = invoiceList.length - 1;
  }

  let modal = document.getElementById('invoice-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'invoice-modal';
    modal.className = 'modal-container hidden';
    
    // Create the static skeleton
    modal.innerHTML = `
      <style>
        #invoice-bars-container::-webkit-scrollbar { display: none; }
        #invoice-bars-container { -ms-overflow-style: none; scrollbar-width: none; }
      </style>
      <div class="modal-content" style="max-width: 500px; width:100%; height: 95vh; display:flex; flex-direction:column; padding:0; overflow:hidden; border-radius:16px;">
        <div style="padding: 24px 24px 16px;">
           <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
             <h3 style="margin:0; font-size:1.1rem; font-weight:600; display:flex; align-items:center; gap:16px;">
               <button onclick="closeModal('invoice-modal')" style="background:none; border:none; font-size:1.2rem; cursor:pointer; color:var(--text-primary); padding:0;"><i class="fas fa-chevron-left"></i></button>
               Fatura
             </h3>
           </div>
           
           <div style="margin-bottom:8px;">
              <span id="invoice-status-label" style="font-size:1.0rem; font-weight:700;"></span>
           </div>
           
           <div id="invoice-total" style="font-size:2.4rem; font-weight:900; color:var(--text-primary); margin-bottom:12px; letter-spacing:-0.5px;">
           </div>
           
           <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.6; font-weight:500;">
              <div>Vencimento • <span id="invoice-dueDate"></span></div>
              <div>Fechamento • <span id="invoice-closeDate"></span></div>
           </div>
        </div>
        
        <div id="invoice-bars-container" style="display:flex; gap:6px; padding:10px 16px 0 16px; overflow-x:auto; border-bottom: 1px solid rgba(128,128,128,0.15); scroll-snap-type: x mandatory; scroll-behavior: smooth;">
        </div>

        <div style="flex:1; overflow-y:auto; padding:0 24px 24px;">
          <div id="invoice-tx-list" style="margin-top:20px;">
          </div>
        </div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal('invoice-modal');
    });
    document.body.appendChild(modal);
  }

  window._selectInvoiceCycle = function(idx) {
    selectedIdx = idx;
    _renderInvoiceModalContent(false);
  };

  window._renderInvoiceModalContent = function(isInitialLoad = true) {
    const inv = invoiceList[selectedIdx];
    
    // Sort transactions by date (newest first)
    inv.txs.sort((a, b) => {
      const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
      const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
      return db.getTime() - da.getTime();
    });

    const isCurrent = inv.time === currentCycleTime;
    const isPast = inv.time < currentCycleTime;
    
    // Verificar se a fatura passada está inteiramente paga
    const unpaidTxs = inv.txs.filter(t => !t.isPaid && t.id !== 'initial_balance_dummy');
    const isPaid = isPast && unpaidTxs.length === 0 && inv.txs.length > 0;
    
    let statusLabel = isCurrent ? 'Fatura atual' : (isPast ? (isPaid ? 'Fatura paga' : 'Fatura fechada') : 'Fatura futura');
    let colorClass = isCurrent ? 'var(--info-color, #00A3FF)' : (isPast ? (isPaid ? 'var(--income-color, #00C853)' : 'var(--danger-color, #FF3B30)') : 'var(--warning-color)');

    const invDate = new Date(inv.time); 
    const fechamentoStr = `${acc.closingDay} de ${formatExtMonth(invDate)}`;

    let dueDate = new Date(inv.time); 
    dueDate.setDate(acc.dueDay || acc.closingDay);
    if ((acc.dueDay || acc.closingDay) < acc.closingDay) {
        dueDate.setMonth(dueDate.getMonth() + 1);
    }
    const vencimentoStr = `${acc.dueDay || acc.closingDay} de ${formatExtMonth(dueDate)}`;

    const txHTML = inv.txs.length === 0 ? '<p style="text-align:center; margin-top:30px; color:var(--text-secondary);">Nenhuma transação nesta fatura.</p>' : 
      inv.txs.map(t => {
        const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        const instInfo = t.installmentInfo ? ` <span style="font-size:0.75rem; color:var(--text-secondary);">(${t.installmentInfo.current}/${t.installmentInfo.total})</span>` : '';
        const dayStr = String(d.getDate()).padStart(2, '0');
        const monthStr = d.toLocaleString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '');
        
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 0; border-bottom:1px solid rgba(128,128,128,0.15);">
            <div style="display:flex; gap:16px; align-items:center;">
              <div style="font-size:0.75rem; color:var(--text-secondary); width:40px; text-align:left; line-height:1.3; font-weight:600;">
                <span style="font-size:0.9rem; font-weight:bold; color:var(--text-primary);">${dayStr}</span><br/>${monthStr}
              </div>
              <div style="font-weight:600; font-size:1rem; color:var(--text-primary);">
                ${t.description || t.name || 'Sem Descrição'}${instInfo}
              </div>
            </div>
            <div style="font-weight:600; font-size:1rem; color:${t.type === 'receita' ? 'var(--income-color)' : 'var(--text-primary)'};">
              ${t.type === 'receita' ? '' : ''}${formatCurrency(t.amount)}
            </div>
          </div>
        `;
      }).join('');

    const elStatusLabel = document.getElementById('invoice-status-label');
    const elTotal = document.getElementById('invoice-total');
    const elDueDate = document.getElementById('invoice-dueDate');
    const elCloseDate = document.getElementById('invoice-closeDate');
    const elBars = document.getElementById('invoice-bars-container');
    const elTxList = document.getElementById('invoice-tx-list');
    
    if (elStatusLabel) {
      elStatusLabel.textContent = statusLabel;
      elStatusLabel.style.color = colorClass;
    }
    if (elTotal) elTotal.textContent = formatCurrency(inv.total);
    if (elDueDate) elDueDate.textContent = vencimentoStr;
    if (elCloseDate) elCloseDate.textContent = fechamentoStr;
    
    // Only build DOM fully if initial load or empty, otherwise just update visual state
    if (forcedCycleKey) {
        if (elBars) elBars.style.display = 'none';
    } else {
        if (elBars) elBars.style.display = 'flex';
        if (elBars && (isInitialLoad || elBars.children.length === 0)) {
            const barsHTML = invoiceList.map((item, idx) => {
              const heightPct = Math.max((Math.abs(item.total) / maxTotal) * 100, 2); 
              const isSel = idx === selectedIdx;
              const isCurrentCycle = item.time === currentCycleTime;
              const opacity = isSel ? '1' : '0.4';
              const weight = isSel ? '800' : '600';
              const textColor = isSel ? 'var(--text-primary)' : 'var(--text-secondary)';
              
              return `
                <div onclick="_selectInvoiceCycle(${idx})" style="flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:8px; cursor:pointer; min-width:64px; scroll-snap-align: center;">
                  <div style="height: 100px; width: 100%; display:flex; align-items:flex-end; justify-content:center;">
                     <div class="inv-bar" style="height: ${heightPct}%; width: 44px; background-color: var(--primary-500); opacity: ${opacity}; border-radius: 6px 6px 0 0; transition: height 0.3s, opacity 0.3s;"></div>
                  </div>
                  <div class="inv-label" style="font-size:0.75rem; font-weight:${weight}; color:${textColor}; padding-bottom: 8px; text-align:center; min-height: 28px; line-height: 1.2; transition: color 0.3s;">
                    ${item.key}
                    ${isCurrentCycle ? '<br><span style="font-size:0.6rem; font-weight:700; color:var(--primary-color);">atual</span>' : ''}
                  </div>
                </div>
              `;
            }).join('');
            elBars.innerHTML = barsHTML;
        } else if (elBars) {
            // Just update existing bars visually to avoid DOM thrashing and blinking
            Array.from(elBars.children).forEach((child, idx) => {
                const isSel = idx === selectedIdx;
                const bar = child.querySelector('.inv-bar');
                const label = child.querySelector('.inv-label');
                if (bar) bar.style.opacity = isSel ? '1' : '0.4';
                if (label) {
                    label.style.fontWeight = isSel ? '800' : '600';
                    label.style.color = isSel ? 'var(--text-primary)' : 'var(--text-secondary)';
                }
            });
        }
    }

    if (elTxList) elTxList.innerHTML = txHTML;

    setTimeout(() => {
       const container = document.getElementById('invoice-bars-container');
       if (container && container.children[selectedIdx]) {
          const selectedEl = container.children[selectedIdx];
          const scrollPos = selectedEl.offsetLeft - (container.clientWidth / 2) + (selectedEl.clientWidth / 2);
          container.scrollTo({ left: scrollPos, behavior: isInitialLoad ? 'auto' : 'smooth' });
       }
    }, 50);
  };

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal('invoice-modal');
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  _renderInvoiceModalContent();
  openModal('invoice-modal');
};

window.showToast = showToast;

// ============================
// UI Helpers
// ============================
function showAuthScreen() {
  document.getElementById('auth-container')?.classList.remove('hidden');
  document.getElementById('main-content')?.classList.add('hidden');
  document.getElementById('loader')?.classList.add('hidden');
}

function showMainApp() {
  document.getElementById('auth-container')?.classList.add('hidden');
  document.getElementById('main-content')?.classList.remove('hidden');
  document.getElementById('loader')?.classList.add('hidden');
}

function getAuthError(code) {
  const msgs = {
    'auth/email-already-in-use': 'Este email já está em uso.',
    'auth/invalid-email': 'Email inválido.',
    'auth/weak-password': 'Senha muito fraca (mín. 6 caracteres).',
    'auth/user-not-found': 'Email ou senha incorretos.',
    'auth/wrong-password': 'Email ou senha incorretos.',
    'auth/invalid-credential': 'Email ou senha incorretos.'
  };
  return msgs[code] || 'Ocorreu um erro. Tente novamente.';
}

// ============================
// PWA Installation Setup
// ============================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Update UI to notify the user they can install the PWA
  const installCard = document.getElementById('pwa-install-card');
  if (installCard) {
    installCard.style.display = 'block';
  }
});

function initPWAInfo() {
  const installBtn = document.getElementById('install-app-btn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      // Hide the UI
      const installCard = document.getElementById('pwa-install-card');
      if (installCard) installCard.style.display = 'none';
      if (!deferredPrompt) return;
      // Show the install prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      deferredPrompt = null;
    });
  }

  // Registra Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      console.log('SW Registrado:', reg.scope);
    }).catch(err => {
      console.log('SW Falha no registro:', err);
    });
  }
}

// ============================
// Init
// ============================

function init() {
  if (!isFirebaseConfigured()) {
    document.getElementById('setup-container').classList.remove('hidden');
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('setup-form')?.addEventListener('submit', handleSetupForm);
    return;
  }

  // Carregar tema
  const saved = localStorage.getItem('nossagrana_theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  initNavigation();
  initAuth();
  initPWAInfo();
  initNotificationsUI();
}

// ============================
// Notifications UI Hook
// ============================
function initNotificationsUI() {
  const panel = document.getElementById('notifications-panel');
  document.getElementById('notifications-btn')?.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    // Marcar visiveis como lidas
    if (!panel.classList.contains('hidden') && state.user?.uid) {
      markAsRead(null, state.user.uid);
    }
  });
  document.getElementById('close-notifications-btn')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });
}

function renderNotifications(notifications, hasNewUnread) {
  state.notifications = notifications;
  const badge = document.getElementById('notifications-badge');
  const panel = document.getElementById('notifications-panel');
  
  if (hasNewUnread || notifications.some(n => !n.isRead)) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  const listEl = document.getElementById('notifications-list');
  if (notifications.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding: 30px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;">
        <i class="fas fa-check-circle" style="font-size: 2.5rem; color: var(--primary-200); opacity: 0.5;"></i>
        <p style="text-align:center; color: var(--text-secondary); margin: 0; font-size: 0.9rem;">Nenhuma notificação por enquanto.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = notifications.map(n => `
    <div class="notification-item ${n.isRead ? '' : 'unread'}" data-id="${n.id}">
      <div class="notification-title">${n.title}</div>
      <div class="notification-body">${n.body}</div>
      <span class="notification-time">${formatDate(n.createdAt?.toDate ? n.createdAt.toDate() : new Date(n.createdAt))}</span>
    </div>
  `).join('');

  listEl.querySelectorAll('.notification-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const notif = notifications.find(x => x.id === id);
      if (notif && !notif.isRead) {
        await markAsRead(id);
      }
      panel.classList.add('hidden');
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
