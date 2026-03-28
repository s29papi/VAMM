function nowIso() {
  return new Date().toISOString();
}

function buildMockId(prefix) {
  const random = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${random}`;
}

export function getMockCapabilities() {
  return {
    actions: [
      "status",
      "balances",
      "quote",
      "settle"
    ],
    mode: "mock",
    notes: [
      "quote uses placeholder pricing logic",
      "settle returns mock transaction identifiers",
      "replace handlers in interfaces/tool/vamm-agent-mock-runtime.mjs with live logic"
    ]
  };
}

export function createMockQuote({ targetAleo = 0.02, bufferBps = 500 } = {}) {
  const aleoUsd = 0.055;
  const usdcxAmount = Number((targetAleo * aleoUsd * (1 + bufferBps / 10_000)).toFixed(6));

  return {
    kind: "quote",
    mode: "mock",
    createdAt: nowIso(),
    aleoUsdPrice: aleoUsd,
    targetAleo,
    bufferBps,
    approvalUsdcx: usdcxAmount,
    settlementRoute: "public-usdcx-to-private-maker / private-aleo-to-private-requester"
  };
}

export function createMockSettlement({
  requester = "aleo1requesterplaceholder",
  maker = "aleo1makerplaceholder",
  targetAleo = 0.02,
  approvalUsdcx = "1150"
} = {}) {
  return {
    kind: "settlement",
    mode: "mock",
    createdAt: nowIso(),
    requester,
    maker,
    targetAleo,
    approvalUsdcx,
    requesterApprovalTx: buildMockId("approve"),
    makerFundingTx: buildMockId("fund"),
    settlementTx: buildMockId("settle"),
    status: "simulated"
  };
}
