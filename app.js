(() => {
  'use strict';

  const STORAGE_KEY = 'money-flow-phase-one-v1';
  const categoryMeta = {
    food: { label: 'อาหารและเครื่องดื่ม', icon: '☕', color: '#f2a65a' },
    travel: { label: 'เดินทาง', icon: '◒', color: '#7fa8d1' },
    shopping: { label: 'ช้อปปิ้ง', icon: '◈', color: '#d797b3' },
    home: { label: 'บ้านและบิล', icon: '⌂', color: '#7eae97' },
    health: { label: 'สุขภาพ', icon: '✚', color: '#e78b83' },
    fun: { label: 'บันเทิง', icon: '◌', color: '#a892cf' },
    education: { label: 'การเรียนรู้', icon: '✦', color: '#e5bd57' },
    salary: { label: 'เงินเดือน', icon: '↗', color: '#54a77c' },
    freelance: { label: 'รายรับอื่น ๆ', icon: '✺', color: '#54a77c' },
    other: { label: 'อื่น ๆ', icon: '•', color: '#92a099' },
  };

  const el = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
  const dateFormatter = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' });
  const today = () => new Date().toISOString().slice(0, 10);
  const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const seed = () => {
    const now = new Date();
    const d = (offset) => { const date = new Date(now); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };
    return {
      theme: 'light',
      transactions: [
        { id: id(), type: 'income', amount: 42500, category: 'salary', note: 'เงินเดือน', date: d(-5) },
        { id: id(), type: 'expense', amount: 155, category: 'food', note: 'กาแฟและอาหารเช้า', date: d(-1) },
        { id: id(), type: 'expense', amount: 780, category: 'travel', note: 'เติมน้ำมัน', date: d(-3) },
        { id: id(), type: 'expense', amount: 1290, category: 'shopping', note: 'ของใช้ในบ้าน', date: d(-7) },
        { id: id(), type: 'expense', amount: 450, category: 'fun', note: 'ดูหนัง', date: d(-9) },
      ],
      subscriptions: [
        { id: id(), name: 'Netflix', icon: 'N', price: 419, interval: 'monthly', category: 'fun', nextDate: d(3) },
        { id: id(), name: 'Spotify', icon: '♫', price: 139, interval: 'monthly', category: 'fun', nextDate: d(7) },
        { id: id(), name: 'Google One', icon: 'G', price: 700, interval: 'yearly', category: 'home', nextDate: d(38) },
      ],
    };
  };

  function loadData() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && Array.isArray(stored.transactions) && Array.isArray(stored.subscriptions)) return stored;
    } catch (_) { /* Fresh data below. */ }
    return seed();
  }

  let data = loadData();
  let activeView = 'dashboard';
  let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let transactionTypeFilter = 'all';
  let searchTerm = '';

  function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  function categoryFor(key) { return categoryMeta[key] || categoryMeta.other; }
  function formatMoney(value) { return money.format(Number(value) || 0); }
  function toDate(dateString) { return new Date(`${dateString}T12:00:00`); }
  function monthMatches(dateString) { const date = toDate(dateString); return date.getFullYear() === visibleMonth.getFullYear() && date.getMonth() === visibleMonth.getMonth(); }
  function signedAmount(transaction) { return transaction.type === 'income' ? Number(transaction.amount) : -Number(transaction.amount); }
  function totalMonthly(sub) { return sub.interval === 'yearly' ? Number(sub.price) / 12 : Number(sub.price); }
  function daysUntil(dateString) { return Math.round((toDate(dateString) - new Date(new Date().toDateString())) / 86400000); }

  function fillCategories() {
    const options = Object.entries(categoryMeta).map(([key, meta]) => `<option value="${key}">${meta.icon} ${meta.label}</option>`).join('');
    el('#transaction-category').innerHTML = options;
    el('#subscription-category').innerHTML = options;
  }

  function renderEmpty(container, message) {
    const clone = el('#empty-state-template').content.cloneNode(true);
    clone.querySelector('p').textContent = message;
    container.replaceChildren(clone);
  }

  function transactionRow(transaction, allowActions = false) {
    const meta = categoryFor(transaction.category);
    const sign = transaction.type === 'income' ? '+' : '−';
    const action = allowActions ? `<button type="button" class="edit-transaction" data-id="${transaction.id}" aria-label="แก้ไข ${escapeHtml(transaction.note)}">⋯</button>` : '';
    return `<article class="transaction-row">
      <span class="transaction-icon" style="background:${meta.color}33;color:${meta.color}">${meta.icon}</span>
      <div class="transaction-main"><strong>${escapeHtml(transaction.note)}</strong><span>${meta.label}</span></div>
      <time class="transaction-date" datetime="${transaction.date}">${dateFormatter.format(toDate(transaction.date))}</time>
      <strong class="transaction-amount ${transaction.type}">${sign}${formatMoney(transaction.amount)}</strong>${action}
    </article>`;
  }

  function renderDashboard() {
    const monthlyTransactions = data.transactions.filter((item) => monthMatches(item.date));
    const income = monthlyTransactions.filter((item) => item.type === 'income');
    const expenses = monthlyTransactions.filter((item) => item.type === 'expense');
    const allBalance = data.transactions.reduce((sum, item) => sum + signedAmount(item), 0);
    const monthBalance = income.reduce((sum, item) => sum + Number(item.amount), 0) - expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalExpense = expenses.reduce((sum, item) => sum + Number(item.amount), 0);

    el('#current-month-label').textContent = monthFormatter.format(visibleMonth);
    el('#balance-total').textContent = formatMoney(allBalance);
    el('#balance-detail').textContent = monthBalance >= 0 ? `เดือนนี้เหลือ ${formatMoney(monthBalance)}` : `เดือนนี้ใช้เกินไป ${formatMoney(Math.abs(monthBalance))}`;
    el('#income-total').textContent = formatMoney(income.reduce((sum, item) => sum + Number(item.amount), 0));
    el('#income-count').textContent = `${income.length} รายการ`;
    el('#expense-total').textContent = formatMoney(totalExpense);
    el('#expense-count').textContent = `${expenses.length} รายการ`;

    const byCategory = expenses.reduce((groups, item) => {
      groups[item.category] = (groups[item.category] || 0) + Number(item.amount);
      return groups;
    }, {});
    const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    el('#top-category').textContent = categoryEntries.length ? `อันดับ 1: ${categoryFor(categoryEntries[0][0]).label}` : 'ยังไม่มีรายจ่าย';
    const chart = el('#category-chart');
    if (!categoryEntries.length) renderEmpty(chart, 'เพิ่มรายจ่ายเพื่อดูสัดส่วนตามหมวดหมู่');
    else chart.innerHTML = categoryEntries.slice(0, 5).map(([key, amount]) => {
      const meta = categoryFor(key);
      const width = Math.max(4, Math.round((amount / totalExpense) * 100));
      return `<div class="category-item"><span class="category-label">${meta.icon} ${meta.label}</span><div class="chart-track"><div class="chart-fill" style="width:${width}%;--category-color:${meta.color}"></div></div><strong class="category-amount">${formatMoney(amount)}</strong></div>`;
    }).join('');

    renderSubscriptionPreview();
    const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const recentContainer = el('#recent-transactions');
    if (!recent.length) renderEmpty(recentContainer, 'ยังไม่มีรายการ ลองเพิ่มรายการแรกของคุณ');
    else recentContainer.innerHTML = recent.map((transaction) => transactionRow(transaction)).join('');
  }

  function subscriptionRow(sub) {
    const frequency = sub.interval === 'yearly' ? 'รายปี' : 'รายเดือน';
    return `<div class="subscription-row"><span class="sub-icon">${escapeHtml(sub.icon || '✦')}</span><div class="sub-copy"><strong>${escapeHtml(sub.name)}</strong><span>${frequency} · ${dateFormatter.format(toDate(sub.nextDate))}</span></div><strong class="sub-cost">${formatMoney(sub.price)}</strong></div>`;
  }

  function renderSubscriptionPreview() {
    const sorted = [...data.subscriptions].sort((a, b) => a.nextDate.localeCompare(b.nextDate));
    const container = el('#subscription-preview-list');
    if (!sorted.length) renderEmpty(container, 'ยังไม่มี subscription');
    else container.innerHTML = sorted.slice(0, 3).map(subscriptionRow).join('');
    el('#subscription-monthly-total').textContent = formatMoney(data.subscriptions.reduce((sum, sub) => sum + totalMonthly(sub), 0));
  }

  function renderTransactions() {
    let list = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date));
    if (transactionTypeFilter !== 'all') list = list.filter((item) => item.type === transactionTypeFilter);
    const search = searchTerm.trim().toLowerCase();
    if (search) list = list.filter((item) => `${item.note} ${categoryFor(item.category).label}`.toLowerCase().includes(search));
    const container = el('#all-transactions');
    if (!list.length) renderEmpty(container, 'ไม่พบรายการที่ตรงกับตัวกรอง');
    else container.innerHTML = list.map((transaction) => transactionRow(transaction, true)).join('');
  }

  function renderSubscriptions() {
    const sorted = [...data.subscriptions].sort((a, b) => a.nextDate.localeCompare(b.nextDate));
    const total = data.subscriptions.reduce((sum, sub) => sum + totalMonthly(sub), 0);
    el('#subscription-hero-total').textContent = formatMoney(total);
    el('#subscription-status').textContent = sorted.length ? `${sorted.length} รายการ · คิดเป็น ${formatMoney(total)} ต่อเดือน` : 'ยังไม่มี subscription';
    const grid = el('#subscription-grid');
    if (!sorted.length) { renderEmpty(grid, 'เพิ่ม subscription เพื่อดูค่าใช้จ่ายประจำของคุณ'); return; }
    grid.innerHTML = sorted.map((sub) => {
      const category = categoryFor(sub.category);
      const days = daysUntil(sub.nextDate);
      const timing = days === 0 ? 'ตัดเงินวันนี้' : days === 1 ? 'ตัดเงินพรุ่งนี้' : days > 0 ? `อีก ${days} วัน` : 'ถึงกำหนดแล้ว';
      return `<article class="subscription-card">
        <div class="card-actions"><button type="button" class="edit-subscription" data-id="${sub.id}" aria-label="แก้ไข ${escapeHtml(sub.name)}">✎</button><button type="button" class="delete-subscription" data-id="${sub.id}" aria-label="ลบ ${escapeHtml(sub.name)}">×</button></div>
        <div class="subscription-card-top"><span class="sub-icon" style="background:${category.color}33">${escapeHtml(sub.icon || '✦')}</span><div><h3>${escapeHtml(sub.name)}</h3><p>${category.label}</p></div></div>
        <div class="subscription-card-cost"><strong>${formatMoney(sub.price)}</strong><span>${sub.interval === 'yearly' ? 'ต่อปี' : 'ต่อเดือน'}</span></div>
        <div class="sub-date"><span>รอบถัดไป</span><strong>${timing}</strong></div>
      </article>`;
    }).join('');
  }

  function renderAll() { renderDashboard(); renderTransactions(); renderSubscriptions(); applyTheme(); }
  function applyTheme() { document.body.classList.toggle('dark', data.theme === 'dark'); }
  function escapeHtml(value) { const node = document.createElement('span'); node.textContent = String(value || ''); return node.innerHTML; }

  function setView(view) {
    activeView = view;
    all('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-visible', panel.dataset.viewPanel === view));
    all('[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
    const meta = {
      dashboard: ['ภาพรวมการเงิน', 'สวัสดี, วันนี้เงินไหลไปทางไหนบ้าง?'],
      transactions: ['ประวัติการเงิน', 'ทุกการเคลื่อนไหวของเงินคุณ'],
      subscriptions: ['ค่าใช้จ่ายประจำ', 'Subscription ที่ไม่อยากลืม'],
    }[view];
    el('#page-kicker').textContent = meta[0];
    el('#page-title').textContent = meta[1];
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openTransaction(transaction = null) {
    const form = el('#transaction-form');
    form.reset();
    el('#transaction-id').value = transaction?.id || '';
    el('#transaction-type').value = transaction?.type || 'expense';
    el('#transaction-dialog-title').textContent = transaction ? 'แก้ไขรายการ' : 'เพิ่มรายการ';
    el('#transaction-amount').value = transaction?.amount || '';
    el('#transaction-note').value = transaction?.note || '';
    el('#transaction-category').value = transaction?.category || 'food';
    el('#transaction-date').value = transaction?.date || today();
    all('.type-choice').forEach((button) => button.classList.toggle('is-active', button.dataset.formType === (transaction?.type || 'expense')));
    el('#transaction-dialog').showModal();
    setTimeout(() => el('#transaction-amount').focus(), 0);
  }

  function openSubscription(sub = null) {
    const form = el('#subscription-form');
    form.reset();
    el('#subscription-id').value = sub?.id || '';
    el('#subscription-dialog-title').textContent = sub ? 'แก้ไข subscription' : 'เพิ่ม subscription';
    el('#subscription-name').value = sub?.name || '';
    el('#subscription-icon').value = sub?.icon || '✦';
    el('#subscription-price').value = sub?.price || '';
    el('#subscription-interval').value = sub?.interval || 'monthly';
    el('#subscription-category').value = sub?.category || 'fun';
    el('#subscription-next-date').value = sub?.nextDate || today();
    el('#subscription-dialog').showModal();
    setTimeout(() => el('#subscription-name').focus(), 0);
  }

  function bindEvents() {
    all('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
    all('[data-go-to]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.goTo)));
    el('#open-transaction').addEventListener('click', () => openTransaction());
    el('#add-transaction-inline').addEventListener('click', () => openTransaction());
    el('#open-subscription').addEventListener('click', () => openSubscription());
    all('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => el(`#${button.dataset.closeDialog}`).close()));
    el('#theme-toggle').addEventListener('click', () => { data.theme = data.theme === 'dark' ? 'light' : 'dark'; saveData(); applyTheme(); });
    el('#previous-month').addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1); renderDashboard(); });
    el('#next-month').addEventListener('click', () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1); renderDashboard(); });
    all('[data-type-filter]').forEach((button) => button.addEventListener('click', () => {
      transactionTypeFilter = button.dataset.typeFilter;
      all('[data-type-filter]').forEach((chip) => chip.classList.toggle('is-selected', chip === button));
      renderTransactions();
    }));
    el('#transaction-search').addEventListener('input', (event) => { searchTerm = event.target.value; renderTransactions(); });
    all('.type-choice').forEach((button) => button.addEventListener('click', () => {
      el('#transaction-type').value = button.dataset.formType;
      all('.type-choice').forEach((choice) => choice.classList.toggle('is-active', choice === button));
    }));
    el('#transaction-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const existingId = el('#transaction-id').value;
      const item = { id: existingId || id(), type: el('#transaction-type').value, amount: Number(el('#transaction-amount').value), note: el('#transaction-note').value.trim(), category: el('#transaction-category').value, date: el('#transaction-date').value };
      if (!item.amount || !item.note || !item.date) return;
      const index = data.transactions.findIndex((transaction) => transaction.id === existingId);
      if (index >= 0) data.transactions[index] = item; else data.transactions.push(item);
      saveData(); renderAll(); el('#transaction-dialog').close();
    });
    el('#subscription-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const existingId = el('#subscription-id').value;
      const item = { id: existingId || id(), name: el('#subscription-name').value.trim(), icon: el('#subscription-icon').value.trim() || '✦', price: Number(el('#subscription-price').value), interval: el('#subscription-interval').value, category: el('#subscription-category').value, nextDate: el('#subscription-next-date').value };
      if (!item.name || !item.price || !item.nextDate) return;
      const index = data.subscriptions.findIndex((subscription) => subscription.id === existingId);
      if (index >= 0) data.subscriptions[index] = item; else data.subscriptions.push(item);
      saveData(); renderAll(); el('#subscription-dialog').close();
    });
    document.addEventListener('click', (event) => {
      const transactionButton = event.target.closest('.edit-transaction');
      if (transactionButton) openTransaction(data.transactions.find((item) => item.id === transactionButton.dataset.id));
      const editSub = event.target.closest('.edit-subscription');
      if (editSub) openSubscription(data.subscriptions.find((item) => item.id === editSub.dataset.id));
      const deleteSub = event.target.closest('.delete-subscription');
      if (deleteSub && window.confirm('ลบ subscription นี้หรือไม่?')) { data.subscriptions = data.subscriptions.filter((item) => item.id !== deleteSub.dataset.id); saveData(); renderAll(); }
    });
    el('#reset-data').addEventListener('click', () => {
      if (!window.confirm('ลบข้อมูลที่บันทึกบนอุปกรณ์นี้ทั้งหมดและเริ่มใหม่หรือไม่?')) return;
      data = { theme: data.theme, transactions: [], subscriptions: [] }; saveData(); renderAll(); setView('dashboard');
    });
  }

  fillCategories();
  bindEvents();
  renderAll();
})();
