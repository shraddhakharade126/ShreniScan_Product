/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

export default function App() {
  const router = useMemo(() => getRouter(), []);

  return <RouterProvider router={router} />;
}
