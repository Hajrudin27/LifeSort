export async function fetchExchangeRate(fromCurrency: string, toCurrency = 'DKK'): Promise<number | null> {
    if (fromCurrency === toCurrency) return 1;
  
    try {
      const response = await fetch(
        `https://api.frankfurter.app/latest?from=${fromCurrency}&to=${toCurrency}`
      );
      if (!response.ok) return null;
  
      const data = await response.json();
      const rate = data?.rates?.[toCurrency];
      return typeof rate === 'number' ? rate : null;
    } catch {
      // Ingen internetforbindelse, eller tjenesten er nede — vi lader kaldstedet
      // håndtere fejlen (gemmer udgiften uden omregning, i stedet for at fejle helt).
      return null;
    }
  }
  
  export const COMMON_CURRENCIES = ['DKK', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'CHF', 'JPY'];