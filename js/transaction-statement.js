import { formatCurrency } from './utils.js';

export function getTransactionSummary(transactions) {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of transactions) {
    const cents = Math.round(Number(t.amount) * 100);
    if (t.type === 'receita') incomeCents += cents;
    else if (t.type === 'despesa') expenseCents += cents;
  }
  return {
    count: transactions.length,
    income: incomeCents / 100,
    expense: expenseCents / 100,
    movement: (incomeCents + expenseCents) / 100,
    balance: (incomeCents - expenseCents) / 100
  };
}

export function createTransactionStatement({ transactions, searchQuery, filters, accounts, familyProfiles, generatedAt = new Date() }) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const dateOf = t => t.date?.toDate ? t.date.toDate() : new Date(t.date);
  const dates = transactions.map(dateOf).filter(date => !Number.isNaN(date.getTime()));
  const firstDate = dates.length ? new Date(Math.min(...dates)).toLocaleDateString('pt-BR') : '-';
  const lastDate = dates.length ? new Date(Math.max(...dates)).toLocaleDateString('pt-BR') : '-';
  const summary = getTransactionSummary(transactions);
  const query = searchQuery ? `“${searchQuery}”` : 'Sem termo de pesquisa';
  const emitted = generatedAt.toLocaleString('pt-BR');
  const rows = transactions.map((t, index) => {
    const account = accounts.find(a => a.id === t.accountId);
    const creator = t.createdByName || familyProfiles?.[t.createdBy]?.name || '-';
    const date = dateOf(t);
    return `<tr>
      <td class="number">${index + 1}</td>
      <td>${escape(Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('pt-BR'))}</td>
      <td><span class="description">${escape(t.description || '-')}</span><small>${escape(t.category || '-')}</small></td>
      <td>${escape(t.type === 'receita' ? 'Receita' : t.type === 'despesa' ? 'Despesa' : t.type)}</td>
      <td class="money">${escape(formatCurrency(t.amount))}</td>
      <td>${escape(account?.name || '-')}<small>${escape(creator)}</small></td>
      <td>${t.isPaid ? 'Sim' : 'Não'}</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NossaGrana - Extrato filtrado</title>
<style>
  @page {
    size: A4; margin: 16mm 12mm 18mm;
    @bottom-left { content: "NossaGrana | Extrato de transações filtradas"; font: 8pt Arial; color: #536173; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt Arial; color: #536173; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172333; background: white; font: 10pt/1.5 Arial, sans-serif; }
  h1 { font-size: 27pt; line-height: 1.15; margin: 10mm 0 4mm; }
  h2 { font-size: 13pt; margin: 9mm 0 3mm; }
  p { margin: 0 0 3mm; }
  .brand { letter-spacing: 2px; font-size: 10pt; font-weight: bold; color: #344d64; }
  .muted, small { color: #536173; }
  .summary { break-after: page; }
  .filters { border: 1px solid #bdc7d0; border-left: 4px solid #344d64; padding: 5mm; overflow-wrap: anywhere; }
  .query, .description { white-space: pre-wrap; overflow-wrap: anywhere; }
  dl { display: grid; grid-template-columns: 35mm 1fr; margin: 4mm 0 0; gap: 2mm 3mm; }
  dt { color: #536173; } dd { margin: 0; }
  .totals { width: 100%; border-collapse: collapse; font-size: 12pt; }
  .totals td { padding: 3.5mm 0; border-bottom: 1px solid #d5dce2; }
  .totals td:last-child { text-align: right; font-weight: bold; }
  .totals small { display: block; font-size: 9pt; font-weight: normal; }
  .balance td { border-bottom: 2px solid #344d64; }
  .records { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.5pt; line-height: 1.4; }
  .records th { text-align: left; padding: 2.5mm 1.5mm; border-bottom: 1px solid #344d64; }
  .records td { padding: 2.5mm 1.5mm; border-bottom: 1px solid #d5dce2; vertical-align: top; overflow-wrap: anywhere; }
  .records thead { display: table-header-group; }
  .records tr { break-inside: avoid; }
  .records small { display: block; margin-top: 1mm; font-size: 7pt; }
  .records .section-heading { padding: 0 0 4mm; font-size: 9pt; font-weight: normal; }
  .section-heading strong { display: block; font-size: 14pt; margin-bottom: 2mm; }
  .money, .number { text-align: right; }
  .money { white-space: nowrap; }
  .toolbar { position: sticky; top: 0; background: #eef2f5; padding: 14px; border-bottom: 1px solid #bdc7d0; }
  button { cursor: pointer; padding: 10px 16px; font: inherit; }
  @media screen { main { max-width: 210mm; margin: auto; padding: 16mm 12mm; } .summary { margin-bottom: 20mm; } }
  @media print { .toolbar { display: none; } }
</style></head><body>
<div class="toolbar"><button type="button" onclick="window.print()">Imprimir / Salvar em PDF</button>
  <span>Na janela de impressão, escolha “Salvar como PDF”.</span></div>
<main>
<section class="summary">
  <div class="brand">NOSSAGRANA</div>
  <h1>Extrato de<br>transações filtradas</h1>
  <p class="muted">Emitido em ${escape(emitted)}</p>
  <p>Gerado a partir dos lançamentos cadastrados no NossaGrana.</p>
  <h2>Pesquisa e filtros aplicados</h2>
  <div class="filters">
    <p><strong>Pesquisa na descrição:</strong> <span class="query">${escape(query)}</span></p>
    <dl>
      <dt>Categoria</dt><dd>${escape(filters.category)}</dd>
      <dt>Conta</dt><dd>${escape(filters.account)}</dd>
      <dt>Membro</dt><dd>${escape(filters.who)}</dd>
      <dt>Valores futuros</dt><dd>${escape(filters.future)}</dd>
    </dl>
  </div>
  <h2>Resumo dos resultados</h2>
  <p><strong>Período dos lançamentos:</strong> ${escape(firstDate)} a ${escape(lastDate)}</p>
  <table class="totals"><tbody>
    <tr><td>Quantidade de transações</td><td>${summary.count}</td></tr>
    <tr><td>Receitas</td><td>${escape(formatCurrency(summary.income))}</td></tr>
    <tr><td>Despesas</td><td>${escape(formatCurrency(summary.expense))}</td></tr>
    <tr><td>Total movimentado<small>Receitas + despesas</small></td><td>${escape(formatCurrency(summary.movement))}</td></tr>
    <tr class="balance"><td>Saldo<small>Receitas - despesas</small></td><td>${escape(formatCurrency(summary.balance))}</td></tr>
  </tbody></table>
  <p class="muted" style="margin-top:5mm">Inclui todas as páginas dos resultados filtrados, na mesma ordem da aba Transações. Valores em reais (BRL).</p>
</section>
<table class="records">
  <colgroup><col style="width:5%"><col style="width:11%"><col style="width:30%"><col style="width:10%"><col style="width:15%"><col style="width:22%"><col style="width:7%"></colgroup>
  <thead>
    <tr><th colspan="7" class="section-heading"><strong>Transações do extrato</strong>
      Pesquisa: <span class="query">${escape(query)}</span><br>Emissão: ${escape(emitted)} | ${summary.count} transações</th></tr>
    <tr><th>Nº</th><th>Data</th><th>Descrição / categoria</th><th>Tipo</th><th>Valor</th><th>Conta / responsável</th><th>Pago</th></tr>
  </thead><tbody>${rows}</tbody>
</table></main></body></html>`;
}
