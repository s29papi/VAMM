import { FUNCTION_ID, MERKLE_DEPTH, PROGRAM_ID } from "./constants.mjs";

export function buildDeploymentConfig() {
  return {
    network: "testnet",
    devnetEndpoint: "http://127.0.0.1:3030",
    supportedDepths: {
      [MERKLE_DEPTH]: {
        programId: PROGRAM_ID,
        functionId: FUNCTION_ID
      }
    }
  };
}

export function resolveDepthRoute(merkleDepth, config = buildDeploymentConfig()) {
  const route = config.supportedDepths[String(merkleDepth)] ?? config.supportedDepths[merkleDepth];
  if (!route) {
    throw new RangeError(`unsupported Merkle depth: ${merkleDepth}`);
  }

  return route;
}
