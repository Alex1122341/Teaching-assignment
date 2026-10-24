# AFC and LAB immutable freeze promotion

Product anchor: `fb2c625745957fa7d9990033f15a7b1ef91974a5`.
Previous anchor: `277c3cdfb1b9aa4cb9002f686a76a29a73a7f57b`.

This separate governance commit promotes the shared static/API baseline to the reviewed product. It changes no product runtime bytes and introduces no exceptions. Canonical reporting hashes are derived from the immutable product's Git blobs. The union-based manifest protection and adversarial tests remain intact; historical accepted anchors remain pinned.

Static protection expands from69 to71 files with `faculty-admin-afc-records.js` and `lab-session-detail.js`. Six existing static files change: faculty-admin.html, faculty-admin.js, index.html, paws-data-client.js, timetable.css and timetable.js. API coverage remains67 runtime files plus1 build definition and2 repository inputs. Five API files change: Dashboard API, SQL AFC write repository, SQL Dashboard repository, independent write gates and Dashboard HTTP adapter.

A governance regression checks the exact static/API protected delta from the previous anchor, no dropped static assets, no changed API path coverage and anchor ancestry. Repository and generated static/API artifacts must report zero drift. Product SQL migration036 remains a directed release prerequisite, separate from artifact build/freeze verification. This commit does not authorize or execute merge, migration, permission binding, gate activation or deployment.
