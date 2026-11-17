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
import { borrowKit, CHAIN } from "@/lib/borrowKit";
import { limits } from "@/lib/limits";
import { badRequest, errorResponse, readJsonBody, requireUser, tooManyRequests } from "@/lib/routeAuth";
import { logRouteError } from "@/lib/routeLog";
import { parseAmount, parseLoanId, parseSlippageBps } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const read = await readJsonBody(req);
  if ("response" in read) return read.response;

  const loanId = parseLoanId(read.body.loanId);
  if (!loanId.ok) return badRequest(loanId.message);
  const amount = parseAmount(read.body.amount, "0.000001");
  if (!amount.ok) return badRequest(amount.message);
  const slippageBps = parseSlippageBps(read.body.slippageBps);
  if (!slippageBps.ok) return badRequest(slippageBps.message);

  const limited = limits.quote(auth.user.id);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const quote = await borrowKit.getWithdrawCollateralRepayIfNeededQuote({
      loanId: loanId.value,
      chain: CHAIN,
      collateralAmount: amount.value,
      slippageBps: slippageBps.value,
    });
    return NextResponse.json(quote);
  } catch (error) {
    logRouteError("withdraw-collateral-quote", error);
    return errorResponse(error);
  }
}
