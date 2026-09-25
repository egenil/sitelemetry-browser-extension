// The words for "report" and for "app" in each shipped language. Sitelemetry keeps
// no report of an audit run through the general /mcp endpoint the extension uses
// (the job keeps the result only while it is polled), so no text may send the user
// to one in the app. Used by the i18n, passing-check and AI fix prompt tests.
export const REPORT_WORDS = Object.freeze({
  en: /report/i, tr: /rapor/i, es: /informe/i, de: /Bericht/, fr: /rapport/i,
  pt_BR: /relatório/i, pt_PT: /relatório/i, it: /report/i, ja: /レポート/, zh_CN: /报告/
});
export const APP_WORDS = Object.freeze({
  en: /\bapp\b/i, tr: /uygulama/i, es: /\bapp\b/i, de: /\bApp\b/, fr: /application/i,
  pt_BR: /\bapp\b/i, pt_PT: /\bapp\b/i, it: /\bapp\b/i, ja: /アプリ/, zh_CN: /应用/
});
// Either word, for texts that must name neither.
export const REPORT_OR_APP = Object.freeze(Object.fromEntries(Object.keys(REPORT_WORDS).map((folder) => {
  const report = REPORT_WORDS[folder];
  return [folder, new RegExp(`${report.source}|${APP_WORDS[folder].source}`, report.flags)];
})));
