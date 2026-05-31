/**
 * ISO-4217 currency-code → display symbol map.
 *
 * Used as a fallback when `siteSettings.currencySymbol` is unset, so any
 * country (not only Bangladeshi ৳) gets a sensible native-looking symbol.
 */

export const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: '৳', INR: '₹', PKR: '₨', LKR: 'Rs', NPR: 'Rs',
  USD: '$', CAD: 'C$', AUD: 'A$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', TWD: 'NT$', MXN: 'Mex$',
  ARS: '$', CLP: '$', COP: '$', BRL: 'R$', PEN: 'S/',
  EUR: '€', GBP: '£', CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł', CZK: 'Kč',
  RUB: '₽', UAH: '₴', TRY: '₺',
  JPY: '¥', CNY: '¥', KRW: '₩', VND: '₫', THB: '฿', IDR: 'Rp', MYR: 'RM', PHP: '₱',
  AED: 'د.إ', SAR: '﷼', QAR: '﷼', KWD: 'د.ك', BHD: '.د.ب', OMR: 'ر.ع.',
  EGP: 'E£', ILS: '₪', ZAR: 'R', NGN: '₦', KES: 'KSh', MAD: 'د.م.',
};

export function getCurrencySymbol(code?: string | null, fallback = '$'): string {
  if (!code) return fallback;
  return CURRENCY_SYMBOLS[code.toUpperCase()] || code.toUpperCase() + ' ';
}

/** Resolve symbol from siteSettings, preferring an explicit override. */
export function resolveCurrencySymbol(
  settings?: { currencySymbol?: string | null; currency?: string | null } | null,
  fallback = '$',
): string {
  const explicit = settings?.currencySymbol?.trim();
  if (explicit) return explicit;
  return getCurrencySymbol(settings?.currency, fallback);
}
