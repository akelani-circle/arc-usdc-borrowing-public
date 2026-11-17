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
import { badRequest, errorResponse, readJsonBody, requireUser, tooManyRequests } from "@/lib/routeAuth";
import { logRouteError } from "@/lib/routeLog";
import { findSessionByToken } from "@/lib/session";
import { isWalletId } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const read = await readJsonBody(req);
  if ("response" in read) return read.response;

  if (!isWalletId(read.body.walletId)) return badRequest("walletId is not valid.");

  const session = findSessionByToken(auth.user.id, read.body.userToken);
  if (!session) {
    return NextResponse.json({ message: "Your session expired. Sign in again." }, { status: 404 });
  }

  const limited = limits.wallet(auth.user.id);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const { data } = await ucwClient.getWalletTokenBalance({
      userToken: session.userToken,
      walletId: read.body.walletId,
    });
    return NextResponse.json(data);
  } catch (error) {
    logRouteError("wallets/balances", error);
    return errorResponse(error);
  }
}
