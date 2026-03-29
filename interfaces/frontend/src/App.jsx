import { useEffect, useMemo, useRef, useState } from "react";
import { AleoWalletProvider, useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { LeoWalletAdapter } from "@provablehq/aleo-wallet-adaptor-leo";
import { PuzzleWalletAdapter } from "@provablehq/aleo-wallet-adaptor-puzzle";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { SoterWalletAdapter } from "@provablehq/aleo-wallet-adaptor-soter";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission, getShortAddress } from "@provablehq/aleo-wallet-adaptor-core";
import {
  deriveQuoteAmount,
  deriveTriggerPrice,
  getDefaultVammStrategy,
} from "./strategies";
import {
  buildCreatePrivateCreditsRecordTransactionOptions,
  buildSettlementInputBundle,
  selectSpendableCreditsRecord as selectSpendableCreditsRecordHelper,
} from "./vamm";
import {
  ACTIVE_PROGRAM_ADDRESS,
  ACTIVE_PROGRAM_ID,
  buildAuthorizeOrderInputs,
  buildBoundsHash,
  buildIntentHash,
  createEphemeralSigner,
  getLatestBlockTimestamp,
  signRequesterIntent,
  toMicroAmount,
  u128,
  u64,
  verifyRequesterIntent,
  waitForTransactionVisible,
} from "./requester-intent";

const PROGRAMS = [
  ACTIVE_PROGRAM_ID,
  "test_usdcx_stablecoin.aleo",
  "credits.aleo",
];

const QUICK_PRICING_PRESETS = ["Market", "+1%", "+5%", "+10%"];
const EXPIRY_PRESETS = [
  { label: "5 mins", seconds: 300 },
  { label: "30 mins", seconds: 1800 },
  { label: "1 day", seconds: 86400 },
];
const DEFAULT_TRANSACTION_FEE = 300_000;
const VAMM_MAKER_API_BASE_URL = import.meta.env.VITE_VAMM_MAKER_API_BASE_URL ?? "";
const VAMM_MAKER_API_KEY = import.meta.env.VITE_VAMM_MAKER_API_KEY ?? "";
const VAMM_REVERSE_PREP_PATH =
  import.meta.env.VITE_VAMM_REVERSE_PREP_PATH ?? "/api/vamm/reverse-requester-prep";
const DEFAULT_VAMM_STRATEGY = getDefaultVammStrategy();
const VAMM_FRONTEND_DEFAULTS = {
  network: "Aleo testnet",
  settlementStrategy: DEFAULT_VAMM_STRATEGY.label,
  deadlineSeconds: String(EXPIRY_PRESETS[0].seconds),
};
const VAMM_MODE_FORWARD = "forward";
const VAMM_MODE_REVERSE = "reverse";

function tokenGlyph(asset) {
  if (asset === "ALEO") return "A";
  if (asset === "USDCx") return "$";
  return asset.slice(0, 1).toUpperCase();
}

function getPresetMultiplier(preset) {
  if (preset === "+1%") return 1.01;
  if (preset === "+5%") return 1.05;
  if (preset === "+10%") return 1.1;
  return 1;
}

function formatPayoutAmount(value) {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function derivePayoutBounds(amountOutTarget, downsidePct, upsidePct) {
  const quoted = Number(amountOutTarget);
  const down = Number(downsidePct);
  const up = Number(upsidePct);

  if (!Number.isFinite(quoted) || quoted < 0) {
    return { min: "0", max: "0" };
  }

  const min = quoted * (1 - (Number.isFinite(down) ? down : 0) / 100);
  const max = quoted * (1 + (Number.isFinite(up) ? up : 0) / 100);
  return {
    min: formatPayoutAmount(Math.max(min, 0)),
    max: formatPayoutAmount(Math.max(max, 0)),
  };
}

function deriveSymmetricPayoutBounds(amountOutTarget, tolerancePct) {
  return derivePayoutBounds(amountOutTarget, tolerancePct, tolerancePct);
}

function stringifyPayload(value) {
  return JSON.stringify(
    value,
    (_, current) => (typeof current === "bigint" ? current.toString() : current),
    2,
  );
}

function updateSubmitState(setSubmitState, status, message, extra = {}) {
  setSubmitState({ status, message, ...extra });
}

function isChainTransactionId(transactionId) {
  return typeof transactionId === "string" && transactionId.startsWith("at1");
}

function buildProvableExplorerTransactionUrl(transactionId) {
  return `https://testnet.explorer.provable.com/transaction/${transactionId}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRetryableWalletStatusMiss(error) {
  return /transaction not found|not found for given transaction id|could not get transaction status/i.test(
    String(error?.message ?? error),
  );
}

function isAcceptedWalletStatus(status) {
  return status === "accepted";
}

function extractPossibleTransactionId(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidates = [
    value.transactionId,
    value.txId,
    value.id,
    value.transaction?.id,
    value.transaction?.transactionId,
    value.result?.transactionId,
    value.result?.txId,
    value.result?.id,
    value.result?.transaction?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

async function waitForWalletSubmission(wallet, transactionId, onUpdate) {
  if (isChainTransactionId(transactionId)) {
    return {
      walletTransactionId: transactionId,
      chainTransactionId: transactionId,
      status: "accepted",
    };
  }

  const statusReader = wallet?.adapter?.transactionStatus;
  if (typeof statusReader !== "function") {
    onUpdate?.({
      type: "unresolved",
      walletTransactionId: transactionId,
      elapsedMs: 0,
      status: "status_reader_unavailable",
    });
    return {
      walletTransactionId: transactionId,
      chainTransactionId: null,
      status: "unresolved",
    };
  }

  const timeoutAt = Date.now() + 180_000;
  const startedAt = Date.now();
  let sawRetryableLookupMiss = false;

  while (Date.now() < timeoutAt) {
    let result;
    try {
      result = await statusReader.call(wallet.adapter, transactionId);
      console.log("wallet.transactionStatus raw result", {
        walletName: wallet?.adapter?.name,
        walletTransactionId: transactionId,
        result,
        extractedTransactionId: extractPossibleTransactionId(result),
      });
    } catch (error) {
      console.log("wallet.transactionStatus raw error", {
        walletName: wallet?.adapter?.name,
        walletTransactionId: transactionId,
        error: String(error?.message ?? error),
      });
      if (!isRetryableWalletStatusMiss(error)) {
        throw error;
      }

      sawRetryableLookupMiss = true;
      onUpdate?.({
        type: "pending",
        transactionId,
        status: "wallet_lookup_pending",
        elapsedMs: Date.now() - startedAt,
      });
      await sleep(2_000);
      continue;
    }

    const status = String(result?.status ?? "").toLowerCase();
    const resolvedTransactionId = extractPossibleTransactionId(result);

    if (isChainTransactionId(resolvedTransactionId)) {
      onUpdate?.({
        type: "resolved",
        transactionId: resolvedTransactionId,
        walletTransactionId: transactionId,
        elapsedMs: Date.now() - startedAt,
        status,
      });
      return {
        walletTransactionId: transactionId,
        chainTransactionId: resolvedTransactionId,
        status: status || "accepted",
      };
    }

    if (status.includes("reject") || status.includes("fail") || status.includes("abort") || status.includes("error")) {
      throw new Error(`Wallet transaction failed for ${transactionId}${result?.error ? `: ${result.error}` : ""}`);
    }

    if (isAcceptedWalletStatus(status)) {
      onUpdate?.({
        type: "accepted",
        walletTransactionId: transactionId,
        elapsedMs: Date.now() - startedAt,
        status,
      });
      return {
        walletTransactionId: transactionId,
        chainTransactionId: isChainTransactionId(resolvedTransactionId) ? resolvedTransactionId : null,
        status,
      };
    }

    onUpdate?.({ type: "pending", transactionId, status, elapsedMs: Date.now() - startedAt });
    await sleep(2_000);
  }

  if (sawRetryableLookupMiss && !isChainTransactionId(transactionId)) {
    onUpdate?.({
      type: "unresolved",
      walletTransactionId: transactionId,
      elapsedMs: Date.now() - startedAt,
      status: "wallet_lookup_timeout",
    });
    return {
      walletTransactionId: transactionId,
      chainTransactionId: null,
      status: "unresolved",
    };
  }

  throw new Error(`Wallet did not report accepted status for ${transactionId}`);
}

async function waitForVisibleTransaction(wallet, transactionId, onUpdate) {
  const submission = await waitForWalletSubmission(wallet, transactionId, onUpdate);
  if (submission.chainTransactionId) {
    await waitForTransactionVisible(submission.chainTransactionId, { onUpdate });
  }
  return submission;
}

function downloadPayload(payload) {
  const blob = new Blob([`${stringifyPayload(payload)}\n`], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `requester-order-${payload.order_id}.json`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

async function submitPayloadToVammMakerApi(payload) {
  if (!VAMM_MAKER_API_BASE_URL) {
    return null;
  }

  const response = await fetch(`${VAMM_MAKER_API_BASE_URL.replace(/\/$/, "")}/api/vamm/execute-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(VAMM_MAKER_API_KEY ? { Authorization: `Bearer ${VAMM_MAKER_API_KEY}` } : {}),
    },
    body: stringifyPayload({ payload }),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errorMessage = body?.error?.message ?? body?.error ?? `VAMM maker API returned ${response.status}`;
    throw new Error(errorMessage);
  }

  return body;
}

async function submitPayloadToVammReversePrepApi(payload) {
  if (!VAMM_MAKER_API_BASE_URL) {
    return null;
  }

  const response = await fetch(
    `${VAMM_MAKER_API_BASE_URL.replace(/\/$/, "")}${VAMM_REVERSE_PREP_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(VAMM_MAKER_API_KEY ? { Authorization: `Bearer ${VAMM_MAKER_API_KEY}` } : {}),
      },
      body: stringifyPayload({ payload }),
    },
  );

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errorMessage = body?.error?.message ?? body?.error ?? `VAMM reverse API returned ${response.status}`;
    throw new Error(errorMessage);
  }

  return body;
}

function TokenSelector({ asset, onChange, disabled = false }) {
  return (
    <label className={`token-pill${disabled ? " token-pill--locked" : ""}`}>
      <span className="token-pill__icon">{tokenGlyph(asset)}</span>
      <select value={asset} onChange={onChange} aria-label="Asset" disabled={disabled}>
        <option value="ALEO">ALEO</option>
        <option value="USDCx">USDCx</option>
      </select>
      <span className="token-pill__chevron">⌄</span>
    </label>
  );
}

function sanitizeNumericInput(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const [integerPart, ...rest] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const decimal = rest.join("").slice(0, 6);
  const hasTrailingDot = normalized.endsWith(".");
  if (hasTrailingDot) {
    return `${integer}.`;
  }
  const formatted = decimal ? `${integer}.${decimal}` : integer;
  if (formatted === "0") {
    return "0.00";
  }
  return formatted;
}

function formatNumericDisplay(value, decimals = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "0.00";
  }
  if (num === 0) {
    return "0.00";
  }
  return num
    .toFixed(Math.min(Math.max(decimals, 0), 6))
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function SwapLeg({ label, amount, asset, amountField, assetField, onFieldChange, readOnly = false, routeLocked = false }) {
  const isPlaceholder = !amount || amount === "0.00";
  return (
    <section className="swap-leg">
      <div className="swap-leg__label">{label}</div>
      <div className="swap-leg__row">
        <label className="swap-leg__amount">
          <span className="sr-only">{label} amount</span>
          <input
            className={isPlaceholder ? "swap-leg__input--muted" : ""}
            value={amount || "0.00"}
            onChange={(event) => {
              const sanitized = sanitizeNumericInput(event.target.value);
              onFieldChange(amountField)({ target: { value: sanitized } });
            }}
            placeholder="0.00"
            readOnly={readOnly}
            aria-readonly={readOnly}
          />
        </label>
        <TokenSelector asset={asset} onChange={onFieldChange(assetField)} disabled={routeLocked} />
      </div>
    </section>
  );
}

function WalletToolbar() {
  const { wallets, wallet, address, connected, connecting, disconnect, selectWallet, connect } = useWallet();
  const [open, setOpen] = useState(false);
  const [pendingWalletName, setPendingWalletName] = useState(null);
  const pickerRef = useRef(null);

  const availableWallets = wallets.filter((item) => item.readyState !== "Unsupported");

  useEffect(() => {
    if (!pendingWalletName) {
      return;
    }

    if (wallet?.adapter?.name !== pendingWalletName) {
      return;
    }

    let cancelled = false;

    async function connectSelectedWallet() {
      try {
        await connect();
        if (!cancelled) {
          setOpen(false);
        }
      } finally {
        if (!cancelled) {
          setPendingWalletName(null);
        }
      }
    }

    connectSelectedWallet();

    return () => {
      cancelled = true;
    };
  }, [connect, pendingWalletName, wallet]);

  useEffect(() => {
    const handleExternalOpen = () => setOpen(true);
    document.addEventListener("vamm-open-wallet-picker", handleExternalOpen);
    return () => document.removeEventListener("vamm-open-wallet-picker", handleExternalOpen);
  }, []);

  useEffect(() => {
    if (!open || !pickerRef.current) {
      return undefined;
    }

    const handleDocumentClick = (event) => {
      if (!pickerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, [open]);

  const handleWalletSelect = (walletName) => {
    setPendingWalletName(walletName);
    selectWallet(walletName);
  };

  return (
    <div className="wallet-toolbar">
      <button
        type="button"
        className="page-wallet-button page-wallet-button--custom"
        onClick={connected ? disconnect : () => setOpen((current) => !current)}
        disabled={connecting || Boolean(pendingWalletName)}
      >
        {connecting || pendingWalletName ? "Connecting..." : connected ? getShortAddress(address ?? "") : "Connect Wallet"}
      </button>

      {!connected && open ? (
        <section ref={pickerRef} className="wallet-picker" aria-label="Wallet provider picker">
          {availableWallets.map((item) => (
            <button
              key={String(item.adapter.name)}
              type="button"
              className="wallet-picker__item"
              onClick={() => handleWalletSelect(item.adapter.name)}
              disabled={Boolean(pendingWalletName)}
            >
              <span>{item.adapter.name}</span>
              <em>{item.readyState === "Installed" ? "Installed" : "Available"}</em>
            </button>
          ))}
          {wallet ? (
            <div className="wallet-picker__hint">Selected: {wallet.adapter.name}</div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function SwapModalCard() {
  const { address, connected, executeTransaction, wallet, connect, connecting } = useWallet();
  const routeLocked = true;
  const strategy = DEFAULT_VAMM_STRATEGY;
  const [executionMode, setExecutionMode] = useState(VAMM_MODE_FORWARD);

  const [form, setForm] = useState({
    assetIn: "USDCx",
    assetOut: "ALEO",
    amountIn: "0.00",
    amountOutTarget: "0.00",
    triggerPrice: "",
    quickPricing: "Market",
    expiry: EXPIRY_PRESETS[0].label,
    requesterTolerancePct: "2",
    deadlineSeconds: VAMM_FRONTEND_DEFAULTS.deadlineSeconds,
  });
  const [aleoUsdPrice, setAleoUsdPrice] = useState(null);
  const [triggerPriceManual, setTriggerPriceManual] = useState(false);
  const [submitState, setSubmitState] = useState({ status: "idle", message: "" });
  const [handoff, setHandoff] = useState(null);
  const isReverseMode = executionMode === VAMM_MODE_REVERSE;
  const routeLockedMessage = isReverseMode
    ? "Click the center arrow to switch back to the forward path."
    : "Click the center arrow to switch to the reverse path.";
  const vammExecutionStage = isReverseMode ? handoff?.reverseExecutionStatus : handoff?.makerExecutionStatus;
  const vammExecutionStageLabel = (() => {
    const labels = {
      preparing: "Generating Payload",
      ready: "Ready",
      pending: "Executing",
      executing: "Executing",
      success: "Settled",
      error: "Failed",
    };

    return labels[vammExecutionStage] ?? null;
  })();

  useEffect(() => {
    setForm((current) => {
      const nextAssetIn = isReverseMode ? "ALEO" : "USDCx";
      const nextAssetOut = isReverseMode ? "USDCx" : "ALEO";

      if (current.assetIn === nextAssetIn && current.assetOut === nextAssetOut) {
        return current;
      }

      return {
        ...current,
        assetIn: nextAssetIn,
        assetOut: nextAssetOut,
      };
    });
    setTriggerPriceManual(false);
    setSubmitState({ status: "idle", message: "" });
    setHandoff(null);
  }, [isReverseMode]);

  const updateField = (key) => (event) => {
    const nextValue = event.target.value;
    setForm((current) => ({ ...current, [key]: nextValue }));
    if (key === "triggerPrice") {
      setTriggerPriceManual(true);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadAleoUsdPrice() {
      try {
        const priceResult = await strategy.getMarketContext();
        if (!cancelled && typeof priceResult?.value === "number") {
          setAleoUsdPrice(priceResult.value);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(`Failed to load ${strategy.label} market context`, error);
        }
      }
    }

    loadAleoUsdPrice();
    const intervalId = window.setInterval(loadAleoUsdPrice, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (triggerPriceManual || aleoUsdPrice === null) {
      return;
    }

    setForm((current) => ({
      ...current,
      triggerPrice: deriveTriggerPrice(
        current.assetIn,
        current.assetOut,
        aleoUsdPrice,
        getPresetMultiplier(current.quickPricing),
      ),
    }));
  }, [aleoUsdPrice, triggerPriceManual, form.assetIn, form.assetOut, form.quickPricing]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      amountOutTarget: formatNumericDisplay(deriveQuoteAmount(current.amountIn, current.triggerPrice)),
    }));
  }, [form.amountIn, form.triggerPrice, form.assetIn, form.assetOut]);

  const payoutBoundsTarget = isReverseMode ? form.amountIn : form.amountOutTarget;
  const payoutBounds = useMemo(
    () => deriveSymmetricPayoutBounds(payoutBoundsTarget, form.requesterTolerancePct),
    [payoutBoundsTarget, form.requesterTolerancePct],
  );

  const flipAssets = () => {
    setExecutionMode((current) => (
      current === VAMM_MODE_FORWARD ? VAMM_MODE_REVERSE : VAMM_MODE_FORWARD
    ));
  };

  const fetchCreditsRecords = async () => {
    const requestRecords = wallet?.adapter?.requestRecords;
    if (typeof requestRecords !== "function") {
      throw new Error("This wallet does not expose record requests.");
    }

    const records = await requestRecords.call(wallet.adapter, "credits.aleo", true);
    console.log("reverse private record requestRecords raw:", records);
    try {
      console.log("reverse private record requestRecords JSON:", JSON.stringify(records, null, 2));
    } catch (jsonError) {
      console.log("reverse private record requestRecords JSON failed:", String(jsonError?.message ?? jsonError));
    }
    return records;
  };

  const selectReverseSettlementRecord = async (payload) => {
    const records = await fetchCreditsRecords();
    const spendableRecord = selectSpendableCreditsRecordHelper(records, {
      minimumMicrocredits: BigInt(String(payload.min_payout)),
      maximumMicrocredits: BigInt(String(payload.max_payout)),
    });
    console.log("reverse private record selected spendable record:", spendableRecord);
    return spendableRecord;
  };

  const waitForReverseSettlementRecord = async (payload, options = {}) => {
    const attempts = options.attempts ?? 6;
    const intervalMs = options.intervalMs ?? 2_000;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const spendableRecord = await selectReverseSettlementRecord(payload);
      if (spendableRecord) {
        return spendableRecord;
      }

      if (attempt < attempts - 1) {
        await sleep(intervalMs);
      }
    }

    return null;
  };

  const executeReverseSettlement = async (payload, reversePrepResponse) => {
    const reverseAuthorizeTxId =
      reversePrepResponse?.result?.authorizationTxId ??
      reversePrepResponse?.result?.requesterAuthorizationTx ??
      reversePrepResponse?.result?.authorizeTxId ??
      null;
    const reverseApprovalTxId =
      reversePrepResponse?.result?.approvalTxId ??
      reversePrepResponse?.result?.requesterApprovalTx ??
      null;
    const spendableRecord = await selectReverseSettlementRecord(payload);

    if (!spendableRecord) {
      setHandoff((current) => (
        current
          ? {
            ...current,
            reverseExecutionStatus: "ready",
            reverseNeedsPrivateRecord: true,
          }
          : current
      ));
      updateSubmitState(
        setSubmitState,
        "pending",
        "Settlement is ready, but your wallet needs a matching private ALEO record before it can continue.",
        {
          authorizeTxId: reverseAuthorizeTxId,
          approvalTxId: reverseApprovalTxId,
          debug: "VAMM requester prep is complete. Create the required private ALEO record now and settlement will continue automatically.",
        },
      );
      return null;
    }

    const settlementExecution = buildSettlementInputBundle(payload, {
      privateCreditsRecord: spendableRecord.recordPlaintext,
      program: reversePrepResponse?.result?.program ?? reversePrepResponse?.program ?? payload?.program ?? ACTIVE_PROGRAM_ID,
      requesterPublicAddress: payload.requester,
      requesterPrivateAddress: address,
      recipientPublicAddress: payload.recipient,
      recipientPrivateAddress: payload.recipient,
    });

    setHandoff((current) => (
      current
        ? {
          ...current,
          reverseExecutionStatus: "executing",
          reverseNeedsPrivateRecord: false,
          reverseSelectedRecord: spendableRecord,
        }
        : current
    ));

    updateSubmitState(
      setSubmitState,
      "pending",
      "Executing settlement from your wallet...",
      {
        authorizeTxId: reverseAuthorizeTxId,
        approvalTxId: reverseApprovalTxId,
      },
    );

    const settlementResult = await executeTransaction({
      ...settlementExecution,
      fee: settlementExecution.fee ?? DEFAULT_TRANSACTION_FEE,
      privateFee: settlementExecution.privateFee ?? false,
    });

    console.log("wallet.executeTransaction reverse settlement raw result", {
      walletName: wallet?.adapter?.name,
      result: settlementResult,
      extractedTransactionId: extractPossibleTransactionId(settlementResult),
    });

    const settlementTxId = extractPossibleTransactionId(settlementResult);
    if (!settlementTxId) {
      throw new Error("Wallet did not return a reverse settlement transaction ID.");
    }

    const settlementSubmission = await waitForVisibleTransaction(
      wallet,
      settlementTxId,
      ({ type, transactionId, walletTransactionId, status, elapsedMs }) => {
        if (type === "resolved") {
          setHandoff((current) => (
            current
              ? {
                ...current,
                reverseExecutionStatus: "success",
                reverseSettlementTxId: transactionId,
                reverseSettlementWalletTxId: walletTransactionId,
              }
              : current
          ));
          return;
        }

        if (type === "accepted" || type === "unresolved") {
          setHandoff((current) => (
            current
              ? {
                ...current,
                reverseExecutionStatus: "pending",
                reverseSettlementTxId: type === "accepted" ? transactionId : null,
                reverseSettlementWalletTxId: walletTransactionId ?? settlementTxId,
              }
              : current
          ));
          return;
        }

        if (type === "pending" && Number.isFinite(elapsedMs)) {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Executing settlement from your wallet...${status ? ` (${status})` : ""}${Number.isFinite(elapsedMs) ? ` after ${Math.floor(elapsedMs / 1000)}s` : ""}`,
            {
              authorizeTxId: reverseAuthorizeTxId,
              approvalTxId: reverseApprovalTxId,
            },
          );
        }
      },
    );

    setHandoff((current) => (
      current
        ? {
          ...current,
          reverseExecutionStatus: "success",
          reverseSettlementTxId: settlementSubmission.chainTransactionId ?? settlementTxId,
          reverseSettlementWalletTxId: settlementSubmission.walletTransactionId ?? settlementTxId,
          reverseSettlementResult: settlementResult,
        }
        : current
    ));

    updateSubmitState(
      setSubmitState,
      "success",
      settlementSubmission.chainTransactionId
        ? "Reverse trade settled successfully through VAMM."
        : "Reverse payload executed from your wallet.",
      {
        authorizeTxId: reverseAuthorizeTxId,
        approvalTxId: reverseApprovalTxId,
        debug: settlementSubmission.chainTransactionId
          ? `Settlement confirmed in tx ${settlementSubmission.chainTransactionId}.`
          : "",
      },
    );

    return settlementSubmission;
  };

  const createPrivateCreditsRecordAndContinue = async () => {
    if (!handoff?.payload || !address) {
      return;
    }

    try {
      const exactRecordAmount = BigInt(String(handoff.payload.max_payout)) === BigInt(String(handoff.payload.min_payout))
        ? BigInt(String(handoff.payload.max_payout))
        : BigInt(toMicroAmount(Number(form.amountIn)));

      setHandoff((current) => (
        current
          ? {
            ...current,
            reverseExecutionStatus: "preparing",
          }
          : current
      ));
      updateSubmitState(
        setSubmitState,
        "pending",
        "Creating a private ALEO record in your wallet...",
        {
          authorizeTxId: handoff.authorizeTxId ?? null,
          approvalTxId: handoff.approvalTxId ?? null,
        },
      );

      const createRecordOptions = buildCreatePrivateCreditsRecordTransactionOptions({
        ownerAddress: address,
        amountMicrocredits: exactRecordAmount,
        fee: DEFAULT_TRANSACTION_FEE,
        privateFee: false,
      });
      const creationResult = await executeTransaction(createRecordOptions);
      const creationTxId = extractPossibleTransactionId(creationResult);
      if (!creationTxId) {
        throw new Error("Wallet did not return a create-record transaction ID.");
      }

      updateSubmitState(
        setSubmitState,
        "pending",
        "Waiting for the new private ALEO record to appear in your wallet...",
        {
          authorizeTxId: handoff.authorizeTxId ?? null,
          approvalTxId: handoff.approvalTxId ?? null,
        },
      );

      await waitForVisibleTransaction(wallet, creationTxId);
      const spendableRecord = await waitForReverseSettlementRecord(handoff.payload, {
        attempts: 8,
        intervalMs: 2_000,
      });

      setHandoff((current) => (
        current
          ? {
            ...current,
            reverseFundingTxId: creationTxId,
            reverseExecutionStatus: "ready",
            reverseSelectedRecord: spendableRecord,
          }
          : current
      ));

      await executeReverseSettlement(handoff.payload, handoff.reversePrepResponse);
    } catch (error) {
      console.error("Reverse private record creation failed", error);
      setHandoff((current) => (
        current
          ? {
            ...current,
            reverseExecutionStatus: "error",
            reverseExecutionError: String(error?.message ?? error),
          }
          : current
      ));
      setSubmitState({
        status: "error",
        message: `Creating a private ALEO record failed: ${String(error?.message ?? error)}`,
      });
    }
  };

  const handleReverseSubmit = async (event) => {
    event.preventDefault();

    setSubmitState({ status: "idle", message: "" });
    setHandoff(null);

    if (!connected || !address) {
      setSubmitState({ status: "idle", message: "" });
      document.dispatchEvent(new Event("vamm-open-wallet-picker"));
      return;
    }

    if (typeof executeTransaction !== "function") {
      setSubmitState({ status: "error", message: "The connected wallet does not expose transaction execution." });
      return;
    }

    if (!VAMM_MAKER_API_BASE_URL) {
      setSubmitState({
        status: "error",
        message: "Set VITE_VAMM_MAKER_API_BASE_URL to enable reverse VAMM execution.",
      });
      return;
    }

    if (form.assetIn !== "ALEO" || form.assetOut !== "USDCx") {
      setSubmitState({
        status: "error",
        message: "Reverse mode expects the user to sell ALEO for USDCx.",
      });
      return;
    }

    const sellAmount = Number(form.amountIn);
    const minPayout = Number(payoutBounds.min);
    const maxPayout = Number(payoutBounds.max);

    if (!Number.isFinite(sellAmount) || sellAmount <= 0) {
      setSubmitState({ status: "error", message: "Enter a valid ALEO sell amount." });
      return;
    }

    if (!Number.isFinite(minPayout) || !Number.isFinite(maxPayout) || maxPayout <= 0 || minPayout < 0) {
      setSubmitState({ status: "error", message: "The reverse ALEO settlement band must produce a valid range." });
      return;
    }

    if (minPayout > maxPayout) {
      setSubmitState({ status: "error", message: "Reverse ALEO settlement minimum cannot exceed the maximum." });
      return;
    }

    try {
      updateSubmitState(setSubmitState, "pending", "Generating payload with VAMM...");
      setHandoff({
        mode: VAMM_MODE_REVERSE,
        reverseExecutionStatus: "preparing",
        reverseSettlementTxId: null,
        reverseSettlementWalletTxId: null,
        readyForSettlement: false,
      });

      const latestTimestamp = await getLatestBlockTimestamp();
      const orderId = Date.now();
      const sellAmountMicro = toMicroAmount(sellAmount);
      const buyAmountMicro = toMicroAmount(Number(form.amountOutTarget));
      const minPayoutMicrocredits = toMicroAmount(minPayout);
      const maxPayoutMicrocredits = toMicroAmount(maxPayout);
      const expiryTimestamp = latestTimestamp + Number(form.deadlineSeconds);

      const reversePrepRequest = {
        order_id: orderId,
        direction: "reverse",
        executor_address: address,
        asset_in: form.assetIn,
        asset_out: form.assetOut,
        amount_in: sellAmountMicro.toString(),
        amount_out_target: buyAmountMicro.toString(),
        approval_amount: buyAmountMicro.toString(),
        trigger_price: form.triggerPrice,
        expiry_timestamp: expiryTimestamp,
        min_payout: minPayoutMicrocredits.toString(),
        max_payout: maxPayoutMicrocredits.toString(),
        requester_tolerance_pct: form.requesterTolerancePct,
        deadline_seconds: form.deadlineSeconds,
        settlement_strategy: strategy.label,
        mode: VAMM_MODE_REVERSE,
      };

      const reversePrepResponse = await submitPayloadToVammReversePrepApi(reversePrepRequest);
      const reversePayload =
        reversePrepResponse?.payload ??
        reversePrepResponse?.result?.payload ??
        reversePrepResponse?.data?.payload ??
        reversePrepResponse ??
        reversePrepRequest;
      const reverseAuthorizeTxId =
        reversePrepResponse?.authorize_tx_id ??
        reversePrepResponse?.authorizeTxId ??
        reversePrepResponse?.result?.authorize_tx_id ??
        reversePrepResponse?.result?.authorizeTxId ??
        reversePrepResponse?.result?.authorizationTxId ??
        reversePrepResponse?.result?.requesterAuthorizationTx ??
        null;
      const reverseApprovalTxId =
        reversePrepResponse?.approval_tx_id ??
        reversePrepResponse?.approvalTxId ??
        reversePrepResponse?.result?.approval_tx_id ??
        reversePrepResponse?.result?.approvalTxId ??
        reversePrepResponse?.result?.requesterApprovalTx ??
        null;
      setHandoff({
        mode: VAMM_MODE_REVERSE,
        payload: reversePayload,
        payloadJson: stringifyPayload(reversePayload),
        reversePrepResponse,
        reverseExecutionStatus: "ready",
        reverseSettlementTxId: null,
        reverseSettlementWalletTxId: null,
        reverseNeedsPrivateRecord: false,
        authorizeTxId: reverseAuthorizeTxId,
        approvalTxId: reverseApprovalTxId,
        readyForSettlement: true,
      });

      updateSubmitState(
        setSubmitState,
        "pending",
        "Payload ready. Checking your wallet for a spendable private ALEO record...",
        {
          authorizeTxId: reverseAuthorizeTxId,
          approvalTxId: reverseApprovalTxId,
        },
      );
      await executeReverseSettlement(reversePayload, reversePrepResponse);
    } catch (error) {
      console.error("Reverse VAMM settlement failed", error);
      setHandoff((current) => (
        current
          ? {
            ...current,
            reverseExecutionStatus: "error",
            reverseExecutionError: String(error?.message ?? error),
          }
          : current
      ));
      setSubmitState({
        status: "error",
        message: `Reverse VAMM execution failed: ${String(error?.message ?? error)}`,
      });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (executionMode === VAMM_MODE_REVERSE) {
      return handleReverseSubmit(event);
    }

    setSubmitState({ status: "idle", message: "" });
    setHandoff(null);

    if (!connected || !address) {
      // setSubmitState({ status: "error", message: "Connect an Aleo wallet before confirming." });
      document.dispatchEvent(new Event("vamm-open-wallet-picker"));
      return;
    }

    if (typeof executeTransaction !== "function") {
      setSubmitState({ status: "error", message: "The connected wallet does not expose transaction execution." });
      return;
    }

    if (form.assetIn !== "USDCx" || form.assetOut !== "ALEO") {
      setSubmitState({
        status: "error",
        message: "Current maker execution only supports requester selling USDCx for ALEO.",
      });
      return;
    }

    const sellAmount = Number(form.amountIn);
    const minPayout = Number(payoutBounds.min);
    const maxPayout = Number(payoutBounds.max);

    if (!Number.isFinite(sellAmount) || sellAmount <= 0) {
      setSubmitState({ status: "error", message: "Enter a valid USDCx sell amount." });
      return;
    }

    if (!Number.isFinite(minPayout) || !Number.isFinite(maxPayout) || maxPayout <= 0 || minPayout < 0) {
      setSubmitState({ status: "error", message: "The requester payout band must produce a valid ALEO range." });
      return;
    }

    if (minPayout > maxPayout) {
      setSubmitState({ status: "error", message: "Requester minimum payout cannot exceed the maximum payout." });
      return;
    }

    try {
      updateSubmitState(setSubmitState, "pending", "Signing delegated intent...");

      const latestTimestamp = await getLatestBlockTimestamp();
      const approvalAmount = toMicroAmount(sellAmount);
      const minPayoutMicrocredits = toMicroAmount(minPayout);
      const maxPayoutMicrocredits = toMicroAmount(maxPayout);
      const expiryTimestamp = latestTimestamp + Number(form.deadlineSeconds);
      const orderId = Date.now();
      const recipientAddress = address;
      const boundsHash = await buildBoundsHash(minPayoutMicrocredits, maxPayoutMicrocredits);
      const intentHash = await buildIntentHash(
        orderId,
        approvalAmount,
        address,
        expiryTimestamp,
        boundsHash,
        recipientAddress,
      );
      const { privateKey: ephemeralPrivateKey, address: ephemeralSignerAddress } = await createEphemeralSigner();
      const ephemeralSignature = signRequesterIntent(ephemeralPrivateKey, intentHash);

      if (!(await verifyRequesterIntent(ephemeralSignerAddress, ephemeralSignature, intentHash))) {
        throw new Error("Ephemeral signer does not verify against the derived requester intent.");
      }

      updateSubmitState(setSubmitState, "pending", "Authorizing ephemeral signer...");

      const authorize = await executeTransaction({
        program: ACTIVE_PROGRAM_ID,
        function: "authorize_order",
        inputs: buildAuthorizeOrderInputs(orderId, ephemeralSignerAddress, recipientAddress),
        fee: DEFAULT_TRANSACTION_FEE,
        privateFee: false,
      });
      console.log("authorize raw:", authorize);
      console.log("authorize keys:", Object.keys(authorize || {}));
      console.log("authorize.transactionId:", authorize?.transactionId);
      console.log("authorize.txId:", authorize?.txId);
      console.log("authorize.id:", authorize?.id);
      console.log("authorize.transaction?.id:", authorize?.transaction?.id);
      try {
        console.log("authorize JSON:", JSON.stringify(authorize, null, 2));
      } catch (error) {
        console.log("authorize JSON failed:", String(error?.message ?? error));
        console.log("authorize entries:", Object.entries(authorize || {}));
      }
      console.log("wallet.executeTransaction authorize_order raw result", {
        walletName: wallet?.adapter?.name,
        result: authorize,
        extractedTransactionId: extractPossibleTransactionId(authorize),
      });
      if (!authorize?.transactionId) {
        throw new Error("Wallet did not return an authorization transaction ID.");
      }

      updateSubmitState(
        setSubmitState,
        "pending",
        `Authorization submitted. Waiting for testnet indexing...`,
        { authorizeTxId: authorize.transactionId },
      );

      const authorizeSubmission = await waitForVisibleTransaction(wallet, authorize.transactionId, ({ type, transactionId, walletTransactionId, status, elapsedMs }) => {
        if (type === "resolved") {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Authorization accepted by wallet. Waiting for testnet indexing...`,
            { authorizeWalletTxId: walletTransactionId, authorizeTxId: transactionId },
          );
          return;
        }

        if (type === "accepted") {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Authorization accepted by wallet.${Number.isFinite(elapsedMs) ? ` Confirmed after ${Math.floor(elapsedMs / 1000)}s.` : ""}`,
            {
              authorizeWalletTxId: walletTransactionId,
              authorizeTxId: null,
              debug: `Wallet accepted authorize_order but did not expose a real at1... tx id.`,
            },
          );
          return;
        }

        if (type === "unresolved") {
          updateSubmitState(
            setSubmitState,
            "pending",
            "Authorization submitted, but the wallet did not expose a chain transaction id.",
            {
              authorizeWalletTxId: walletTransactionId ?? authorize.transactionId,
              authorizeTxId: null,
              debug: "Continuing with the wallet submission id only. Maker fill may still need the final on-chain at1... id.",
            },
          );
          return;
        }

        if (type === "pending" && !isChainTransactionId(authorize.transactionId)) {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Authorizing ephemeral signer... wallet is still resolving ${authorize.transactionId}${status ? ` (${status})` : ""}${Number.isFinite(elapsedMs) ? ` after ${Math.floor(elapsedMs / 1000)}s` : ""}.`,
            {
              authorizeWalletTxId: authorize.transactionId,
              debug: `Shield/adapter has not produced a real at1... tx id yet.`,
            },
          );
          return;
        }

        if (type === "lagging") {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Authorizing ephemeral signer... testnet indexing is slow, still waiting on ${transactionId}.`,
            { authorizeWalletTxId: walletTransactionId, authorizeTxId: transactionId },
          );
        }
      });

      const authorizeTxId = authorizeSubmission.chainTransactionId;
      const authorizeWalletTxId = authorizeSubmission.walletTransactionId;

      updateSubmitState(
        setSubmitState,
        "pending",
        "Approving spender...",
        { authorizeWalletTxId, authorizeTxId },
      );

      const approval = await executeTransaction({
        program: "test_usdcx_stablecoin.aleo",
        function: "approve_public",
        inputs: [ACTIVE_PROGRAM_ADDRESS, u128(approvalAmount)],
        fee: DEFAULT_TRANSACTION_FEE,
        privateFee: false,
      });
      console.log("wallet.executeTransaction approve_public raw result", {
        walletName: wallet?.adapter?.name,
        result: approval,
        extractedTransactionId: extractPossibleTransactionId(approval),
      });
      if (!approval?.transactionId) {
        throw new Error("Wallet did not return an approval transaction ID.");
      }

      updateSubmitState(
        setSubmitState,
        "pending",
        "Approval submitted. Waiting for testnet indexing...",
        {
          authorizeTxId: authorizeTxId,
          approvalTxId: approval.transactionId,
        },
      );

      const approvalSubmission = await waitForVisibleTransaction(wallet, approval.transactionId, ({ type, transactionId, walletTransactionId, status, elapsedMs }) => {
        if (type === "resolved") {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Approval accepted by wallet. Waiting for testnet indexing...`,
            {
              authorizeWalletTxId,
              authorizeTxId,
              approvalWalletTxId: walletTransactionId,
              approvalTxId: transactionId,
            },
          );
          return;
        }

        if (type === "accepted") {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Approval accepted by wallet.${Number.isFinite(elapsedMs) ? ` Confirmed after ${Math.floor(elapsedMs / 1000)}s.` : ""}`,
            {
              authorizeWalletTxId,
              authorizeTxId,
              approvalWalletTxId: walletTransactionId,
              approvalTxId: null,
              debug: `Wallet accepted approve_public but did not expose a real at1... tx id.`,
            },
          );
          return;
        }

        if (type === "unresolved") {
          updateSubmitState(
            setSubmitState,
            "pending",
            "Approval submitted, but the wallet did not expose a chain transaction id.",
            {
              authorizeWalletTxId,
              authorizeTxId,
              approvalWalletTxId: walletTransactionId ?? approval.transactionId,
              approvalTxId: null,
              debug: "Continuing with the wallet submission id only. Maker fill may still need the final on-chain at1... id.",
            },
          );
          return;
        }

        if (type === "pending" && !isChainTransactionId(approval.transactionId)) {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Approving spender... wallet is still resolving ${approval.transactionId}${status ? ` (${status})` : ""}${Number.isFinite(elapsedMs) ? ` after ${Math.floor(elapsedMs / 1000)}s` : ""}.`,
            {
              authorizeWalletTxId,
              authorizeTxId,
              approvalWalletTxId: approval.transactionId,
              debug: `Shield/adapter has not produced a real at1... tx id yet.`,
            },
          );
          return;
        }

        if (type === "lagging") {
          updateSubmitState(
            setSubmitState,
            "pending",
            `Approving spender... testnet indexing is slow, still waiting on ${transactionId}.`,
            {
              authorizeWalletTxId,
              authorizeTxId,
              approvalWalletTxId: walletTransactionId,
              approvalTxId: transactionId,
            },
          );
        }
      });

      const approvalTxId = approvalSubmission.chainTransactionId;
      const approvalWalletTxId = approvalSubmission.walletTransactionId;

      const payload = {
        order_id: orderId,
        approval_amount: approvalAmount.toString(),
        requester: address,
        recipient: recipientAddress,
        ephemeral_signer: ephemeralSignerAddress,
        expiry_timestamp: expiryTimestamp,
        min_payout: minPayoutMicrocredits.toString(),
        max_payout: maxPayoutMicrocredits.toString(),
        bounds_hash: boundsHash,
        intent_hash: intentHash,
        signature: ephemeralSignature,
        authorize_tx_id: authorizeTxId,
        authorize_wallet_tx_id: authorizeWalletTxId,
        approval_tx_id: approvalTxId,
        approval_wallet_tx_id: approvalWalletTxId,
      };

      setHandoff({
        payload,
        payloadJson: stringifyPayload(payload),
        approvalReference: approvalTxId ?? approvalWalletTxId,
        approvalWalletReference: approvalWalletTxId,
        authorizationReference: authorizeTxId ?? authorizeWalletTxId,
        authorizationWalletReference: authorizeWalletTxId,
        readyForMakerFill: Boolean(authorizeTxId && approvalTxId),
        makerExecutionStatus: authorizeTxId && approvalTxId && VAMM_MAKER_API_BASE_URL ? "pending" : "idle",
      });
      if (authorizeTxId && approvalTxId && VAMM_MAKER_API_BASE_URL) {
        updateSubmitState(
          setSubmitState,
          "pending",
          "Forwarding payload to the VAMM maker API...",
          {
            authorizeWalletTxId,
            authorizeTxId,
            approvalWalletTxId,
            approvalTxId,
          },
        );

        try {
          const makerExecution = await submitPayloadToVammMakerApi(payload);
          setHandoff((current) => (
            current
              ? {
                ...current,
                makerExecution,
                makerExecutionStatus: "success",
              }
              : current
          ));
          updateSubmitState(
            setSubmitState,
            "success",
            makerExecution?.result?.settlementTx
              ? "Trade settled successfully through VAMM."
              : "Payload forwarded to the VAMM maker API.",
            {
              authorizeWalletTxId,
              authorizeTxId,
              approvalWalletTxId,
              approvalTxId,
              debug: makerExecution?.result?.settlementTx
                ? `Settlement confirmed in tx ${makerExecution.result.settlementTx}.`
                : "",
            },
          );
        } catch (apiError) {
          setHandoff((current) => (
            current
              ? {
                ...current,
                makerExecutionStatus: "error",
                makerExecutionError: String(apiError?.message ?? apiError),
              }
              : current
          ));
          updateSubmitState(
            setSubmitState,
            "error",
            `Requester payload is ready, but VAMM API execution failed: ${String(apiError?.message ?? apiError)}`,
            {
              authorizeWalletTxId,
              authorizeTxId,
              approvalWalletTxId,
              approvalTxId,
            },
          );
        }
      } else {
        updateSubmitState(
          setSubmitState,
          "success",
          authorizeTxId && approvalTxId
            ? "Ready for maker fill."
            : "Requester wallet steps completed, but the wallet did not expose real chain tx ids.",
          {
            authorizeWalletTxId,
            authorizeTxId,
            approvalWalletTxId,
            approvalTxId,
            debug:
              authorizeTxId && approvalTxId
                ? (VAMM_MAKER_API_BASE_URL ? "" : "Set VITE_VAMM_MAKER_API_BASE_URL to forward payloads to the VAMM API automatically.")
                : "Payload includes wallet submission ids. The maker script still needs real on-chain tx ids if it verifies them on the network.",
          },
        );
      }
    } catch (error) {
      console.error("Requester handoff failed", error);
      setSubmitState({
        status: "error",
        message: String(error?.message ?? error),
      });
    }
  };

  return (
    <section className="swap-modal" role="dialog" aria-modal="true" aria-label="VAMM swap modal">
      <header className="swap-modal__header">
        <div>
          <h1>Swap</h1>
          <p className="swap-modal__subtitle">
            {isReverseMode
              ? "Reverse mode asks VAMM to prepare the payload, then the wallet executes settlement."
              : "Current mode keeps the existing requester-led USDCx -> ALEO flow intact."}
          </p>
        </div>
      </header>

      <form className="swap-modal__stack" onSubmit={handleSubmit}>
        <section className="trigger-card">
          <div className="trigger-card__topline">
            <span>
              When 1 <strong>{form.assetIn}</strong> is worth
            </span>
          </div>

          <div className="trigger-card__value-row">
            <label className="trigger-card__value">
              <span className="sr-only">Trigger price</span>
              <input value={form.triggerPrice} onChange={updateField("triggerPrice")} />
            </label>
            <div className="trigger-card__quote-pill">
              <span className="token-pill__icon">{tokenGlyph(form.assetOut)}</span>
              {form.assetOut}
            </div>
          </div>

          <div className="preset-row">
            {QUICK_PRICING_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`preset-pill${form.quickPricing === preset ? " preset-pill--active" : ""}`}
                onClick={() => {
                  setTriggerPriceManual(false);
                  setForm((current) => ({ ...current, quickPricing: preset }));
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </section>

        <div className="swap-legs">
          <SwapLeg
            label="Sell"
            amount={form.amountIn}
            asset={form.assetIn}
            amountField="amountIn"
            assetField="assetIn"
            onFieldChange={updateField}
            routeLocked={routeLocked}
          />

          <div className="swap-legs__switch">
            <button
              type="button"
              className="switch-button"
              onClick={flipAssets}
              aria-label="Flip assets"
              title={routeLockedMessage}
            >
              ↓
            </button>
          </div>

          <SwapLeg
            label="Buy"
            amount={form.amountOutTarget}
            asset={form.assetOut}
            amountField="amountOutTarget"
            assetField="assetOut"
            onFieldChange={updateField}
            readOnly
            routeLocked={routeLocked}
          />
        </div>

        <section className="payout-band-fixed">
          <div className="payout-band-fixed__label">
            {isReverseMode ? "ALEO settlement band" : "Requester payout band"}
          </div>
          <div className="payout-band-fixed__row">
            <label className="range-input range-input--single">
              <span>+/-</span>
              <input value={form.requesterTolerancePct} onChange={updateField("requesterTolerancePct")} placeholder="20" />
              <em>%</em>
            </label>
            <div className="payout-summary__values">
              <strong>{payoutBounds.min}</strong>
              <span>to</span>
              <strong>{payoutBounds.max}</strong>
            </div>
          </div>
        </section>

        <div className="expiry-row">
          <span className="expiry-row__label">Expiry</span>
          <div className="preset-row preset-row--compact">
            {EXPIRY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`preset-pill${form.expiry === preset.label ? " preset-pill--active" : ""}`}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    expiry: preset.label,
                    deadlineSeconds: String(preset.seconds),
                  }))
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" className="confirm-button" disabled={submitState.status === "pending"}>
          {submitState.status === "pending"
            ? "Working..."
            : connected
              ? "Swap"
              : "Connect"}
        </button>

        {submitState.message ? (
          <section className={`feedback feedback--${submitState.status}`} aria-live="polite">
            {vammExecutionStageLabel ? (
              <div className="feedback__vamm-header">
                <strong>VAMM Execution</strong>
                <span
                  className={`handoff-card__status ${
                    vammExecutionStage === "success"
                      ? "handoff-card__status--success"
                      : vammExecutionStage === "error"
                        ? "handoff-card__status--error"
                        : "handoff-card__status--pending"
                  }`}
                >
                  {vammExecutionStageLabel}
                </span>
              </div>
            ) : null}
            <div className="feedback__message">{submitState.message}</div>
            {submitState.debug ? <div className="feedback__debug">{submitState.debug}</div> : null}
            {handoff?.mode === VAMM_MODE_REVERSE && handoff?.reverseNeedsPrivateRecord ? (
              <div className="feedback__actions">
                <button type="button" className="feedback__action-button" onClick={createPrivateCreditsRecordAndContinue}>
                  Create Matching Private ALEO Record
                </button>
              </div>
            ) : null}
            {handoff?.mode === VAMM_MODE_REVERSE && handoff?.reverseSettlementTxId ? (
              <div className="feedback__tx">
                <span>settle_order tx</span>
                <a
                  className="feedback__link"
                  href={buildProvableExplorerTransactionUrl(handoff.reverseSettlementTxId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {handoff.reverseSettlementTxId}
                </a>
              </div>
            ) : null}
            {handoff?.mode === VAMM_MODE_REVERSE && handoff?.reverseFundingTxId ? (
              <div className="feedback__tx">
                <span>private record creation tx</span>
                <a
                  className="feedback__link"
                  href={buildProvableExplorerTransactionUrl(handoff.reverseFundingTxId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {handoff.reverseFundingTxId}
                </a>
              </div>
            ) : null}
            {handoff?.mode !== VAMM_MODE_REVERSE && handoff?.makerExecution?.result?.settlementTx ? (
              <div className="feedback__tx">
                <span>settle_order tx</span>
                <a
                  className="feedback__link"
                  href={buildProvableExplorerTransactionUrl(handoff.makerExecution.result.settlementTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {handoff.makerExecution.result.settlementTx}
                </a>
              </div>
            ) : null}
            {submitState.authorizeTxId ? (
              <div className="feedback__tx">
                <span>authorize_order chain tx</span>
                <code>{submitState.authorizeTxId}</code>
              </div>
            ) : null}
            {submitState.authorizeWalletTxId ? (
              <div className="feedback__tx">
                <span>authorize_order wallet tx</span>
                <code>{submitState.authorizeWalletTxId}</code>
              </div>
            ) : null}
            {submitState.approvalTxId ? (
              <div className="feedback__tx">
                <span>approve_public chain tx</span>
                <code>{submitState.approvalTxId}</code>
              </div>
            ) : null}
            {submitState.approvalWalletTxId ? (
              <div className="feedback__tx">
                <span>approve_public wallet tx</span>
                <code>{submitState.approvalWalletTxId}</code>
              </div>
            ) : null}
          </section>
        ) : null}
      </form>
    </section>
  );
}

function VammSwapShell() {
  return (
    <main className="app-shell">
      <div className="page-topbar" aria-label="Page wallet controls">
        <span className="page-network-pill">Testnet</span>
        <WalletToolbar />
      </div>
      <div className="page-center">
        <SwapModalCard />
      </div>
    </main>
  );
}

export default function App() {
  const wallets = useMemo(
    () => [
      new LeoWalletAdapter({
        appName: "VAMM Agent",
        appDescription: "Requester swap intake for VAMM execution on Aleo testnet.",
        programIdPermissions: {
          testnetbeta: PROGRAMS,
        },
      }),
      new PuzzleWalletAdapter({
        appName: "VAMM Agent",
        appDescription: "Requester swap intake for VAMM execution on Aleo testnet.",
        programIdPermissions: {
          testnet: PROGRAMS,
        },
      }),
      new ShieldWalletAdapter({
        appName: "VAMM Agent",
        appDescription: "Requester swap intake for VAMM execution on Aleo testnet.",
      }),
      new SoterWalletAdapter({
        appName: "VAMM Agent",
        appDescription: "Requester swap intake for VAMM execution on Aleo testnet.",
      }),
    ],
    [],
  );

  return (
    <AleoWalletProvider
      wallets={wallets}
      network={Network.TESTNET}
      autoConnect={false}
      decryptPermission={DecryptPermission.UponRequest}
      programs={PROGRAMS}
      onError={(error) => {
        console.error("Aleo wallet error", error);
      }}
    >
      <VammSwapShell />
    </AleoWalletProvider>
  );
}
