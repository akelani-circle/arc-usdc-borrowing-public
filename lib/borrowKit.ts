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

import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { Blockchain, BorrowKit, BorrowServiceProvider, getChainByEnum } from "@circle-fin/borrow-kit";

export { serializeError } from "@/lib/kitErrorTypes";

export const CHAIN = "Arc_Testnet" as const;

/** Default Arc Testnet market from the Borrow Kit bug-bash guide (cirBTC/USDC). */
export const DEFAULT_MARKET_ID =
  "0xf8a71f6df9dc7725d1c2fd848e4635d1e9ddca11da4e2dc2f9801005bd2b5d58";

const globalForKit = globalThis as unknown as {
  ucwClient?: ReturnType<typeof initiateUserControlledWalletsClient>;
  borrowKit?: BorrowKit;
};

export const ucwClient =
  globalForKit.ucwClient ??
  initiateUserControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY! });
globalForKit.ucwClient = ucwClient;

// Borrow Kit 1.0.0 takes the Circle API key only on `borrow` and `getBorrowQuote`, where it
// picks the integrator fee. Every other Borrow Service call (loans, market, quotes, repay,
// close, collateral) refuses a configured key with a validation error. So the provider is
// keyless and those two calls pass `borrowConfig`. Use the prod endpoint: staging returned 404.
const providerConfig: { baseUrl?: string } = {};
if (process.env.BORROW_BASE_URL) providerConfig.baseUrl = process.env.BORROW_BASE_URL;

/** Per-call config for `borrow` and `getBorrowQuote`, the only calls that accept the API key. */
export const borrowConfig = process.env.CIRCLE_API_KEY ? { apiKey: process.env.CIRCLE_API_KEY } : undefined;

export const borrowKit =
  globalForKit.borrowKit ??
  new BorrowKit({
    providers: [new BorrowServiceProvider(providerConfig)],
  });
globalForKit.borrowKit = borrowKit;

export { Blockchain, getChainByEnum };
