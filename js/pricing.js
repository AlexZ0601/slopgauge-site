// The pricing page: buy buttons point at the Polar checkouts (or email, until they're set up), and a
// license key turns Pro on in this browser (js/pro.js).
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const P = window.SlopgaugePro;
  for (const [id, which] of [['buyYearly', 'teacherYearly'], ['buyMonthly', 'teacherMonthly'], ['buySchool', 'school'], ['supportBtn', 'support']]) $(id).href = P.link(which);
  $('manage').href = P.portal();

  function show(on) {
    $('activateForm').hidden = on;
    $('activeBox').hidden = !on;
    const s = P.saved();
    $('activeInfo').textContent = on && s ? [s.display ? `Key ${s.display}` : '', s.email ? `for ${s.email}` : ''].filter(Boolean).join(' ') + '.' : '';
  }
  P.active().then(show);
  if (location.hash === '#activate') $('licenseKey').focus();

  $('activateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('activateMsg');
    $('activateBtn').disabled = true;
    msg.textContent = 'Checking your key with Polar…';
    try {
      const r = await P.activate($('licenseKey').value);
      if (r.ok) {
        msg.textContent = '';
        show(true);
      } else
        msg.textContent = {
          'not-found': 'That key wasn’t found, or it’s no longer active. Check it against your receipt.',
          expired: 'That key has expired. Renew from the link in your receipt.',
          'not-configured': 'Pro keys can’t be checked yet. Email support@slopgauge.com and we’ll sort it out.',
        }[r.reason];
    } catch (err) {
      msg.textContent = `Couldn’t reach Polar to check the key (${(err && err.message) || err}). Try again in a moment.`;
    } finally {
      $('activateBtn').disabled = false;
    }
  });
  $('deactivate').addEventListener('click', () => {
    P.deactivate();
    show(false);
  });
})();
