// Loads the popup or options page into the iframe with the chrome stub injected
// ahead of the page's own module script. A <base> keeps the page's relative URLs
// (stylesheets, icons, modules) resolving against src/<page>/.
const params = new URLSearchParams(location.search);
const page = params.get('page') === 'options' ? 'options' : 'popup';
const src = `../src/${page}/${page}.html`;
const html = await (await fetch(src)).text();
const base = new URL(src, location.href).href;
const stub = new URL('./chrome-stub.js', location.href).href;
const attribute = (value) => String(value).replace(/[&"<>]/g, (ch) => `&#${ch.charCodeAt(0)};`);
const scenario = params.get('scenario') || 'completed';
const tabUrl = params.get('url') || '';
const lang = params.get('lang') || 'en';
const injected = `<head><base href="${base}"><script src="${stub}" data-scenario="${attribute(scenario)}" data-url="${attribute(tabUrl)}" data-lang="${attribute(lang)}"></` + 'script>';
// The bar keeps the other parameters: a scenario link keeps the language, a
// language link keeps the scenario (or the page).
for (const link of document.querySelectorAll('.bar a')) {
  const own = new URLSearchParams(link.getAttribute('href'));
  const next = new URLSearchParams(location.search);
  if (own.has('scenario')) next.delete('page');
  if (own.has('page')) next.delete('scenario');
  for (const [key, value] of own) next.set(key, value);
  link.href = `?${next}`;
  if (own.get('lang') === lang) link.setAttribute('aria-current', 'true');
}
const frame = document.getElementById('frame');
frame.className = page;
frame.srcdoc = html.replace('<head>', injected);
