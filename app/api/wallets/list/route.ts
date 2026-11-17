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
import { errorResponse, readJsonBody, requireUser, tooManyRequests } from "@/lib/routeAuth";
import { logRouteError } from "@/lib/routeLog";
import { findSessionByToken } from "@/lib/session";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const read = await readJsonBody(req);
  if ("response" in read) return read.response;

  // Was open to anyone, forwarding whatever token it was given on the app's API key. The
  // token must now be one this user's own session was issued.
  const session = findSessionByToken(auth.user.id, read.body.userToken);
  if (!session) {
    return NextResponse.json({ message: "Your session expired. Sign in again." }, { status: 404 });
  }

  const limited = limits.wallet(auth.user.id);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const { data } = await ucwClient.listWallets({ userToken: session.userToken });
    return NextResponse.json(data);
  } catch (error) {
    logRouteError("wallets/list", error);
    return errorResponse(error);
  }
}
