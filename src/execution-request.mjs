import { FUNCTION_ID, PROGRAM_ID } from "./constants.mjs";
import { encodePublicMessage, normalizeField } from "./semantics.mjs";

export function buildExecutionRequest(executionPackage) {
  if (executionPackage.programId !== PROGRAM_ID) {
    throw new Error(`unexpected program id: ${executionPackage.programId}`);
  }

  if (executionPackage.functionId !== FUNCTION_ID) {
    throw new Error(`unexpected function id: ${executionPackage.functionId}`);
  }

  const message = encodePublicMessage(executionPackage.message);

  return {
    programId: executionPackage.programId,
    functionId: executionPackage.functionId,
    inputs: [
      { type: "u64", visibility: "public", value: executionPackage.groupId },
      { type: "field", visibility: "public", value: executionPackage.merkleRoot },
      { type: "field", visibility: "public", value: executionPackage.nullifier },
      {
        type: "[field; 2]",
        visibility: "public",
        value: message.map((part) => part.toString())
      },
      { type: "field", visibility: "public", value: executionPackage.scopeHash }
    ],
    submissionMode: "relay"
  };
}

export function assertExecutionRequestMatchesPackage(request, executionPackage) {
  const expectedValues = [
    normalizeField(executionPackage.groupId).toString(),
    normalizeField(executionPackage.merkleRoot).toString(),
    normalizeField(executionPackage.nullifier).toString(),
    encodePublicMessage(executionPackage.message).map((value) => value.toString()),
    normalizeField(executionPackage.scopeHash).toString()
  ];

  const actualValues = request.inputs.map((input) =>
    Array.isArray(input.value)
      ? input.value.map((value) => normalizeField(value).toString())
      : normalizeField(input.value).toString()
  );

  if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
    throw new Error("execution request inputs do not match the package");
  }

  return true;
}
