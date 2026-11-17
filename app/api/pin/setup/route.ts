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

import { NextResponse } from "next/server";
import { ucwClient } from "@/lib/borrowKit";
import { limits } from "@/lib/limits";
import { errorResponse, requireUser, tooManyRequests } from "@/lib/routeAuth";
import { logRouteError } from "@/lib/routeLog";
import { createSession } from "@/lib/session";

async function mintToken(userId: string) {
  const { data } = await ucwClient.createUserToken({ userId });
  if (!data?.userToken || !data.encryptionKey) {
    throw new Error("We couldn't start your wallet setup. Please try again.");
  }
  return { userToken: data.userToken, encryptionKey: data.encryptionKey };
}

const WALLET = { accountType: "SCA" as const, blockchains: ["ARC-TESTNET" as const] };

/**
 * The challenge that sets up this user's PIN and wallet, or undefined when there is nothing
 * left to set up. A user who already has a PIN (155106) lands here when the app lost its
 * `wallet_accounts` row: they only need a wallet if they have none, and otherwise just a
 * session, so the browser can find the wallet and save the row again. Before, this answered
 * 155106 as an error and the wallet setup screen retried it forever.
 */
async function startSetup(userToken: string): Promise<string | undefined> {
  try {
    const { data } = await ucwClient.createUserPinWithWallets({ userToken, ...WALLET });
    return data?.challengeId;
  } catch (error) {
    if ((error as { code?: number })?.code !== 155106) throw error;
  }
  const { data: list } = await ucwClient.listWallets({ userToken });
  if (list?.wallets?.length) return undefined;
  const { data } = await ucwClient.createWallet({ userToken, ...WALLET });
  return data?.challengeId;
}

export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;

  const limited = limits.pin(userId);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    try {
      await ucwClient.createUser({ userId });
    } catch (error) {
      if ((error as { code?: number })?.code !== 155101) throw error;
    }

    const { userToken, encryptionKey } = await mintToken(userId);
    const challengeId = await startSetup(userToken);

    const sessionId = createSession(userId, userToken, encryptionKey);
    return NextResponse.json({ sessionId, userToken, encryptionKey, challengeId });
  } catch (error) {
    logRouteError("pin/setup", error);
    return errorResponse(error);
  }
}
