# PAWS restart recovery

Windows PowerShell5.1 scripts for the existing approved University runtime identity. They restore reviewed processes after Saturday restarts, preserve authentication, SQL TLS and all write gates, and refuse to replace an unknown listener. They do not migrate data, publish Hosting, store Firebase credentials or change account permissions.

## What is automatic

The task starts two minutes after boot, at the configured account's logon, and every two minutes. Task Scheduler retries failures three times, one minute apart. A global mutex and IgnoreNew prevent overlapping runs. An absent API or tunnel can start; an occupied but unverified API stops recovery. SQL failure does not trigger a destructive restart. Logs contain fixed status codes and public endpoint information. Existing healthy processes are preserved.

The API launcher must already use the reviewed DPAPI-protected Firebase configuration. The accepted source manifest is pinned by SHA256; every source/package/lockfile and complete source inventory are verified before recovery. The launcher hash, release, shared trust anchor, loopback18787 and every write gate are also checked. Cloudflared and optional named-tunnel configuration are pinned by SHA256. Later releases require an explicit configuration refresh; recovery never silently upgrades source bytes or configuration. Installed dependency binaries remain governed by the previously verified locked release environment.

## Current limitation

No fixed domain/Named Tunnel is currently available. Quick Tunnel may obtain a new hostname after reboot. The script records `FRONTEND_ORIGIN_UPDATE_REQUIRED`, returns exit3 and does not claim the website is recovered. It never writes a new hostname into Hosting automatically. A stable named tunnel is required for unattended recovery of the complete login path. `TunnelMode=named` supports an existing protected cloudflared configuration file; credentials remain outside this JSON and repository.

## Configure and check

Copy these three scripts/module to a restricted local directory, for example `P:\PAWS\Runtime\Recovery`, beside `recovery-config.json`. JSON has these exact required fields:

```json
{
  "Identity": "UC\\sa-xinyu.zhu1",
  "ReleaseSha": "6b5e744530308c2153d89ddd488731a9f4708c30",
  "TrustAnchor": "331a636544e7232dbe98f67edbdf1cfbfa0e535d",
  "ApiPort": 18787,
  "ApiLauncherPath": "P:\\PAWS\\Runtime\\Acceptance\\LoginRecovery-20261017\\Start-Login-Live.ps1",
  "ApiLauncherSha256": "REPLACE_WITH_REVIEWED_LAUNCHER_HASH",
  "ApiServerRoot": "P:\\PAWS\\Runtime\\Versions\\6b5e744530308c2153d89ddd488731a9f4708c30\\server",
  "ApiManifestPath": "P:\\PAWS\\Runtime\\Acceptance\\LoginRecovery-20261017\\university-source-manifest.json",
  "ApiManifestSha256": "REPLACE_WITH_REVIEWED_MANIFEST_HASH",
  "CloudflaredPath": "C:\\PAWS\\Tools\\cloudflared-recovery.exe",
  "CloudflaredSha256": "4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6",
  "TunnelMode": "quick",
  "PublishedOrigin": "https://charge-concerning-hypothesis-represents.trycloudflare.com",
  "ExistingTunnelLogPath": "C:\\PAWS\\Runtime\\Logs\\cloudflared-recovery-20261017.stderr.log",
  "LogDirectory": "P:\\PAWS\\Runtime\\Recovery\\Logs",
  "ExpectedGates": {}
}
```

The example intentionally fails validation until the accepted launcher/manifest hashes and complete currently accepted boolean `writeGates` map are supplied. Never embed passwords, Firebase JSON or tunnel tokens. For named mode additionally set absolute `TunnelConfigPath` and its `TunnelConfigSha256`; the installer does not create a Cloudflare account or tunnel.

```powershell
& .\Invoke-PawsRecovery.ps1 -ConfigPath .\recovery-config.json -CheckOnly
& .\Install-PawsRecoveryTask.ps1 -ConfigPath .\recovery-config.json
```

CheckOnly does not start processes or write recovery logs. The second command only exports `Logs\paws-recovery-task.xml`; it does not register a task or request a password.

## Human installation step

For unattended startup, an authorized operator runs this on the server and enters the existing approved account credential in the local Windows prompt:

```powershell
& .\Install-PawsRecoveryTask.ps1 -ConfigPath .\recovery-config.json -Install
```

The password goes only to Windows Task Scheduler credential storage through the registration API, never command-line arguments, configuration, XML or logs. Installation refuses an existing task with the same name. Domain policy/logon-as-batch eligibility and actual reboot recovery must be verified on the server. No dedicated runtime identity is required by these scripts; the owner's current-account exception remains in force. Preparation/export is not proof of installed unattended recovery.

## Verification

`node --test tests/startup-recovery.test.js` runs actual PowerShell module checks for missing API/tunnel, occupied-unverified API, hostname changes, release/gate drift, credential-free configuration and task XML escaping/triggers/retry/least-privilege settings. Cross-platform module tests use host-native temporary paths. On Windows, run CheckOnly against the real accepted runtime and import/validate the exported XML without registering a live task. A real reboot is a separate human acceptance step.
