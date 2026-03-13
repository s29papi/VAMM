import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROGRAM_PATH = "/home/usih/go/src/github.com/searchbox-labs/aleoveil";

function runLeo(...args) {
  return execFileSync("leo", args, {
    cwd: PROGRAM_PATH,
    encoding: "utf8",
    env: {
      ...process.env,
      NETWORK: "testnet"
    }
  });
}

test("point 6 Leo runtime keeps one fixed depth route and one proof-validation signature", () => {
  const supportedDepth = runLeo(
    "run",
    "--offline",
    "--path",
    PROGRAM_PATH,
    "is_supported_depth",
    "20u8"
  );
  assert.match(supportedDepth, /true/);

  const unsupportedDepth = runLeo(
    "run",
    "--offline",
    "--path",
    PROGRAM_PATH,
    "is_supported_depth",
    "19u8"
  );
  assert.match(unsupportedDepth, /false/);

  runLeo("build", "--path", PROGRAM_PATH);
  const abi = JSON.parse(readFileSync(`${PROGRAM_PATH}/build/abi.json`, "utf8"));
  const validate = abi.transitions.find((transition) => transition.name === "validate_proof_depth_20");

  assert.ok(validate);
  assert.equal(validate.inputs[0].name, "group_id");
  assert.equal(validate.inputs[1].name, "merkle_root");
  assert.equal(validate.inputs[2].name, "nullifier");
  assert.equal(validate.inputs[3].name, "message");
  assert.equal(validate.inputs[4].name, "scope_hash");
  assert.equal(validate.inputs.some((input) => input.name === "merkle_depth"), false);
});
