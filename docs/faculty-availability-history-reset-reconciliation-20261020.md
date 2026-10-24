# Preserve the latest History presentation baseline

Main advanced again to `1b4c3fb` through separately accepted PR128 while Availability governance was being verified. Its fixed History presentation baseline changes only History display/read projection; source AuditEvent records are not deleted. Preserve that accepted main code exactly when integrating PR124. The new main anchor573dbe4 and prior History fe1fa700 remain distinct immutable historical records.

The first integrated Availability product7fb4229/governance93993f5 remain historical evidence. Its source-specific12 Availability static/API/SQL files remain identical to accepted23e35c8. A fresh integrated product and separate shared-baseline promotion are required after this merge. The counts remain83 static and107 API runtime files plus3 protected inputs. Conflicts are limited to three current-baseline files; no Availability implementation is overwritten and no History runtime file is manually rewritten.

Previous interrupted local root runs and conflicted CI heads are not passing acceptance. LiveSQL056, credentials, permissions,27 write gates and runtime remain unchanged by this Git reconciliation. Refresh exactmain again before merge/release and never deploy an older History implementation over a newer accepted one.
