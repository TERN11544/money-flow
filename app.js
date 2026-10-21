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
  const SYNC_MARKER_KEY = 'money-flow-cloud-sync-marker-v1';
  const SYNC_BACKUP_KEY = 'money-flow-cloud-conflict-backup-v1';
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

  let localDataExists = Boolean(localStorage.getItem(STORAGE_KEY));
  let data = loadData();
  let activeView = 'dashboard';
  let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let transactionTypeFilter = 'all';
  let searchTerm = '';
  let cloudSession = null;
  let cloudReady = false;
  let cloudBusy = false;
  let cloudTimer = null;
  let cloudPollTimer = null;
  let pendingCloudChoice = null;

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localDataExists = true;
    scheduleCloudSync();
  }
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

  function cloneData(value) { return JSON.parse(JSON.stringify(value)); }
  function emptyData() { return { theme: data.theme, transactions: [], subscriptions: [] }; }
  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function sameData(left, right) { return left != null && right != null && stableStringify(left) === stableStringify(right); }
  function readSyncMarker() {
    try { return JSON.parse(localStorage.getItem(SYNC_MARKER_KEY)); } catch (_) { return null; }
  }
  function writeSyncMarker(userId, snapshot) {
    localStorage.setItem(SYNC_MARKER_KEY, JSON.stringify({ userId, data: snapshot ? cloneData(snapshot) : null }));
  }
  function backupData(source, snapshot) {
    if (!snapshot) return;
    localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify({ source, savedAt: new Date().toISOString(), data: snapshot }));
  }
  function setSyncStatus(message) {
    el('#sync-message').textContent = message;
    const caption = el('#sync-caption');
    if (caption) caption.textContent = cloudSession ? `ซิงก์กับ ${cloudSession.user?.email || 'บัญชีของคุณ'}` : 'ข้อมูลบันทึกอยู่ในอุปกรณ์นี้';
    const label = el('#sync-button-label');
    if (label) label.textContent = cloudSession ? 'ซิงก์แล้ว' : 'ซิงก์';
  }
  function refreshSyncUI(message = null) {
    const configured = Boolean(window.MoneyFlowCloud?.isConfigured());
    el('#sync-not-configured').hidden = configured;
    el('#sync-auth-form').hidden = !configured || Boolean(cloudSession);
    el('#sync-account').hidden = !configured || !cloudSession;
    el('#sync-account-email').textContent = cloudSession?.user?.email || '';
    if (message) setSyncStatus(message);
    else setSyncStatus(cloudSession ? 'บัญชีเชื่อมต่อแล้ว กำลังตรวจข้อมูล…' : 'ข้อมูลยังบันทึกในอุปกรณ์นี้');
  }
  function persistCurrentData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localDataExists = true;
    renderAll();
  }
  function validCloudData(value) {
    return value && Array.isArray(value.transactions) && Array.isArray(value.subscriptions);
  }
  function showCloudConflict(localSnapshot, remoteSnapshot, reason) {
    pendingCloudChoice = { localData: cloneData(localSnapshot), remoteData: remoteSnapshot ? cloneData(remoteSnapshot) : null };
    cloudReady = false;
    el('#sync-conflict').hidden = false;
    el('#sync-use-cloud').textContent = remoteSnapshot ? 'ใช้ข้อมูลจากคลาวด์' : 'เริ่มด้วยข้อมูลว่าง';
    el('#sync-conflict-copy').textContent = reason || 'พบข้อมูลต่างกัน เลือกชุดที่จะใช้ก่อน ข้อมูลอีกฝั่งจะถูกสำรองไว้บนอุปกรณ์นี้';
    setSyncStatus('หยุดซิงก์ชั่วคราวเพื่อป้องกันข้อมูลถูกเขียนทับ');
  }
  function finishCloudChoice() {
    pendingCloudChoice = null;
    el('#sync-conflict').hidden = true;
    cloudReady = true;
    setSyncStatus('ข้อมูลซิงก์แล้ว');
  }
  function scheduleCloudSync() {
    if (!cloudSession || !cloudReady) return;
    clearTimeout(cloudTimer);
    setSyncStatus('มีข้อมูลรอซิงก์…');
    cloudTimer = setTimeout(() => {
      if (cloudBusy) { scheduleCloudSync(); return; }
      pushLocalData();
    }, 650);
  }
  async function pushLocalData() {
    if (!cloudSession || !cloudReady || cloudBusy) return;
    cloudBusy = true;
    const snapshot = cloneData(data);
    try {
      await window.MoneyFlowCloud.writeCloudData(snapshot);
      writeSyncMarker(cloudSession.user.id, snapshot);
      setSyncStatus('ข้อมูลซิงก์แล้ว');
      if (!sameData(snapshot, data)) scheduleCloudSync();
    } catch (error) {
      setSyncStatus(`ซิงก์ไม่สำเร็จ แต่ข้อมูลในอุปกรณ์ยังอยู่: ${error.message}`);
    } finally { cloudBusy = false; }
  }
  function applyCloudData(snapshot) {
    if (!validCloudData(snapshot)) throw new Error('รูปแบบข้อมูลในคลาวด์ไม่ถูกต้อง');
    data = { theme: snapshot.theme === 'dark' ? 'dark' : 'light', transactions: snapshot.transactions, subscriptions: snapshot.subscriptions };
    persistCurrentData();
  }
  async function syncAgainstCloud(initial = false) {
    if (!cloudSession || cloudBusy || pendingCloudChoice) return;
    cloudBusy = true;
    setSyncStatus('กำลังตรวจข้อมูลบนคลาวด์…');
    try {
      const userId = cloudSession.user.id;
      const localSnapshot = cloneData(data);
      const remoteRow = await window.MoneyFlowCloud.readCloudData();
      const remoteSnapshot = remoteRow?.data || null;
      if (remoteSnapshot && !validCloudData(remoteSnapshot)) throw new Error('ข้อมูลในคลาวด์ไม่ครบถ้วน');
      const marker = readSyncMarker();

      if (!remoteSnapshot) {
        if (localDataExists) {
          showCloudConflict(localSnapshot, null, 'บัญชีนี้ยังไม่มีข้อมูลบนคลาวด์ หากเลือกอัปโหลด ข้อมูลบนอุปกรณ์นี้จะเป็นชุดเริ่มต้น');
        } else {
          data = emptyData();
          persistCurrentData();
          writeSyncMarker(userId, null);
          cloudReady = true;
          scheduleCloudSync();
        }
        return;
      }

      if (marker?.userId === userId && marker.data) {
        const localChanged = !sameData(localSnapshot, marker.data);
        const remoteChanged = !sameData(remoteSnapshot, marker.data);
        if (localChanged && remoteChanged && !sameData(localSnapshot, remoteSnapshot)) {
          showCloudConflict(localSnapshot, remoteSnapshot, 'อุปกรณ์นี้และคลาวด์มีการแก้ไขต่างกัน เลือกข้อมูลที่จะเก็บก่อนซิงก์ต่อ');
        } else if (localChanged && !remoteChanged) {
          writeSyncMarker(userId, remoteSnapshot);
          cloudReady = true;
          scheduleCloudSync();
        } else {
          if (remoteChanged || !sameData(localSnapshot, remoteSnapshot)) applyCloudData(remoteSnapshot);
          writeSyncMarker(userId, remoteSnapshot);
          cloudReady = true;
          setSyncStatus('ข้อมูลซิงก์แล้ว');
        }
        return;
      }

      if (localDataExists && !sameData(localSnapshot, remoteSnapshot)) {
        showCloudConflict(localSnapshot, remoteSnapshot, 'พบข้อมูลที่ยังไม่เคยเชื่อมกับบัญชีนี้ เลือกว่าจะใช้ข้อมูลจากคลาวด์หรืออัปโหลดข้อมูลอุปกรณ์นี้');
      } else {
        if (!sameData(localSnapshot, remoteSnapshot)) applyCloudData(remoteSnapshot);
        writeSyncMarker(userId, remoteSnapshot);
        cloudReady = true;
        setSyncStatus('ข้อมูลซิงก์แล้ว');
      }
    } catch (error) {
      if (initial && !readSyncMarker()) cloudReady = false;
      if (!window.MoneyFlowCloud.getSession()) {
        cloudSession = null;
        cloudReady = false;
        refreshSyncUI(`เซสชันหมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่: ${error.message}`);
      } else {
        setSyncStatus(`เชื่อมคลาวด์ไม่สำเร็จ ข้อมูลในเครื่องยังปลอดภัย: ${error.message}`);
      }
    } finally { cloudBusy = false; }
  }
  async function acceptCloudChoice(useCloud) {
    if (!pendingCloudChoice || !cloudSession) return;
    const pending = pendingCloudChoice;
    cloudBusy = true;
    let syncAfter = false;
    try {
      if (useCloud) {
        if (localDataExists) backupData('ข้อมูลเดิมจากอุปกรณ์', pending.localData);
        data = pending.remoteData ? cloneData(pending.remoteData) : emptyData();
        persistCurrentData();
        writeSyncMarker(cloudSession.user.id, pending.remoteData);
        finishCloudChoice();
        syncAfter = !pending.remoteData;
      } else {
        backupData('ข้อมูลเดิมจากคลาวด์', pending.remoteData);
        data = cloneData(pending.localData);
        persistCurrentData();
        writeSyncMarker(cloudSession.user.id, pending.remoteData);
        finishCloudChoice();
        syncAfter = true;
      }
    } catch (error) {
      setSyncStatus(`ยังเลือกข้อมูลไม่ได้: ${error.message}`);
    } finally {
      cloudBusy = false;
      if (syncAfter) scheduleCloudSync();
    }
  }
  async function startCloudSession(session, initial = true) {
    cloudSession = session;
    cloudReady = false;
    refreshSyncUI('บัญชีเชื่อมต่อแล้ว กำลังโหลดข้อมูล…');
    await syncAgainstCloud(initial);
    startCloudPolling();
  }
  function startCloudPolling() {
    clearInterval(cloudPollTimer);
    cloudPollTimer = setInterval(() => {
      if (!document.hidden) syncAgainstCloud(false);
    }, 30000);
  }
  async function authenticate(mode) {
    const form = el('#sync-auth-form');
    if (!form.reportValidity()) return;
    const email = el('#sync-email').value.trim();
    const password = el('#sync-password').value;
    el('#sync-sign-in').disabled = true;
    el('#sync-sign-up').disabled = true;
    setSyncStatus(mode === 'signup' ? 'กำลังสร้างบัญชี…' : 'กำลังเข้าสู่ระบบ…');
    try {
      if (mode === 'signup') {
        const result = await window.MoneyFlowCloud.signUp(email, password);
        if (!result.session) {
          setSyncStatus('สร้างบัญชีแล้ว โปรดกดยืนยันจากอีเมลก่อน แล้วจึงกลับมาเข้าสู่ระบบ');
          return;
        }
        await startCloudSession(result.session);
      } else {
        await startCloudSession(await window.MoneyFlowCloud.signIn(email, password));
      }
    } catch (error) {
      setSyncStatus(`ทำรายการไม่สำเร็จ: ${error.message}`);
    } finally {
      el('#sync-sign-in').disabled = false;
      el('#sync-sign-up').disabled = false;
      refreshSyncUI(el('#sync-message').textContent);
    }
  }
  function bindSyncEvents() {
    const openDialog = () => {
      refreshSyncUI();
      el('#sync-dialog').showModal();
      if (cloudSession && !cloudReady) syncAgainstCloud(true);
    };
    el('#sync-open').addEventListener('click', openDialog);
    el('#sidebar-sync-open').addEventListener('click', openDialog);
    el('#sync-auth-form').addEventListener('submit', (event) => { event.preventDefault(); authenticate('signin'); });
    el('#sync-sign-in').addEventListener('click', () => authenticate('signin'));
    el('#sync-sign-up').addEventListener('click', () => authenticate('signup'));
    el('#sync-use-cloud').addEventListener('click', () => acceptCloudChoice(true));
    el('#sync-use-device').addEventListener('click', () => acceptCloudChoice(false));
    el('#sync-now').addEventListener('click', () => syncAgainstCloud(false));
    el('#sync-sign-out').addEventListener('click', async () => {
      try { await window.MoneyFlowCloud.signOut(); } catch (_) { /* Local sign-out still clears the session. */ }
      cloudSession = null;
      cloudReady = false;
      pendingCloudChoice = null;
      el('#sync-conflict').hidden = true;
      clearInterval(cloudPollTimer);
      refreshSyncUI('ออกจากระบบแล้ว ข้อมูลในอุปกรณ์นี้ยังอยู่');
    });
    window.addEventListener('online', () => { if (cloudSession) syncAgainstCloud(false); });
  }
  function initializeCloudSync() {
    bindSyncEvents();
    if (!window.MoneyFlowCloud?.isConfigured()) { refreshSyncUI(); return; }
    const savedSession = window.MoneyFlowCloud.getSession();
    if (savedSession) startCloudSession(savedSession, true);
    else refreshSyncUI();
  }

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
  initializeCloudSync();
})();
