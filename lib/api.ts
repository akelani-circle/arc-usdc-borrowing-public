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

import type { SerializedKitError } from "@/lib/kitErrorTypes";

export class ApiError extends Error {
  code?: number;
  errorName?: string;
  errorType?: string;
  recoverability?: string;
  status: number;

  constructor(payload: SerializedKitError, status: number) {
    super(payload.message);
    this.code = payload.code;
    this.errorName = payload.name;
    this.errorType = payload.type;
    this.recoverability = payload.recoverability;
    this.status = status;
  }
}

export async function postJson<T = unknown>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON from ${path} (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) {
    const payload = data as Partial<SerializedKitError> | null;
    const message = payload?.message || text || `Request failed (${res.status})`;
    throw new ApiError({ ...payload, message }, res.status);
  }
  return data as T;
}
