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

import { requireUser } from "@/lib/routeAuth";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

function sseFrame(event: string, data: string) {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export async function GET(req: Request) {
  // The session id travels in the URL, so it ends up in access logs: on its own it must not
  // be enough. The stream is only handed to the user the session belongs to.
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const session = getSession(sessionId, auth.user.id);
  if (!session || !sessionId) {
    return Response.json({ message: "Your session expired. Sign in again." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const pushChallenge = (challengeId: string) => {
        controller.enqueue(
          encoder.encode(sseFrame("challenge", JSON.stringify({ challengeId }))),
        );
      };
      session.pushChallenge = pushChallenge;

      controller.enqueue(encoder.encode(sseFrame("ready", sessionId)));

      req.signal.addEventListener("abort", () => {
        // A reconnect may already have attached a newer stream; only detach our own pusher.
        if (session.pushChallenge === pushChallenge) {
          session.pushChallenge = undefined;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
