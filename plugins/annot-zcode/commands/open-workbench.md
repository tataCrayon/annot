---
description: Open or reuse the local Annot workbench
---

Run `annot workbench open --json` in the current project.

If it succeeds, tell the user the returned local URL and whether the browser opened. If the browser did not open, present the URL as the next action.

Do not start a second foreground server. Use `annot workbench status --json` when the user asks whether it is running, and `annot workbench stop` only when they explicitly ask to stop it.
