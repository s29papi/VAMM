import {
  ensureDistinctFromAleoAccountKey,
  identityCommitment,
  normalizeField,
  randomField
} from "./semantics.mjs";

export class AleoVeilIdentity {
  constructor(identitySecret = randomField()) {
    ensureDistinctFromAleoAccountKey(identitySecret);
    this._identitySecret = normalizeField(identitySecret);
  }

  static import(serializedIdentitySecret) {
    return new AleoVeilIdentity(serializedIdentitySecret);
  }

  get identitySecret() {
    return this._identitySecret;
  }

  get secretField() {
    return this._identitySecret;
  }

  get commitment() {
    return identityCommitment(this._identitySecret);
  }

  export() {
    return this._identitySecret.toString();
  }

  serialize() {
    return {
      identitySecret: this.identitySecret.toString(),
      commitment: this.commitment.toString()
    };
  }
}

export function createIdentity(identitySecret) {
  return new AleoVeilIdentity(identitySecret);
}
