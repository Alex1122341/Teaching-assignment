# Browser application source

| Folder | Responsibility |
| --- | --- |
| pages/ | Timetable, Faculty Dashboard, Teaching Assignments, account and password pages |
| scripts/ | Browser modules grouped by descriptive feature prefixes |
| styles/ | Page and feature styles |
| assets/ | Public form templates (never uploaded faculty documents) |

The source tree is not a directly served website. Run `npm run build` and serve `.deploy-static/`. The build uses `tools/static-assets.json` as the exact public allowlist. Source paths are resolved by `tools/build/frontend-paths.js`; published names, script order, same-directory module imports and bookmarks remain unchanged.

Edit the single source here, not generated artifacts. All public assets remain protected against immutable Git blobs. Do not add database credentials, staff uploads, admin-only source data or development files to the public manifest.
