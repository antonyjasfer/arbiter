import "server-only";
// The app's PayPal API: the typed wrappers over the sandbox-only transport.
import { paypalHttp } from "../paypal/client";
import { createPaypalApi, type PaypalApi } from "./paypal-api";

let api: PaypalApi | undefined;

export function getPaypalApi(): PaypalApi {
  api ??= createPaypalApi(paypalHttp);
  return api;
}
