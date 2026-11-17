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
import { borrowKit, CHAIN, DEFAULT_MARKET_ID } from "@/lib/borrowKit";
import { limits } from "@/lib/limits";
import { badRequest, errorResponse, readJsonBody, requireUser, tooManyRequests } from "@/lib/routeAuth";
import { logRouteError } from "@/lib/routeLog";
import { parseMarketId } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const read = await readJsonBody(req);
  if ("response" in read) return read.response;

  const marketId = parseMarketId(read.body.marketId, DEFAULT_MARKET_ID);
  if (!marketId.ok) return badRequest(marketId.message);

  const limited = limits.quote(auth.user.id);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const market = await borrowKit.getMarket({ chain: CHAIN, marketId: marketId.value });
    return NextResponse.json(market);
  } catch (error) {
    logRouteError("market", error);
    return errorResponse(error);
  }
}
