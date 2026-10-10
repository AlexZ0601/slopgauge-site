// Shared by every page: the navigation bar (its scroll edge and the phone menu), sections rising
// into place as they scroll in, and instant press feedback on touch screens.
(() => {
  'use strict';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // iOS Safari only applies :active while a touch listener exists; this makes buttons respond on
  // touch-down, like the rest of the system.
  document.addEventListener('touchstart', () => {}, { passive: true });

  // The bar is a translucent layer the page scrolls under. Once content is under it, a soft edge
  // appears where the two meet, instead of a permanent rule.
  const nav = document.querySelector('.nav');
  if (nav) {
    const edge = () => nav.classList.toggle('scrolled', scrollY > 2);
    addEventListener('scroll', edge, { passive: true });
    edge();
  }

  // The phone menu: a sheet that grows from the menu button and returns into it.
  const btn = document.querySelector('.menu-btn');
  const menu = document.getElementById('menu');
  if (btn && menu) {
    let closing = 0;
    const open = () => {
      clearTimeout(closing);
      menu.classList.remove('closing');
      menu.hidden = false;
      menu.classList.add('opening');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Close menu');
      document.documentElement.style.overflow = 'hidden';
    };
    const close = (focus) => {
      if (menu.hidden) return;
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Menu');
      document.documentElement.style.overflow = '';
      menu.classList.remove('opening');
      menu.classList.add('closing');
      closing = setTimeout(() => {
        menu.hidden = true;
        menu.classList.remove('closing');
      }, reduced() ? 120 : 200);
      if (focus) btn.focus();
    };
    btn.addEventListener('click', () => (btn.getAttribute('aria-expanded') === 'true' ? close() : open()));
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) close();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') close(true);
    });
    matchMedia('(min-width: 861px)').addEventListener('change', (e) => e.matches && close());
  }

  // Sections rise into place once, as they come into view.
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) items.forEach((el) => el.classList.add('in'));
  else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' }
    );
    items.forEach((el) => io.observe(el));
  }
})();
