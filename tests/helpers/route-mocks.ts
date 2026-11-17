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

// Import this before any route module: it replaces Supabase, Circle and the Borrow Kit with
// mocks, and gives each test a clean session store and set of rate limiters.
import { beforeEach, vi } from "vitest";

import { sessions } from "@/lib/session";

export const supabaseUser = { auth: { getUser: vi.fn() } };
export const adminFrom = vi.fn();

export const ucwClient = {
  createUser: vi.fn(),
  createUserToken: vi.fn(),
  createUserPinWithWallets: vi.fn(),
  createWallet: vi.fn(),
  updateUserPin: vi.fn(),
  restoreUserPin: vi.fn(),
  listWallets: vi.fn(),
  getWalletTokenBalance: vi.fn(),
};

export const borrowKit = {
  borrow: vi.fn(),
  repay: vi.fn(),
  closeLoan: vi.fn(),
  addCollateral: vi.fn(),
  withdrawCollateralRepayIfNeeded: vi.fn(),
  getLoans: vi.fn(),
  getPosition: vi.fn(),
  getMarket: vi.fn(),
  exploreMarkets: vi.fn(),
  getBorrowQuote: vi.fn(),
  getRepayQuote: vi.fn(),
  getCloseLoanQuote: vi.fn(),
  getAddCollateralQuote: vi.fn(),
  getWithdrawCollateralRepayIfNeededQuote: vi.fn(),
  getRequiredCollateral: vi.fn(),
};

export const createAdapter = vi.fn();

export const DEFAULT_MARKET_ID = "0x" + "ab".repeat(32);

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => supabaseUser }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ from: adminFrom }) }));
vi.mock("@/lib/adapter", () => ({ createAdapter }));
vi.mock("@/lib/borrowKit", async () => {
  const { serializeError } = await vi.importActual<typeof import("@/lib/kitErrorTypes")>("@/lib/kitErrorTypes");
  return {
    ucwClient,
    borrowKit,
    borrowConfig: { apiKey: "TEST_API_KEY:id:secret" },
    serializeError,
    CHAIN: "Arc_Testnet",
    DEFAULT_MARKET_ID,
    Blockchain: { Arc_Testnet: "Arc_Testnet" },
    getChainByEnum: (chain: string) => chain,
  };
});

export const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Signs the next request in as this user, or as nobody. */
export function signIn(userId: string | null) {
  supabaseUser.auth.getUser.mockResolvedValue(
    userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: { message: "no session" } },
  );
}

export function post(body?: unknown, raw?: string) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

/** A session the way /api/pin/token leaves it: bound to a user, with the SSE stream attached. */
export async function liveSession(userId: string, userToken = `token-${userId}`) {
  const { createSession } = await import("@/lib/session");
  const id = createSession(userId, userToken, "enc-key");
  sessions.get(id)!.pushChallenge = () => {};
  return id;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sessions.clear();
  (globalThis as unknown as { routeLimiters?: unknown }).routeLimiters = undefined;
  createAdapter.mockResolvedValue({ getAddress: async () => "0x1111111111111111111111111111111111111111" });
});
