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
import { borrowKit } from "@/lib/borrowKit";
import { limits } from "@/lib/limits";
import { badRequest, errorResponse, readJsonBody, requireUser, tooManyRequests } from "@/lib/routeAuth";
import { logRouteError } from "@/lib/routeLog";
import { parseLoanId } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const read = await readJsonBody(req);
  if ("response" in read) return read.response;

  const loanId = parseLoanId(read.body.loanId);
  if (!loanId.ok) return badRequest(loanId.message);

  const limited = limits.quote(auth.user.id);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const loan = await borrowKit.getPosition({ loanId: loanId.value });
    return NextResponse.json(loan);
  } catch (error) {
    logRouteError("loan", error);
    return errorResponse(error);
  }
}
