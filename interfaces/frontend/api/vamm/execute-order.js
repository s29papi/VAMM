import { proxyVammRequest } from "../_lib/vammProxy.js";

export default async function handler(req, res) {
  return proxyVammRequest(req, res, "/api/vamm/execute-order");
}
