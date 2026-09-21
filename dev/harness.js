// Loads the popup or options page into the iframe with the chrome stub injected
// ahead of the page's own module script. A <base> keeps the page's relative URLs
// (stylesheets, icons, modules) resolving against src/<page>/.
const params = new URLSearchParams(location.search);
const page = params.get('page') === 'options' ? 'options' : 'popup';
const src = `../src/${page}/${page}.html`;
const html = await (await fetch(src)).text();
const base = new URL(src, location.href).href;
const stub = new URL('./chrome-stub.js', location.href).href;
const scenario = params.get('scenario') || 'completed';
const tabUrl = params.get('url') || '';
const injected = `<head><base href="${base}"><script src="${stub}" data-scenario="${scenario}" data-url="${tabUrl}"></` + 'script>';
const frame = document.getElementById('frame');
frame.className = page;
frame.srcdoc = html.replace('<head>', injected);
