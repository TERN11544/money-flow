(() => {
  'use strict';

  const config = window.MONEY_FLOW_SUPABASE || {};
  const url = String(config.url || '').replace(/\/+$/, '');
  const publishableKey = String(config.publishableKey || '');
  const SESSION_KEY = 'money-flow-cloud-session-v1';
  let session = readSession();

  function isConfigured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && publishableKey.startsWith('sb_publishable_');
  }

  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
      return saved && saved.access_token && saved.refresh_token ? saved : null;
    } catch (_) { return null; }
  }

  function storeSession(value) {
    session = value || null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  async function request(path, options = {}, token = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(`${url}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          apikey: publishableKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('เชื่อมต่อช้าเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
      throw error;
    } finally { clearTimeout(timeout); }
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = { message: text }; }
    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = payload?.code || payload?.error_code || null;
      throw error;
    }
    return payload;
  }

  async function authRequest(path, body) {
    return request(`/auth/v1${path}`, { method: 'POST', body: JSON.stringify(body) });
  }

  function saveSession(payload) {
    const next = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
      user: payload.user,
    };
    storeSession(next);
    return next;
  }

  async function validSession() {
    if (!session) return null;
    if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 45) return session;
    try {
      const refreshed = await authRequest('/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      return saveSession(refreshed);
    } catch (error) {
      if (error.status === 400 || error.status === 401) storeSession(null);
      throw error;
    }
  }

  async function signIn(email, password) {
    const payload = await authRequest('/token?grant_type=password', { email, password });
    return saveSession(payload);
  }

  async function signUp(email, password) {
    const payload = await authRequest('/signup', { email, password });
    if (payload.access_token && payload.refresh_token) return { session: saveSession(payload), confirmationRequired: false };
    return { session: null, confirmationRequired: true };
  }

  async function signOut() {
    try {
      const current = await validSession();
      if (current) await request('/auth/v1/logout', { method: 'POST' }, current.access_token);
    } finally { storeSession(null); }
  }

  async function readCloudData() {
    const current = await validSession();
    if (!current?.user?.id) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
    const rows = await request(`/rest/v1/money_flow_data?select=data,updated_at&user_id=eq.${encodeURIComponent(current.user.id)}&limit=1`, { method: 'GET' }, current.access_token);
    return rows?.[0] || null;
  }

  async function writeCloudData(data) {
    const current = await validSession();
    if (!current?.user?.id) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
    return request('/rest/v1/money_flow_data?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ user_id: current.user.id, data, updated_at: new Date().toISOString() }),
    }, current.access_token);
  }

  window.MoneyFlowCloud = Object.freeze({
    isConfigured,
    getSession: () => session,
    signIn,
    signUp,
    signOut,
    readCloudData,
    writeCloudData,
  });
})();
