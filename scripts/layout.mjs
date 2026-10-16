// Writes the shared navigation bar and footer into every page, so they stay identical, and tags each
// Chrome Web Store link with UTM parameters (the store's dashboard counts listing views by
// utm_source and utm_campaign; slopgauge.com itself runs no analytics). Run: node scripts/layout.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = 'https://chromewebstore.google.com/detail/fmfnjbhhknbbdcighkhlindiaeajljie';
const store = (campaign) => `${STORE}?utm_source=slopgauge.com&amp;utm_medium=website&amp;utm_campaign=${campaign}`;

// [file, nav label it lights up]
const PAGES = [
  ['index.html', 'Home'],
  ['check.html', 'Essay checker'],
  ['class.html', 'Check a class'],
  ['teachers.html', 'For teachers'],
  ['pricing.html', 'Pricing'],
  ['tells.html', 'Field guide'],
  ['flagged.html', ''],
  ['press.html', ''],
];
const NAV = [
  ['check.html', 'Essay checker'],
  ['class.html', 'Check a class'],
  ['teachers.html', 'For teachers'],
  ['pricing.html', 'Pricing'],
  ['./#about', 'About'],
];
const MENU = [['./', 'Home'], ...NAV.slice(0, 4), ['tells.html', 'Field guide'], ['./#about', 'About'], ['privacy.html', 'Privacy']];

const link = ([href, label], here) => `<a href="${href}"${label === here ? ' aria-current="page"' : ''}>${label}</a>`;
const header = (here, campaign) => `<header class="nav">
    <div class="wrap nav-in">
      <a class="brand" href="./"><img src="icon.png" alt="" width="24" height="24">Slopgauge</a>
      <nav class="nav-links" aria-label="Site">
        ${NAV.map((l) => link(l, here)).join('\n        ')}
      </nav>
      <a class="btn small" href="${store(campaign + '-nav')}">Add to Chrome</a>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu" aria-label="Menu"><span></span><span></span></button>
    </div>
    <div class="menu" id="menu" hidden>
      <nav class="wrap" aria-label="Menu">
        ${MENU.map((l) => link(l, here)).join('\n        ')}
        <p class="menu-fine">Free, and it runs on your device.</p>
      </nav>
    </div>
  </header>`;
const footer = (campaign) => `<footer class="foot">
    <div class="wrap">
      <div class="cols">
        <div><h4>Tools</h4><ul><li><a href="${store(campaign + '-footer')}">Chrome extension</a></li><li><a href="check.html">Essay checker</a></li><li><a href="class.html">Check a class</a></li><li><a href="pricing.html">Pricing</a></li></ul></div>
        <div><h4>Learn</h4><ul><li><a href="teachers.html">For teachers</a></li><li><a href="tells.html">Field guide to AI tells</a></li><li><a href="flagged.html">Flagged as AI, but you wrote it?</a></li><li><a href="./#sure">How accurate it is</a></li></ul></div>
        <div><h4>Slopgauge</h4><ul><li><a href="./#about">About</a></li><li><a href="press.html">Press</a></li><li><a href="pricing.html#support">Support the project</a></li><li><a href="privacy.html">Privacy policy</a></li><li><a href="mailto:support@slopgauge.com">support@slopgauge.com</a></li></ul></div>
      </div>
      <div class="legal"><span>Free, and it runs on your device.</span><span>Named tells adapted from <a href="https://github.com/petergyang/no-ai-slop">no-ai-slop</a> (MIT).</span></div>
    </div>
  </footer>`;

for (const [file, here] of PAGES) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const campaign = file.replace(/\.html$/, '');
  let html = fs.readFileSync(p, 'utf8');
  html = html.replace(/<header class="nav">[\s\S]*?<\/header>/, header(here, campaign));
  html = html.replace(/<footer class="foot">[\s\S]*?<\/footer>/, footer(campaign));
  // Untagged store links in the page body get the page as their campaign.
  html = html.split(`href="${STORE}"`).join(`href="${store(campaign)}"`);
  fs.writeFileSync(p, html);
  console.log('laid out', file);
}
