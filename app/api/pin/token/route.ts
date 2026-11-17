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

export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;

  const limited = limits.pin(userId);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const { data } = await ucwClient.createUserToken({ userId });
    if (!data?.userToken || !data.encryptionKey) {
      return NextResponse.json(
        { message: "createUserToken returned no credentials" },
        { status: 500 },
      );
    }
    const sessionId = createSession(userId, data.userToken, data.encryptionKey);
    return NextResponse.json({
      sessionId,
      userToken: data.userToken,
      encryptionKey: data.encryptionKey,
    });
  } catch (error) {
    logRouteError("pin/token", error);
    return errorResponse(error);
  }
}
