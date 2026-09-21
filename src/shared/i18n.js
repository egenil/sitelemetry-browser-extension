// Translation helper. In the extension, chrome.i18n resolves keys from _locales
// (English is the default locale). In Node tests, or if a key is missing, a fallback
// message table with the same format is used, so every user-facing string lives in
// _locales/en/messages.json and nowhere else.
let fallbackMessages = null;

export function setFallbackMessages(messages) {
  fallbackMessages = messages && typeof messages === 'object' ? messages : null;
}

// Chrome message format: "$NAME$" placeholders whose content may reference "$1".."$9"
// substitutions; "$$" is a literal dollar sign.
export function formatMessage(entry, substitutions = []) {
  const list = (Array.isArray(substitutions) ? substitutions : [substitutions]).map((value) => String(value ?? ''));
  const placeholders = Object.fromEntries(Object.entries(entry?.placeholders || {}).map(([name, value]) => [name.toLowerCase(), value]));
  return String(entry?.message ?? '').replace(/\$\$|\$([A-Za-z0-9_@]+)\$/g, (match, name) => {
    if (match === '$$') return '$';
    const placeholder = placeholders[name.toLowerCase()];
    if (!placeholder) return match;
    return String(placeholder.content ?? '').replace(/\$(\d)/g, (_, n) => list[Number(n) - 1] ?? '');
  });
}

export function createTranslator(messages) {
  return (key, substitutions = []) => (messages?.[key] ? formatMessage(messages[key], substitutions) : key);
}

export function t(key, substitutions = []) {
  const list = (Array.isArray(substitutions) ? substitutions : [substitutions]).map((value) => String(value ?? ''));
  const api = globalThis.chrome?.i18n;
  if (api && typeof api.getMessage === 'function') {
    const text = api.getMessage(key, list);
    if (text) return text;
  }
  if (fallbackMessages?.[key]) return formatMessage(fallbackMessages[key], list);
  return key;
}

// Fill static markup: data-i18n sets textContent; data-i18n-title, -placeholder and
// -aria-label set the attribute of the same name.
export function localizeDocument(root = globalThis.document) {
  if (!root) return;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.getAttribute('data-i18n'));
  for (const attribute of ['title', 'placeholder', 'aria-label']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
}
