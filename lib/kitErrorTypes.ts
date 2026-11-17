/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { isKitError } from "@circle-fin/borrow-kit";

/**
 * Shared shape for a serialized BorrowKit `KitError`, split out from
 * lib/borrowKit.ts (server-only — instantiates BorrowKit with secrets at
 * module scope) so client components can import just this type without any
 * risk of the server module's runtime code ending up in a client bundle.
 */
export interface SerializedKitError {
  message: string;
  code?: number;
  name?: string;
  type?: string;
  recoverability?: string;
}

/**
 * Route-handler catch-block helper. `KitError` (thrown by every BorrowKit
 * call) carries a stable numeric `code` (1200s = input, fix & retry; 8200s =
 * service, safe to retry) plus `name`/`type`/`recoverability` — surface all
 * of it so the client doesn't have to regex-parse a message string.
 */
export function serializeError(error: unknown): SerializedKitError {
  if (isKitError(error)) {
    return {
      message: error.message,
      code: error.code,
      name: error.name,
      type: error.type,
      recoverability: error.recoverability,
    };
  }
  // The Circle wallets SDK throws errors carrying Circle's numeric code (e.g. 155106).
  const code = (error as { code?: unknown } | null)?.code;
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(typeof code === "number" ? { code } : {}),
  };
}

/** HTTP statuses for the `KitError` codes that need more than their type's default. */
const STATUS_BY_CODE: Record<number, number> = {
  1200: 404, // loan not found
  1202: 403, // loan belongs to another wallet
  1207: 404, // market not found
  1209: 404, // unknown market
  1210: 409, // idempotency key reused
  1213: 409, // signed bundle expired
  1214: 409, // loan already exists in this market
  1215: 409, // already executed
  1211: 422, // would be unhealthy
  1212: 422, // already unhealthy
  1216: 422, // withdrawal exceeds collateral
  1217: 422, // repay exceeds debt
  1219: 422, // too many loans
  1220: 422, // market snapshot not usable
  1222: 422, // existing loan not supported
  1223: 422, // loan has no debt
  1224: 422, // not enough collateral
  3002: 504, // timed out, e.g. a PIN challenge nobody approved
  8203: 503, // loan data still being repaired
  8204: 503, // upstream unavailable
};

const STATUS_BY_TYPE: Record<string, number> = {
  INPUT: 400,
  BALANCE: 422,
  ONCHAIN: 422,
  RATE_LIMIT: 429,
  NETWORK: 502,
  SERVICE: 502,
};

/**
 * The HTTP status a route should answer with for an error thrown by Borrow Kit or the Circle
 * wallets SDK, instead of a blanket 500. Circle rejecting our own credentials (401/403) is a
 * server problem, so it maps to 502 rather than telling the browser it is signed out.
 */
export function errorStatus(error: unknown): number {
  if (isKitError(error)) {
    return STATUS_BY_CODE[error.code] ?? STATUS_BY_TYPE[error.type] ?? 500;
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number" || status < 400 || status > 599) return 500;
  if (status === 401 || status === 403 || status >= 500) return 502;
  return status;
}
