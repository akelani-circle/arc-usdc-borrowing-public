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

// Runs the Next.js CLI (`node scripts/next.mjs dev|start`) with PORT taken from .env.local.
// `next dev`/`next start` read PORT from the shell only: they pick the port before loading
// .env.local, so a PORT set there was ignored. A PORT set in the shell still wins.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

if (!process.env.PORT && existsSync(".env.local")) {
  const { PORT } = parseEnv(readFileSync(".env.local", "utf8"));
  if (PORT) process.env.PORT = PORT;
}
// An empty `PORT=` makes Next exit with "'' is not a non-negative number"; unset means 3000.
if (!process.env.PORT) delete process.env.PORT;

createRequire(import.meta.url)("next/dist/bin/next");
