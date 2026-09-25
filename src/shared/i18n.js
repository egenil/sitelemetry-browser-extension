// Translation helper. In the extension, chrome.i18n resolves keys from _locales
// (English is the default locale, and Chrome falls back to it for a missing key).
// In Node tests a fallback message table with the same format is used instead: the
// messages of one locale, backed by the English defaults, so every user-facing
// string lives in _locales and tests can render any shipped language.
let fallbackMessages = null;
let fallbackDefaults = null;
let fallbackLanguage = 'en';

// The report languages the Sitelemetry audit tools accept as their "lang" argument.
export const REPORT_LANGUAGES = Object.freeze(['en', 'tr', 'es', 'de', 'fr', 'pt', 'it', 'ja', 'zh']);

// messages: a locale's messages.json; defaults: the English messages used for keys
// the locale lacks; language: the UI language tag uiLanguage() reports in Node.
export function setFallbackMessages(messages, { defaults = null, language = 'en' } = {}) {
  fallbackMessages = messages && typeof messages === 'object' ? messages : null;
  fallbackDefaults = defaults && typeof defaults === 'object' ? defaults : null;
  fallbackLanguage = typeof language === 'string' && language ? language : 'en';
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

// A translator over one locale's messages, falling back to defaults (English) for
// a key the locale does not define, and to the key itself.
export function createTranslator(messages, defaults = null) {
  return (key, substitutions = []) => {
    const entry = messages?.[key] || defaults?.[key];
    return entry ? formatMessage(entry, substitutions) : key;
  };
}

export function t(key, substitutions = []) {
  const list = (Array.isArray(substitutions) ? substitutions : [substitutions]).map((value) => String(value ?? ''));
  const api = globalThis.chrome?.i18n;
  if (api && typeof api.getMessage === 'function') {
    const text = api.getMessage(key, list);
    if (text) return text;
  }
  const entry = fallbackMessages?.[key] || fallbackDefaults?.[key];
  if (entry) return formatMessage(entry, list);
  return key;
}

// The browser's UI language as a BCP 47 tag (for example "tr" or "pt-BR").
export function uiLanguage() {
  try {
    const tag = globalThis.chrome?.i18n?.getUILanguage?.();
    if (typeof tag === 'string' && tag) return tag;
  } catch {
    // Not available in this context; use the fallback below.
  }
  return fallbackLanguage;
}

// The report language to request for a UI language: the language the popup is
// shown in, so the service's reasons and findings read like the rest of the popup.
// Chinese is shipped in Simplified characters only (zh_CN), so a Traditional
// Chinese UI (zh-TW, zh-HK, zh-MO, zh-Hant) sees the English UI and gets English.
export function reportLanguage(tag) {
  const parts = String(tag ?? '').trim().toLowerCase().split(/[-_]/);
  const primary = parts[0];
  if (primary === 'zh' && parts.slice(1).some((part) => ['tw', 'hk', 'mo', 'hant'].includes(part))) return 'en';
  return REPORT_LANGUAGES.includes(primary) ? primary : 'en';
}

// Fill static markup: data-i18n sets textContent; data-i18n-title, -placeholder and
// -aria-label set the attribute of the same name. The page's lang attribute follows
// the translation that is shown, so CJK text is rendered with the right glyphs.
export function localizeDocument(root = globalThis.document) {
  if (!root) return;
  const tag = t('uiLanguageTag');
  if (root.documentElement && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag)) root.documentElement.lang = tag;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.getAttribute('data-i18n'));
  for (const attribute of ['title', 'placeholder', 'aria-label']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
}
