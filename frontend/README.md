# Browser application source

This is the PAWS page set used by the default Testing Frontend Demo. See the current [environment map](../docs/architecture/testing-environments.md). Its allowlist is `tools/static-assets.paws.json`; `tools/build-paws-pages.js` adds the browser-local API. The separate legacy web/ build remains tested.

| Folder | Responsibility |
| --- | --- |
| pages/ | Timetable, Faculty Dashboard, Teaching Assignments, account and password pages |
| scripts/ | Browser modules grouped by descriptive feature prefixes |
| styles/ | Page and feature styles |
| assets/ | Public form templates (never uploaded faculty documents) |

The source tree is not a directly served website. Run the PAWS Demo build/stage commands in the root [README](../README.md), then serve `.deploy-static/`. Source paths are resolved by `tools/build/frontend-paths.js`; published names, script order, same-directory module imports and bookmarks remain unchanged.

Edit the single source here, not generated artifacts. All public assets remain protected against immutable Git blobs. Do not add database credentials, staff uploads, admin-only source data or development files to the public manifest.
