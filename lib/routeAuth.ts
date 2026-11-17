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
import type { User } from "@supabase/supabase-js";

import { errorStatus, serializeError } from "@/lib/kitErrorTypes";
import type { RateLimitResult } from "@/lib/rateLimit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/** The Supabase user behind the request's auth cookie, or a ready-made 401. */
export async function requireUser(): Promise<{ user: User } | { response: NextResponse }> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { response: NextResponse.json({ message: "Not authenticated" }, { status: 401 }) };
  }
  return { user };
}

const MAX_BODY_BYTES = 16 * 1024;

/** A JSON object body, or a ready-made 400. Bodies over 16 KiB are refused. */
export async function readJsonBody(req: Request): Promise<{ body: Record<string, unknown> } | { response: NextResponse }> {
  const bad = (message: string, status = 400) => ({ response: NextResponse.json({ message }, { status }) });

  let text: string;
  try {
    text = await req.text();
  } catch {
    return bad("Could not read the request.");
  }
  if (text.length > MAX_BODY_BYTES) return bad("Request too large.", 413);
  if (text === "") return { body: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return bad("Request body must be JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return bad("Request body must be a JSON object.");
  }
  return { body: parsed as Record<string, unknown> };
}

export function tooManyRequests(result: Extract<RateLimitResult, { ok: false }>) {
  return NextResponse.json(
    { message: "Too many requests. Wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

export function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

/** A failed Borrow Kit or Circle call, with a status that says what went wrong instead of 500. */
export function errorResponse(error: unknown) {
  return NextResponse.json(serializeError(error), { status: errorStatus(error) });
}
