// Slopgauge Pro, unlocked by a license key. The key is checked with Polar's public endpoint for apps
// that have no server (it needs no secret, only the organization ID). The page sends Polar the key
// and nothing else, re-checks at most once a day, and keeps Pro working for two weeks offline.
(function (root) {
  'use strict';
  const STORE = 'slopgauge.pro';
  const API = 'https://api.polar.sh/v1/customer-portal/license-keys/validate';
  const DAY = 864e5;
  const GRACE = 14 * DAY;
  const cfg = () => root.SlopgaugeProConfig || { checkout: {} };

  function saved() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch (_) {
      return null;
    }
  }
  function save(v) {
    try {
      if (v) localStorage.setItem(STORE, JSON.stringify(v));
      else localStorage.removeItem(STORE);
    } catch (_) {}
  }

  // -> { ok: true, info } | { ok: false, reason: 'not-found' | 'expired' | 'not-configured' }; throws when Polar can't be reached.
  async function check(key) {
    key = String(key || '').trim();
    if (!cfg().organizationId) return { ok: false, reason: 'not-configured' };
    if (!key) return { ok: false, reason: 'not-found' };
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, organization_id: cfg().organizationId }),
    });
    if (res.status === 404 || res.status === 422) return { ok: false, reason: 'not-found' };
    if (!res.ok) throw new Error(`Polar answered ${res.status}`);
    const d = await res.json();
    if (d.status !== 'granted') return { ok: false, reason: 'not-found' };
    if (d.expires_at && Date.parse(d.expires_at) < Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true, info: { key, display: d.display_key || '', email: (d.customer && d.customer.email) || '', expiresAt: d.expires_at || null, checkedAt: Date.now() } };
  }

  let inflight = null;
  // Is Pro on, on this browser?
  function active() {
    const s = saved();
    if (!s) return Promise.resolve(false);
    if (Date.now() - s.checkedAt < DAY && !(s.expiresAt && Date.parse(s.expiresAt) < Date.now())) return Promise.resolve(true);
    inflight ||= check(s.key)
      .then((r) => {
        if (r.ok) save(r.info);
        else if (r.reason !== 'not-configured') save(null);
        return r.ok || (r.reason === 'not-configured' && Date.now() - s.checkedAt < GRACE);
      })
      .catch(() => Date.now() - s.checkedAt < GRACE) // offline: keep working for a while
      .finally(() => (inflight = null));
    return inflight;
  }

  async function activate(key) {
    const r = await check(key);
    if (r.ok) save(r.info);
    return r;
  }

  // Where a button should go: the Polar checkout when it's set up, otherwise an email.
  function link(which) {
    const url = (cfg().checkout || {})[which];
    if (url) return url;
    const subjects = { teacherYearly: 'Slopgauge Pro (yearly)', teacherMonthly: 'Slopgauge Pro (monthly)', school: 'Slopgauge school license', support: 'Supporting Slopgauge' };
    return `mailto:support@slopgauge.com?subject=${encodeURIComponent(subjects[which] || 'Slopgauge Pro')}`;
  }

  root.SlopgaugePro = { active, activate, deactivate: () => save(null), saved, link, portal: () => cfg().portal || 'mailto:support@slopgauge.com?subject=My%20Slopgauge%20Pro%20subscription', configured: () => !!cfg().organizationId };
})(window);
