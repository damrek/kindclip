---
description: Audit and delete code comments, keeping only decision records
---
Load the `delete-comment` skill and run the full comment audit for the whole
repository. Report counts by class and lines removed, and tighten the ratchet
with `npm run comments:update` before running `npm run verify`.
