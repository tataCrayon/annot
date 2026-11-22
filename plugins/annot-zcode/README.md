# Annot for ZCode

This package adapts the same `annot` CLI and AI-first workflows to ZCode's plugin format.

It ships three Skills:

- `annot`: route analysis, evaluation, review, and bounded rewrite work.
- `annot-analysis`: create a source-anchored semantic flow proposal.
- `annot-evaluation`: design and run evidence-backed paired evaluation.

It also ships the `open-workbench` convenience command, which runs `annot workbench open`, reuses an existing local server, and opens the workspace in the default browser.

The plugin contains no second parser. It requires Node.js 22.18 or newer and an `annot` command on `PATH`. From this checkout, run `npm link` and confirm with `annot version`.

The local development marketplace is declared beside this package in `plugins/marketplace.json`. Register the `plugins` directory in ZCode, refresh the marketplace after source changes, then update the installed plugin and test it in a new task.
