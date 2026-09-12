// Family access helpers: active membership, historical access and account/date scoping.

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeFamilyAccess(family, userId) {
  const members = Array.isArray(family?.members) ? family.members : [];
  const isAdmin = !!family && (family.createdBy === userId);
  const isActiveMember = isAdmin || members.includes(userId);
  const rawGrant = family?.accessGrants?.[userId] || null;
  const retained = !isActiveMember && !!rawGrant?.retainAfterRemoval;
  const denied = !isActiveMember && !retained;
  const scope = isAdmin ? 'all' : (rawGrant?.scope === 'accounts' ? 'accounts' : 'all');
  const accountIds = scope === 'accounts' && Array.isArray(rawGrant?.accountIds)
    ? [...new Set(rawGrant.accountIds.filter(Boolean))]
    : [];
  const from = isAdmin ? null : asDate(rawGrant?.from);
  const until = isAdmin ? null : asDate(rawGrant?.until);
  const readOnly = retained;
  const restricted = !isAdmin && !denied && (readOnly || scope === 'accounts' || !!from || !!until);

  return {
    userId,
    isAdmin,
    isActiveMember,
    readOnly,
    denied,
    restricted,
    scope,
    accountIds,
    from,
    until,
    retainAfterRemoval: retained
  };
}

export function isDateWithinFamilyAccess(access, rawDate) {
  if (!access || access.denied) return false;
  const date = asDate(rawDate);
  if (!date) return false;
  if (access.from && date < access.from) return false;
  if (access.until && date > access.until) return false;
  return true;
}

export function isAccountWithinFamilyAccess(access, accountId) {
  if (!access || access.denied) return false;
  return access.scope === 'all' || access.accountIds.includes(accountId);
}

export function filterFinancialDataForAccess(data, access) {
  if (!access || access.denied) {
    return { userAccounts: [], userTransactions: [], userBudgets: [], userGoals: [], userFixedBills: [] };
  }
  if (!access.restricted) return data;

  const userAccounts = (data.userAccounts || []).filter(a => isAccountWithinFamilyAccess(access, a.id));
  const ids = new Set(userAccounts.map(a => a.id));
  const userTransactions = (data.userTransactions || []).filter(t =>
    ids.has(t.accountId) && isDateWithinFamilyAccess(access, t.date)
  );

  // Planning data is intentionally hidden from limited/historical access.
  return {
    userAccounts,
    userTransactions,
    userBudgets: [],
    userGoals: [],
    userFixedBills: []
  };
}

function formatDate(date) {
  return date ? date.toLocaleDateString('pt-BR') : null;
}

export function formatFamilyAccessSummary(access, accounts = []) {
  if (!access || access.denied) return 'Sem acesso';
  const from = formatDate(access.from) || 'início';
  const until = formatDate(access.until) || 'sem data final';
  const period = `${from} até ${until}`;
  if (access.scope === 'all') return `Geral · ${period}`;
  const names = access.accountIds
    .map(id => accounts.find(a => a.id === id))
    .filter(Boolean)
    .map(a => a.ownerTag ? `${a.name} (${a.ownerTag})` : a.name);
  return `${names.length ? names.join(', ') : 'Nenhuma conta'} · ${period}`;
}
