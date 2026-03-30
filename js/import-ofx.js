// js/import-ofx.js — Parser de CSV/OFX para importação de extratos bancários
// Suporta: Nubank Conta (Data,Valor,Identificador,Descrição)
//          Nubank Cartão (date,title,amount)
//          OFX genérico
//          CSV genérico com detecção automática

import { showToast, formatCurrency } from './utils.js';

function getMethodLabel(method) {
  const labels = {
    pix: 'PIX', credito: 'Crédito', debito: 'Débito',
    transferencia: 'TED/DOC', outros: 'Outros'
  };
  return labels[method] || method;
}

function cleanDescription(desc) {
  if (!desc) return '';
  let clean = desc.trim();
  
  // Tenta capturar o padrão de parcelamento para não perdê-lo na limpeza (ex: Parcela 1/15 ou 1/15)
  // Refinado para buscar no final da string com ou sem hífens
  const installmentMatch = clean.match(/(?:\s+-\s+)?(?:Parcela\s+)?\d+\/\d+$/i);
  
  // Limpeza padrão Nubank: "Tipo - Nome - CPF - Instituição" -> "Tipo - Nome"
  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    if (parts.length > 2) {
      // Se tivermos mais de 2 partes (ex: "Assinatura - Netflix - Conta X"), pegamos as duas primeiras
      clean = parts.slice(0, 2).join(' - ');
      
      // Se perdemos o parcelamento no processo, recuperamos ele
      if (installmentMatch && !clean.toLowerCase().includes(installmentMatch[0].toLowerCase().trim())) {
        clean += ' - ' + installmentMatch[0].replace(/^[-\s]+/, '').trim();
      }
    }
  }
  return clean;
}

/**
 * Detecta método de pagamento por palavras-chave na descrição
 */
function detectPaymentMethod(desc) {
  const d = (desc || '').toLowerCase();
  
  // 1. Pix é prioridade
  if (d.includes('pix')) return 'pix';
  
  // 2. Transferências (TED/DOC/Internas)
  if (d.includes('ted') || d.includes('doc') || d.includes('transferência') || d.includes('transferencia')) return 'transferencia';
  
  // 3. Cartão de Débito (Compras em pontos de venda com cartão)
  if (d.includes('débito') || d.includes('debito')) return 'debito';
  if (d.includes('boleto')) return 'debito'; // Pagamento de boletos costumam ser saídas da conta (débito)
  
  // 4. Cartão de Crédito ou operações de crédito específicas
  if (d.includes('cartão') || d.includes('cartao') || d.includes('crédito') || d.includes('credito') || d.includes('nupay') || d.includes('parcela')) return 'credito';
  
  return 'outros';
}

/**
 * Inicializa módulo de importação
 */
export function initImport(onImport, getAccounts, getTransactions, getFamilyProfiles, getCurrentUserId) {
  const fileInput = document.getElementById('import-file-input');
  const fileNameEl = document.getElementById('import-file-name');
  const previewEl = document.getElementById('import-preview');

  fileInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    fileNameEl.textContent = files.length === 1 ? files[0].name : `${files.length} arquivos selecionados`;
    let allTransactions = [];

    for (const file of files) {
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        const text = await file.text();
        let transactions = [];

        if (ext === 'csv') {
          transactions = parseCSV(text, file.name);
        } else if (ext === 'ofx') {
          transactions = parseOFX(text);
        } else {
          showToast('Formato ignorado', `${file.name} não é .csv ou .ofx`, 'warning');
          continue;
        }

        allTransactions = allTransactions.concat(transactions);
      } catch (err) {
        console.error('Import error on file:', file.name, err);
        showToast('Erro ao ler', `Falha ao processar ${file.name}`, 'error');
      }
    }

    if (allTransactions.length === 0) {
      showToast('Nenhuma transação', 'Os arquivos não continham dados válidos', 'warning');
      previewEl.classList.add('hidden');
      fileInput.value = '';
      return;
    }

    if (getTransactions) {
      const existing = getTransactions();
      const dbCounts = new Map(); // "key|date" -> count
      const dbInstallments = new Set(); // "base|amount|current/total" -> exists
      
      const normalizeDesc = (desc) => {
        if (!desc) return '';
        return desc.toLowerCase()
                   .replace(/ - parcela \d+\/\d+$/i, '')
                   .replace(/ - \d+\/\d+$/i, '')
                   .replace(/^cartão - /, '')
                   .replace(/^nupay - /, '')
                   .replace(/parcela \d+\/\d+/i, '')
                   .replace(/\s+/g, '') // remove todos espaços para match forçado
                   .trim();
      };

      for (const ex of existing) {
        const exDate = ex.date?.toDate ? ex.date.toDate() : new Date(ex.date);
        const normBase = normalizeDesc(ex.description);
        const amountCents = Math.round(ex.amount * 100);
        const dStr = `${exDate.getFullYear()}-${exDate.getMonth()}-${exDate.getDate()}`;

        // Mapa de contagem para o mesmo dia/valor/nome (Pizzinhas)
        const dayKey = `${ex.type}|${amountCents}|${dStr}|${normBase}`;
        dbCounts.set(dayKey, (dbCounts.get(dayKey) || 0) + 1);
        
        // Registro global de parcelas (Pichaus)
        const isInstallment = (ex.description && (ex.description.includes('/') || ex.installmentInfo));
        if (isInstallment) {
            const instMatch = ex.description.match(/(\d+\/\d+)$/);
            const instCount = instMatch ? instMatch[1] : (ex.installmentInfo ? `${ex.installmentInfo.current}/${ex.installmentInfo.total}` : '1/1');
            const cleanInstCount = instCount.replace(/^0+/, '').replace(/\/0+/, '/'); 
            const instKey = `INST|${normBase}|${amountCents}|${cleanInstCount}`;
            dbInstallments.add(instKey);
        }
      }

      const family = getFamilyProfiles ? getFamilyProfiles() : null;
      const importCounts = new Map(); // Rastreador local para o lote atual

      allTransactions = allTransactions.map(t => {
        const cat = suggestCategory(t.description, family);
        let isDuplicate = false;
        
        const normBase = normalizeDesc(t.description);
        const amountCents = Math.round(t.amount * 100);
        const tDate = t.date instanceof Date ? t.date : new Date(t.date);
        const dStr = `${tDate.getFullYear()}-${tDate.getMonth()}-${tDate.getDate()}`;

        const isInstallment = t.description.includes('/') || t.installmentInfo;
        
        if (isInstallment && (t.paymentMethod === 'credito' || t.description.startsWith('Cartão') || t.description.toLowerCase().includes('nupay'))) {
          // Lógica de Parcelas: NÃO DEPENDE DE DATA
          const instMatch = t.description.match(/(\d+\/\d+)$/);
          const instCount = instMatch ? instMatch[1] : (t.installmentInfo ? `${t.installmentInfo.current}/${t.installmentInfo.total}` : '1/1');
          const cleanInstCount = instCount.replace(/^0+/, '').replace(/\/0+/, '/');
          const instKey = `INST|${normBase}|${amountCents}|${cleanInstCount}`;
          
          isDuplicate = dbInstallments.has(instKey) || importCounts.has(instKey);
          if (!isDuplicate) importCounts.set(instKey, true); 
        } else {
          // Lógica de Contador (Pizzinhas): Mente aberta para múltiplas compras no mesmo dia
          const dayKey = `${t.type}|${amountCents}|${dStr}|${normBase}`;
          const currentInBatch = (importCounts.get(dayKey) || 0) + 1;
          const alreadyInDB = dbCounts.get(dayKey) || 0;

          // Só é duplicata se a "ocorrência X" no arquivo já existir no DB
          if (currentInBatch <= alreadyInDB) {
            isDuplicate = true;
          }
          
          importCounts.set(dayKey, currentInBatch);
        }

        return { ...t, category: cat, isDuplicate };
      });
    }

    // Show preview
    try {
      renderPreview(previewEl, allTransactions, onImport, getAccounts, getFamilyProfiles, getCurrentUserId);
      previewEl.classList.remove('hidden');
      
      const fileNamesList = files.map(f => f.name).join(', ');
      showToast(`${allTransactions.length} transações encontradas`, `Lidos com sucesso: ${fileNamesList}`, 'info');
    } catch (err) {
      console.error('Preview render error:', err);
      showToast('Erro de interface', 'Falha ao gerar preview.', 'error');
    }

    // Reset file input so same files can be re-selected
    fileInput.value = '';
  });
}

/**
 * Parse CSV — detecta tipo automaticamente
 */
function parseCSV(text, filename) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const rows = lines.slice(1);

  // --- TIPO 1: Nubank Cartão de Crédito ---
  // header: date,title,amount
  if (header.includes('date') && header.includes('title') && header.includes('amount')) {
    return parseNubankCard(rows);
  }

  // --- TIPO 2: Nubank Conta/PIX ---
  // header: Data,Valor,Identificador,Descrição  (ou data,valor,identificador,descrição)
  if (header.includes('data') && header.includes('valor') && header.includes('descri')) {
    return parseNubankAccount(rows);
  }

  // --- TIPO 3: CSV Genérico ---
  // Tenta detectar colunas por posição
  return parseGenericCSV(lines);
}

/**
 * Nubank Cartão: date,title,amount
 */
function parseNubankCard(rows) {
  const txs = [];
  for (const row of rows) {
    const parts = splitCSVRow(row);
    if (parts.length < 3) continue;

    const [dateStr, title, amountStr] = parts;
    if (!dateStr || !amountStr) continue;

    try {
      const date = parseDate(dateStr.trim());
      const rawVal = parseFloat(amountStr.replace(',', '.'));
      if (isNaN(rawVal) || rawVal === 0) continue;

      const type = rawVal < 0 ? 'receita' : 'despesa'; // valores negativos no cartão são estornos/créditos
      const amount = Math.abs(rawVal);
      const titleTrimmed = title.trim();
      const titleLower = titleTrimmed.toLowerCase();
      const descFinal = `Cartão - ${titleTrimmed}`;

      // ==========================================
      // Detecção de operações de FATURA (Nubank)
      // ==========================================
      
      // 1. "Parcelamento de Fatura (data)" — crédito que quita a fatura anterior
      //    Ex: "Parcelamento de Fatura (23/Março)" com valor NEGATIVO
      const isParcelamentoCredit = titleLower.includes('parcelamento de fatura') && 
                                    !titleLower.match(/\d+\/\d+$/) && // NÃO é parcela X/Y
                                    rawVal < 0;
      
      // 2. "Pagamento recebido" — pagamento feito pelo usuário na fatura anterior
      const isPagamentoRecebido = titleLower.includes('pagamento recebido') && rawVal < 0;

      if (isParcelamentoCredit || isPagamentoRecebido) {
        txs.push({
          date,
          description: descFinal,
          amount,
          type, // 'receita' (valor negativo = crédito no cartão)
          category: 'Pagamento de Fatura',
          original: `Fatura Nubank: ${titleTrimmed}`,
          paymentMethod: 'credito',
          invoicePayment: true // Flag: aplicar na fatura ANTERIOR, não na atual
        });
        continue;
      }

      // 3. "Parcelamento de Fatura (data) - X/Y" — parcela do refinanciamento
      //    Ex: "Parcelamento de Fatura (23/Março) - 1/3" com valor POSITIVO
      //    Tratar como compra parcelada NORMAL (gera parcelas futuras)
      const parcelamentoInstMatch = titleTrimmed.match(/^Parcelamento de Fatura.*? - (\d+)\/(\d+)$/i);
      if (parcelamentoInstMatch && type === 'despesa') {
        const current = parseInt(parcelamentoInstMatch[1]);
        const total = parseInt(parcelamentoInstMatch[2]);
        
        if (current >= 1 && total > 1 && total >= current) {
          txs.push({
            date: new Date(date),
            description: descFinal,
            amount,
            type,
            category: 'Parcelamento de Fatura',
            original: `Fatura Nubank: ${titleTrimmed}`,
            paymentMethod: 'credito',
            installmentInfo: { current, total, originalAmount: amount * total }
          });
          
          // Gerar parcelas futuras
          for (let i = current + 1; i <= total; i++) {
            const futureDate = new Date(date);
            futureDate.setMonth(futureDate.getMonth() + (i - current));
            
            const baseTitle = titleTrimmed.substring(0, titleTrimmed.length - parcelamentoInstMatch[0].length + titleTrimmed.indexOf(parcelamentoInstMatch[0])).replace(/ - \d+\/\d+$/, '').trim();
            const futureDesc = `Cartão - ${baseTitle} - ${i}/${total}`;
            
            txs.push({
              date: futureDate,
              description: futureDesc,
              amount,
              type,
              category: 'Parcelamento de Fatura',
              original: `Fatura Nubank (Auto-gerada): ${baseTitle} - ${i}/${total}`,
              paymentMethod: 'credito',
              installmentInfo: { current: i, total, originalAmount: amount * total }
            });
          }
          continue;
        }
      }

      // Detecção Automática de Parcelas (compras normais)
      const instMatch = titleTrimmed.match(/ - Parcela (\d+)\/(\d+)$/i) || titleTrimmed.match(/ - (\d+)\/(\d+)$/i);
      if (instMatch && type === 'despesa') {
         const current = parseInt(instMatch[1]);
         const total = parseInt(instMatch[2]);
         
         if (current >= 1 && total > 1 && total >= current) {
           txs.push({
             date: new Date(date),
             description: descFinal,
             amount,
             type,
             category: suggestCategory(descFinal),
             original: `Fatura Nubank: ${title.trim()}`,
             paymentMethod: 'credito',
             installmentInfo: { current, total, originalAmount: amount * total }
           });
           
           // Gera as parcelas futuras para comprometer o limite do cartão
           for (let i = current + 1; i <= total; i++) {
             const futureDate = new Date(date);
             futureDate.setMonth(futureDate.getMonth() + (i - current));
             
             // Cria o novo título com a contagem atualizada — mantendo formato consistente
             const baseTitle = title.trim().substring(0, title.trim().length - instMatch[0].length).trim();
             const futureDesc = `Cartão - ${baseTitle} - ${i}/${total}`;
             
             txs.push({
               date: futureDate,
               description: futureDesc,
               amount,
               type,
               category: suggestCategory(futureDesc),
               original: `Fatura Nubank (Auto-gerada): ${baseTitle} - ${i}/${total}`,
               paymentMethod: 'credito',
               installmentInfo: { current: i, total, originalAmount: amount * total }
             });
           }
           continue; 
         }
      }

      // Despesa comum do cartão
      txs.push({
        date,
        description: descFinal,
        amount,
        type,
        category: suggestCategory(descFinal),
        original: `Fatura Nubank: ${title.trim()}`,
        paymentMethod: 'credito'
      });
    } catch (e) { continue; }
  }
  return txs;
}

/**
 * Nubank Conta: Data,Valor,Identificador,Descrição
 */
function parseNubankAccount(rows) {
  const txs = [];
  for (const row of rows) {
    const parts = splitCSVRow(row);
    if (parts.length < 4) continue;

    const [dateStr, valorStr, _id, desc] = parts;
    if (!dateStr || !valorStr) continue;

    try {
      const date = parseDate(dateStr.trim());
      const rawVal = parseFloat(valorStr.replace(',', '.'));
      if (isNaN(rawVal) || rawVal === 0) continue;

      const type = rawVal > 0 ? 'receita' : 'despesa';
      const amount = Math.abs(rawVal);
      
      const cleanDesc = cleanDescription(desc);
      const paymentMethod = detectPaymentMethod(desc || '');

      txs.push({
        date,
        description: cleanDesc || 'Transação bancária',
        amount,
        type,
        category: suggestCategory(cleanDesc),
        original: `Extrato Nubank: ${desc?.trim() || ''}`,
        paymentMethod
      });
    } catch (e) { continue; }
  }
  return txs;
}

/**
 * CSV Genérico — tenta adivinhar colunas
 */
function parseGenericCSV(lines) {
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const rows = lines.slice(1);
  const txs = [];

  // Procura colunas por nome
  const dateIdx = header.findIndex(h => h.includes('data') || h.includes('date'));
  const amountIdx = header.findIndex(h => h.includes('valor') || h.includes('amount') || h.includes('value'));
  const descIdx = header.findIndex(h => h.includes('descri') || h.includes('title') || h.includes('memo'));

  if (dateIdx === -1 || amountIdx === -1) {
    showToast('Formato CSV não reconhecido', 'Precisa ter colunas de data e valor', 'error');
    return [];
  }

  for (const row of rows) {
    const parts = splitCSVRow(row);
    if (parts.length <= Math.max(dateIdx, amountIdx)) continue;

    try {
      const date = parseDate(parts[dateIdx].trim());
      const rawVal = parseFloat(parts[amountIdx].replace(/[R$\s]/g, '').replace(',', '.'));
      if (isNaN(rawVal) || rawVal === 0) continue;

      txs.push({
        date,
        description: cleanDescription(parts[descIdx]?.trim()) || 'Transação',
        amount: Math.abs(rawVal),
        type: rawVal > 0 ? 'receita' : 'despesa',
        category: suggestCategory(parts[descIdx]?.trim() || 'Transação'),
        original: row,
        paymentMethod: detectPaymentMethod(parts[descIdx]?.trim() || '')
      });
    } catch (e) { continue; }
  }
  return txs;
}

/**
 * Parse OFX (formato bancário padrão)
 */
function parseOFX(text) {
  const txs = [];
  const isCreditCard = text.includes('<CREDITCARDMSGSRSV1>') || text.includes('<CCSTMTTRNRS>');
  const stmtRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;

  while ((match = stmtRegex.exec(text)) !== null) {
    const block = match[1];
    const type = extractOFXTag(block, 'TRNTYPE');
    const dateStr = extractOFXTag(block, 'DTPOSTED');
    const amount = extractOFXTag(block, 'TRNAMT');
    const memo = extractOFXTag(block, 'MEMO');
    const name = extractOFXTag(block, 'NAME');

    if (!dateStr || !amount) continue;

    try {
      // OFX date: YYYYMMDDHHMMSS or YYYYMMDD
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

      const rawVal = parseFloat(amount.replace(',', '.'));
      if (isNaN(rawVal) || rawVal === 0) continue;

      const rawDesc = memo || name || type || 'Transação OFX';
      const cleanDesc = cleanDescription(rawDesc);
      const pm = isCreditCard ? 'credito' : detectPaymentMethod(rawDesc);

      // --- Detecção Automática de Parcelas (OFX) ---
      const instMatch = cleanDesc.match(/ - Parcela (\d+)\/(\d+)$/i) || 
                        cleanDesc.match(/ - (\d+)\/(\d+)$/i) ||
                        cleanDesc.match(/ Parcela (\d+)\/(\d+)$/i) ||
                        cleanDesc.match(/ (\d+)\/(\d+)$/i);

      if (instMatch && pm === 'credito' && rawVal < 0) {
        const current = parseInt(instMatch[1]);
        const total = parseInt(instMatch[2]);
        const amount = Math.abs(rawVal);

        if (current >= 1 && total > 1 && total >= current) {
          txs.push({
            date: new Date(date),
            description: cleanDesc,
            amount,
            type: 'despesa',
            category: suggestCategory(cleanDesc),
            original: `OFX: ${rawDesc}`,
            paymentMethod: 'credito',
            installmentInfo: { current, total, originalAmount: amount * total }
          });

          // Gera parcelas futuras
          for (let i = current + 1; i <= total; i++) {
            const futureDate = new Date(date);
            futureDate.setMonth(futureDate.getMonth() + (i - current));

            const baseDesc = cleanDesc.substring(0, cleanDesc.length - instMatch[0].length).trim();
            const futureDesc = `${baseDesc} - ${i}/${total}`;

            txs.push({
              date: futureDate,
              description: futureDesc,
              amount,
              type: 'despesa',
              category: suggestCategory(futureDesc),
              original: `OFX (Auto-gerada): ${baseDesc} - ${i}/${total}`,
              paymentMethod: 'credito',
              installmentInfo: { current: i, total, originalAmount: amount * total }
            });
          }
          continue;
        }
      }

      txs.push({
        date,
        description: cleanDesc,
        amount: Math.abs(rawVal),
        type: rawVal > 0 ? 'receita' : 'despesa',
        category: suggestCategory(cleanDesc),
        original: `OFX: ${memo || name || ''}`,
        paymentMethod: pm
      });
    } catch (e) { continue; }
  }
  return txs;
}

function extractOFXTag(block, tag) {
  const regex = new RegExp(`<${tag}>([^<\\n]+)`, 'i');
  const match = regex.exec(block);
  return match ? match[1].trim() : null;
}

/**
 * Parse data em vários formatos
 */
function parseDate(str) {
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/');
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }
  // Fallback
  const d = new Date(str);
  if (isNaN(d.getTime())) throw new Error('Data inválida: ' + str);
  return d;
}

/**
 * Split CSV row handling quoted fields
 */
function splitCSVRow(row) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Motor de sugestão de categorias
 * Usa word-boundary matching para evitar falsos positivos
 * (ex: "sorveteria" NÃO deve casar com "vet" -> Pets)
 */
function suggestCategory(description, familyProfiles = null) {
  const d = (description || '').toLowerCase();
  
  // 0. Identificar Parcelamento de Fatura (operação interna do cartão)
  if (d.includes('parcelamento de fatura')) {
    return 'Parcelamento de Fatura';
  }
  
  // 0b. Identificar Pagamento de Fatura (Transferência / Pagamento de cartão)
  if (d.includes('pagamento de fatura') || d.includes('pagamento da fatura') || d.includes('fatura paga') || d.includes('fatura nubank') || d.includes('pagamento recebido')) {
    return 'Pagamento de Fatura';
  }

  // 1. Identificar Transferências Internas (prioridade alta)
  if (d.includes('transferência') || d.includes('pix') || d.includes('ted') || d.includes('doc') || d.includes('pagamento')) {
    if (familyProfiles) {
      const profiles = Object.values(familyProfiles);
      for (const p of profiles) {
        if (!p.name) continue;
        const nameParts = p.name.toLowerCase().split(' ').filter(part => part.length > 2);
        if (nameParts.length === 0) continue;

        const firstName = nameParts[0];
        const surnames = nameParts.slice(1);

        const hasFirstName = d.includes(firstName);
        const hasAnySurname = surnames.length === 0 || surnames.some(s => d.includes(s));

        if (hasFirstName && hasAnySurname) {
          return 'Transferência Interna';
        }
      }
    }
    // Se não é para familiar mas é PIX/TED/DOC, sugerir "Transferência"
    if (d.includes('transferência') || d.includes('pix') || d.includes('ted') || d.includes('doc')) {
      return 'Transferência';
    }
  }

  // 2. Regras de palavras-chave (com word-boundary onde necessário)
  const rules = [
    // Transferências manuais
    { cat: 'Transferência', words: ['transferência', 'transf.', 'transferencia'] },
    // Alimentação — termos específicos primeiro
    { cat: 'Alimentação', words: ['mercado', 'supermercado', 'ifood', 'restaurante', 'padaria', 'confeitaria', 'mcdonalds', 'burger king', 'lanches', 'pizzaria', 'sorveteria', 'sorvete', 'banana split', 'zaffari', 'super madi', 'madi', 'fort atacadista', 'atacadão', 'condor', 'big', 'carrefour', 'assai'] },
    // Transporte
    { cat: 'Transporte', words: ['uber', '99app', '99taxis', 'posto', 'combustivel', 'gasolina', 'estacionamento', 'pedagio', 'metrô', 'onibus'] },
    // Compras Online
    { cat: 'Compras Online', words: ['shopee', 'amazon', 'mercadolivre', 'aliexpress', 'pichau', 'kabum', 'americanas', 'magazineluiza', 'magalu'] },
    // Lazer & Assinaturas
    { cat: 'Lazer/Assinaturas', words: ['netflix', 'spotify', 'disney', 'hbo', 'youtube', 'prime video', 'cinema', 'show', 'teatro', 'ingresso', 'eventim', 'ticketmaster', 'discord', 'nitro', 'steamgames', 'steam', 'google one', 'google play'] },
    // Saúde
    { cat: 'Saúde', words: ['farmacia', 'drogaria', 'hospital', 'medico', 'clinica', 'exame', 'odonto', 'dentista'] },
    // Educação
    { cat: 'Educação', words: ['escola', 'faculdade', 'curso', 'livraria', 'udemy'] },
    // Moradia
    { cat: 'Moradia', words: ['aluguel', 'condominio', 'luz', 'enel', 'agua', 'sabesp', 'gas natural', 'internet', 'claro', 'vivo', 'tim'] },
    // Beleza
    { cat: 'Beleza', words: ['salao', 'barbearia', 'cosmeticos', 'perfumaria', 'estetica'] },
    // Pets — usa regex com word boundary para evitar "sorveteria" casar com "vet"
    { cat: 'Pets', words: ['petshop', 'pet shop', 'veterinaria', 'cobasi', 'petz'], useWordBoundary: ['vet'] },
    // Investimentos
    { cat: 'Investimentos', words: ['aplicação rdb', 'rdb', 'cdb', 'tesouro', 'investimento', 'ação', 'fundo', 'corretora', 'poupança'] },
    // Taxas & Encargos
    { cat: 'Taxas/Encargos', words: ['iof', 'juros de atraso', 'juros de dívida', 'multa de atraso', 'tarifa', 'anuidade', 'encargo'] },
    // Salário
    { cat: 'Salário', words: ['salario', 'pro-labore', 'folha de pagamento', 'pagamento salario'] }
  ];

  for (const rule of rules) {
    // Check normal words (simple includes)
    if (rule.words.some(w => d.includes(w))) {
      return rule.cat;
    }
    // Check word-boundary words (regex)
    if (rule.useWordBoundary) {
      for (const w of rule.useWordBoundary) {
        const regex = new RegExp(`\\b${w}\\b`, 'i');
        if (regex.test(d)) {
          return rule.cat;
        }
      }
    }
  }

  return 'Importado';
}


/**
 * Renderiza preview das transações para importar
 */
function renderPreview(container, transactions, onImport, getAccounts, getFamilyProfiles, getCurrentUserId) {
  const total = transactions.reduce((s, t) => s + (t.type === 'receita' ? t.amount : -t.amount), 0);
  const income = transactions.filter(t => t.type === 'receita');
  const expense = transactions.filter(t => t.type === 'despesa');
  const duplicates = transactions.filter(t => t.isDuplicate);

  const invoicePayments = transactions.filter(t => t.invoicePayment);

  container.innerHTML = `
    <div class="card" style="margin-bottom:var(--space-md);">
      <h3 style="margin-bottom:var(--space-md);">📋 Pré-visualização (${transactions.length} transações)</h3>
      <div style="display:flex;gap:var(--space-lg);margin-bottom:var(--space-md);flex-wrap:wrap;">
        <span class="text-income"><b>${income.length}</b> receitas: <b>${formatCurrency(income.reduce((s,t)=>s+t.amount,0))}</b></span>
        <span class="text-expense"><b>${expense.length}</b> despesas: <b>${formatCurrency(expense.reduce((s,t)=>s+t.amount,0))}</b></span>
        <span><b>Saldo:</b> ${formatCurrency(total)}</span>
      </div>
      ${invoicePayments.length > 0 ? `
      <div style="background:rgba(59,130,246,0.1);border:1px solid #3b82f6;border-radius:8px;padding:12px 16px;margin-bottom:var(--space-md);">
        <span style="font-size:0.85rem;">
          <i class="fas fa-info-circle" style="color:#3b82f6;margin-right:6px;"></i>
          <b>${invoicePayments.length}</b> operação(ões) de fatura anterior detectada(s): 
          <b>${formatCurrency(invoicePayments.reduce((s,t)=>s+t.amount,0))}</b>.
          Serão importadas como <b>"já pagas"</b> para não afetar a fatura atual.
        </span>
      </div>
      ` : ''}
      ${duplicates.length > 0 ? `
      <div style="background:rgba(239,68,68,0.1);border:1px solid var(--expense-color);border-radius:8px;padding:12px 16px;margin-bottom:var(--space-md);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span style="font-size:0.85rem;">
          <i class="fas fa-exclamation-triangle" style="color:var(--expense-color);margin-right:6px;"></i>
          <b>${duplicates.length}</b> possíveis duplicatas encontradas (desmarcadas por padrão).
        </span>
        <button class="btn btn-secondary" id="import-keep-dupes-btn" style="font-size:0.75rem;padding:4px 12px;">
          <i class="fas fa-check-double"></i> Manter Ambos (marcar todos)
        </button>
      </div>
      ` : ''}
      <div class="table-container" style="max-height:350px;overflow-y:auto;">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" id="import-select-all" checked></th>
              <th>Data</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Tipo</th>
              <th>Método</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            ${transactions.map((t, i) => `
              <tr style="${t.isDuplicate ? 'opacity:0.6;' : ''}${t.invoicePayment ? 'background:rgba(59,130,246,0.08);' : ''}">
                <td><input type="checkbox" class="import-checkbox" data-idx="${i}" ${t.isDuplicate ? '' : 'checked'}></td>
                <td>${t.date.toLocaleDateString('pt-BR')}</td>
                <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${t.description}">
                  ${t.isDuplicate ? '<span style="background:var(--expense-color);color:#fff;padding:2px 6px;border-radius:4px;font-size:0.65rem;margin-right:6px;font-weight:bold;">Já existe</span>' : ''}
                  ${t.invoicePayment ? '<span style="background:#3b82f6;color:#fff;padding:2px 6px;border-radius:4px;font-size:0.65rem;margin-right:6px;font-weight:bold;" title="Pagamento/crédito aplicado à fatura anterior">📋 Fatura Ant.</span>' : ''}
                  ${t.description}
                </td>
                <td><span style="font-size:0.75rem;padding:2px 8px;border-radius:12px;background:var(--bg-tertiary);">${t.category || 'Importado'}</span></td>
                <td class="${t.type}">${t.type === 'receita' ? 'Receita' : 'Despesa'}</td>
                <td>${t.paymentMethod ? `<span class="payment-method-badge ${t.paymentMethod}">${getMethodLabel(t.paymentMethod)}</span>` : '-'}</td>
                <td class="${t.type}">${formatCurrency(t.amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:var(--space-md);display:flex;flex-direction:column;gap:8px;">
        <label for="import-account-select" style="font-weight:600;">Vincular à conta:</label>
        <div style="display:flex;gap:var(--space-sm);">
          <select id="import-account-select" style="flex:1;">
            <option value="">Selecione uma conta...</option>
            ${getAccounts ? getAccounts().map(a => `<option value="${a.id}">${a.name}</option>`).join('') : ''}
          </select>
          <button class="btn btn-secondary" id="import-new-account-btn" title="Criar nova conta">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      </div>
      <div style="margin-top:var(--space-sm);display:flex;flex-direction:column;gap:8px;">
        <label for="import-user-select" style="font-weight:600;">Quem realizou as transações?</label>
        <select id="import-user-select" style="width:100%;">
          ${getFamilyProfiles && getCurrentUserId ? 
            Object.entries(getFamilyProfiles()).map(([uid, prof]) => 
              `<option value="${uid}" ${uid === getCurrentUserId() ? 'selected' : ''}>${prof.name} ${uid === getCurrentUserId() ? '(você)' : ''}</option>`
            ).join('')
          : '<option value="">(Carregando usuários...)</option>'}
        </select>
      </div>
      <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-lg);">
        <button class="btn btn-primary" id="import-confirm-btn"><i class="fas fa-check"></i> Importar Selecionados</button>
        <button class="btn btn-secondary" id="import-cancel-btn"><i class="fas fa-times"></i> Cancelar</button>
      </div>
    </div>
  `;

  // Select all toggle
  document.getElementById('import-select-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.import-checkbox').forEach(cb => cb.checked = e.target.checked);
  });

  // Keep duplicates button
  document.getElementById('import-keep-dupes-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.import-checkbox').forEach(cb => cb.checked = true);
    showToast('Duplicatas marcadas', 'Todas as transações serão importadas', 'info');
  });

  // Cancel
  document.getElementById('import-cancel-btn')?.addEventListener('click', () => {
    container.classList.add('hidden');
    container.innerHTML = '';
  });

  // Create new account
  document.getElementById('import-new-account-btn')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-account-modal', {
      detail: { fromImport: true }
    }));
  });

  // Confirm import
  document.getElementById('import-confirm-btn')?.addEventListener('click', () => {
    const accountId = document.getElementById('import-account-select')?.value;
    const userId = document.getElementById('import-user-select')?.value;

    if (!accountId) {
      showToast('Conta necessária', 'Selecione uma conta para vincular as transações', 'warning');
      return;
    }

    const selectedIndices = [];
    document.querySelectorAll('.import-checkbox:checked').forEach(cb => {
      selectedIndices.push(parseInt(cb.dataset.idx));
    });

    const selectedTxs = selectedIndices.map(i => transactions[i]).filter(Boolean);
    if (selectedTxs.length === 0) {
      showToast('Nenhuma selecionada', 'Selecione pelo menos uma transação', 'warning');
      return;
    }

    onImport(selectedTxs, accountId, userId);
    container.classList.add('hidden');
    container.innerHTML = '';
  });
}
