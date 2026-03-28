const CG_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=aleo&vs_currencies=usd";
const STORAGE_KEY = "vamm:strategy:coingecko:aleo-usd";
const CACHE_TTL_MS = 60_000;
const DEFAULT_BACKOFF_MS = 30_000;

let cachedEntry = null;
let inFlightRequest = null;
let nextAllowedFetchAt = 0;

function now() {
  return Date.now();
}

function normalizeEntry(value, fetchedAt = now()) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return { value, fetchedAt };
}

function readStoredEntry() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.value) || !Number.isFinite(parsed?.fetchedAt)) {
      return null;
    }
    return normalizeEntry(parsed.value, parsed.fetchedAt);
  } catch {
    return null;
  }
}

function writeStoredEntry(entry) {
  if (!entry || typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage failures; memory cache still works.
  }
}

function getCachedEntry() {
  if (cachedEntry) {
    return cachedEntry;
  }

  cachedEntry = readStoredEntry();
  return cachedEntry;
}

function setCachedEntry(value) {
  const entry = normalizeEntry(value);
  if (!entry) {
    return null;
  }

  cachedEntry = entry;
  writeStoredEntry(entry);
  return entry;
}

function isFresh(entry) {
  return Boolean(entry && now() - entry.fetchedAt <= CACHE_TTL_MS);
}

function parseRetryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  return DEFAULT_BACKOFF_MS;
}

async function fetchAleoUsdFromCoinGecko() {
  const response = await fetch(CG_PRICE_URL, {
    headers: { accept: "application/json" },
  });

  if (response.status === 429) {
    const backoffMs = parseRetryAfterMs(response);
    nextAllowedFetchAt = now() + backoffMs;
    const rateLimitError = new Error("CoinGecko rate limited");
    rateLimitError.code = 429;
    rateLimitError.retryAfterMs = backoffMs;
    throw rateLimitError;
  }

  if (!response.ok) {
    throw new Error(`CoinGecko price request failed: ${response.status}`);
  }

  const json = await response.json();
  const nextPrice = json?.aleo?.usd;
  if (typeof nextPrice !== "number") {
    throw new Error("Unexpected CoinGecko ALEO/USD response");
  }

  nextAllowedFetchAt = now() + CACHE_TTL_MS;
  return nextPrice;
}

export const coingeckoStrategy = {
  id: "coingecko",
  label: "CoinGecko",
  description: "Mid-price strategy backed by CoinGecko ALEO/USD market data.",
  async getMarketContext() {
    const cached = getCachedEntry();
    if (isFresh(cached)) {
      return { ...cached, source: "cache", stale: false };
    }

    if (inFlightRequest) {
      return inFlightRequest;
    }

    if (cached && now() < nextAllowedFetchAt) {
      return { ...cached, source: "cache", stale: true };
    }

    inFlightRequest = (async () => {
      try {
        const value = await fetchAleoUsdFromCoinGecko();
        const entry = setCachedEntry(value);
        return { ...entry, source: "network", stale: false };
      } catch (error) {
        const fallback = getCachedEntry();
        if (fallback) {
          return { ...fallback, source: "cache", stale: true, error };
        }
        throw error;
      } finally {
        inFlightRequest = null;
      }
    })();

    return inFlightRequest;
  },
};
