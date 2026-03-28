import { coingeckoStrategy } from "./coingecko";

const STRATEGIES = [coingeckoStrategy];

export function listVammStrategies() {
  return STRATEGIES.slice();
}

export function getVammStrategyById(strategyId) {
  return STRATEGIES.find((strategy) => strategy.id === strategyId) ?? STRATEGIES[0];
}

export function getDefaultVammStrategy() {
  return getVammStrategyById(import.meta.env.VITE_VAMM_STRATEGY_ID ?? "coingecko");
}

export function deriveTriggerPrice(assetIn, assetOut, aleoUsdPrice, presetMultiplier = 1) {
  if (!Number.isFinite(aleoUsdPrice) || aleoUsdPrice <= 0) {
    return "";
  }

  let baseValue = 1;
  if (assetIn === "ALEO" && assetOut === "USDCx") {
    baseValue = aleoUsdPrice;
  } else if (assetIn === "USDCx" && assetOut === "ALEO") {
    baseValue = 1 / aleoUsdPrice;
  }

  const value = baseValue * presetMultiplier;
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export function deriveQuoteAmount(amountIn, triggerPrice) {
  const sellAmount = Number(amountIn);
  const price = Number(triggerPrice);

  if (!Number.isFinite(sellAmount) || !Number.isFinite(price) || sellAmount < 0 || price <= 0) {
    return "0";
  }

  const quoted = sellAmount * price;
  if (quoted >= 1000) return quoted.toFixed(2);
  if (quoted >= 1) return quoted.toFixed(4);
  return quoted.toFixed(6);
}
