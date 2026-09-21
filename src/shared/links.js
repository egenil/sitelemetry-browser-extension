// Marketing and app links. These always point at the production site, whatever base
// URL the API client uses; the utm parameters identify this channel.
export const SITE_URL = 'https://sitelemetry.com';
export const UTM = 'utm_source=browser-extension&utm_medium=extension';
export const PRICING_URL = `${SITE_URL}/pricing?${UTM}`;
export const APP_URL = `${SITE_URL}/app`;
export const SIGNUP_URL = `${SITE_URL}/app?${UTM}`;
export const DEFAULT_BASE_URL = SITE_URL;
