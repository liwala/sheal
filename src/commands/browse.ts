import { render } from "ink";
import React from "react";
import { App } from "../browse/App.js";
import type { View } from "../browse/types.js";

export interface BrowseOptions {
  project?: string;
  query?: string;
  agent?: string;
  /** Start directly on a specific view */
  startView?: View;
}

export async function runBrowse(options: BrowseOptions): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(App, {
      initialProject: options.project,
      initialQuery: options.query,
      initialAgent: options.agent,
      initialView: options.startView,
    }),
  );

  await waitUntilExit();
}
