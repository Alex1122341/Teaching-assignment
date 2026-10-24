# Maintenance restart recovery — 2026-10-23

Owner requested restoration of the live Beta site after School maintenance restart. Existing source mainad605dbb9ab92457df972703c723e2b991fa284c, separate repair branch fix/maintenance-origin-recovery-20261023. No PR125 development code is included.

## Observed cause and recovery

SQL MSSQLSERVER was running/listening1433, but API18787 and cloudflared were absent. Firebase Hosting still served200 with the old temporary origin. The installed PAWSApi-Temporary-SA task is Interactive; it does not establish unattended boot recovery. Existing reviewed Recovery PowerShell/module canonical hashes matched repository source, and configured launcher/cloudflared hashes matched their pins.

Owner's explicit request authorized invoking the existing P:\PAWS\Runtime\Recovery\Invoke-PawsRecovery.ps1 with its existing config. It restored the same accepted Production API release924cc6761a3b2dfba4f19c2df912436cbd965b43 and independent existing Production tunnel. No SQL data/schema/grant/gate mutation or API upgrade occurred. The resulting Quick Tunnel hostname is https://cultures-please-skirt-tba.trycloudflare.com. Public runtime/SQL returned200; anonymous me401; all27 configured gate values matched. Recovery CheckOnly reports FRONTEND_ORIGIN_UPDATE_REQUIRED until the frontend/config origin agrees.

## Repair scope and release discipline

The only shipped application change is the public apiOrigin in paws-api-origin.js. No Firebase project, authentication/roles/privacy, API runtime, business code, routes or SQL configuration changes. Preserve all original protected manifests, PDF/binary files and dated freeze receipts. Promote the unchanged manifests to this single-origin product only in a separate reviewed governance commit; API bytes remain identical to existing main and its accepted release.

Owner has directed no desktop installations/local test suites and immediate accepted publication; GitHub quota constraints remain. This emergency repair therefore uses independent source/governance review, immutable repository/build-artifact verification, exact-main source binding, online served-file comparison and real runtime/SQL/CORS/anonymous/browser acceptance. No npm/node:test/emulator/LocalDB run or new green GitHub CI result is claimed. Preserve actual observations and remaining limits; do not manufacture an official artifact ID.

Publish only Hosting using the existing main allowlist build and explicit tester-teaching target, after the reviewed repair is merged and exact-main artifact validation is complete. Record the existing Hosting release/version for rollback. After publication, verify every served allowlisted file, restore the Recovery PublishedOrigin to the same actual validated hostname with a private backup, and run CheckOnly. Never automatically update source/Hosting from a newly parsed log. Quick Tunnel can change again; a stable Named Tunnel is still unavailable, so unattended complete website recovery is not claimed.

PR125 School Testing preparation remains separate and incomplete. Existing Testing folders/draft must survive this restoration; do not start Testing or create its database to repair Production.
