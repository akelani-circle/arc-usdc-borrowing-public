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
import { borrowConfig, borrowKit, CHAIN, DEFAULT_MARKET_ID, Blockchain, getChainByEnum } from "@/lib/borrowKit";
import { createAdapter } from "@/lib/adapter";
import { limits } from "@/lib/limits";
import { badRequest, errorResponse, readJsonBody, requireUser, tooManyRequests } from "@/lib/routeAuth";
import { logRouteError } from "@/lib/routeLog";
import { requireLiveSession } from "@/lib/session";
import { parseAmount, parseLoanId, parseMarketId, parseSlippageBps } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const read = await readJsonBody(req);
  if ("response" in read) return read.response;

  const amount = parseAmount(read.body.amount, "1");
  const marketId = parseMarketId(read.body.marketId, DEFAULT_MARKET_ID);
  const loanId = read.body.loanId ? parseLoanId(read.body.loanId) : undefined;
  const slippageBps = parseSlippageBps(read.body.slippageBps);
  if (!amount.ok) return badRequest(amount.message);
  if (!marketId.ok) return badRequest(marketId.message);
  if (loanId && !loanId.ok) return badRequest(loanId.message);
  if (!slippageBps.ok) return badRequest(slippageBps.message);

  const limited = limits.quote(auth.user.id);
  if (!limited.ok) return tooManyRequests(limited);

  const live = requireLiveSession(read.body.sessionId, auth.user.id);
  if ("error" in live) return NextResponse.json({ message: live.error }, { status: live.status });

  try {
    const adapter = await createAdapter(live.session);
    const walletAddress = await adapter.getAddress(getChainByEnum(Blockchain.Arc_Testnet));
    // SDK: loanId = borrow more; marketId = open a new loan (mutually exclusive).
    const quote = loanId?.ok
      ? await borrowKit.getBorrowQuote({
          loanId: loanId.value,
          borrowAmount: amount.value,
          slippageBps: slippageBps.value,
          config: borrowConfig,
        })
      : await borrowKit.getBorrowQuote({
          walletAddress,
          chain: CHAIN,
          marketId: marketId.value,
          borrowAmount: amount.value,
          slippageBps: slippageBps.value,
          config: borrowConfig,
        });
    return NextResponse.json({ walletAddress, quote });
  } catch (error) {
    logRouteError("borrow-quote", error);
    return errorResponse(error);
  }
}
