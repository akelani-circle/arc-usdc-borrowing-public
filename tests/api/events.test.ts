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

// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ALICE, liveSession, signIn } from "../helpers/route-mocks";
import { sessions } from "@/lib/session";
import { GET } from "@/app/api/events/route";

function open(sessionId: string) {
  const controller = new AbortController();
  const request = new Request(`http://localhost/api/events?sessionId=${sessionId}`, { signal: controller.signal });
  return { controller, response: GET(request) };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, text: string) {
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
  }
  return seen;
}

describe("/api/events", () => {
  it("closing a stream detaches its challenge pusher", async () => {
    signIn(ALICE);
    const id = await liveSession(ALICE);

    const stream = open(id);
    await stream.response;
    stream.controller.abort();

    expect(sessions.get(id)!.pushChallenge).toBeUndefined();
  });

  it("closing an older stream leaves the newer stream's pusher in place", async () => {
    signIn(ALICE);
    const id = await liveSession(ALICE);

    const first = open(id);
    await first.response;
    const second = open(id);
    const reader = (await second.response).body!.getReader();
    await readUntil(reader, "event: ready");

    // The first connection's disconnect is noticed only after the browser reconnected.
    first.controller.abort();

    expect(sessions.get(id)!.pushChallenge).toBeDefined();
    sessions.get(id)!.pushChallenge!("challenge-1");
    expect(await readUntil(reader, "challenge-1")).toContain('"challengeId":"challenge-1"');
    await reader.cancel();
  });
});
