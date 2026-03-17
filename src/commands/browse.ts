import { render } from "ink";
import React from "react";
import { App } from "../browse/App.js";

export interface BrowseOptions {
  project?: string;
  query?: string;
  agent?: string;
}

export async function runBrowse(options: BrowseOptions): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(App, {
      initialProject: options.project,
      initialQuery: options.query,
      initialAgent: options.agent,
    }),
  );

  await waitUntilExit();
}
