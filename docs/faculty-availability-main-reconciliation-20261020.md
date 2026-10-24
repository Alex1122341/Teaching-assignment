# Availability integration with current main

During final acceptance, main advanced from6addfb9 to15dd7390d613bd3bd2163f411b81bc4ffdf22fd1 through separately merged PR126 (Dashboard History operation grouping) and PR127 (release guards preserve authorized live gates). PR124 became unmergeable; GitHub did not schedule a pull-request build for the conflicted governance head1ad80d9.

Reconcile by merging current main into the existing feature branch. Preserve all latest History runtime and Hosting guard changes exactly from15dd739. All five Availability static files, five Availability API paths and both056 SQL files remain byte-identical to independently accepted product23e35c8. No business changes, SQL application or release is performed by this integration.

The merge retains main's historical fe1fa700 History anchor while the combined candidate is unpromoted. Historical Availability acceptance remains pinned to23e35c8 through immutable governance1ad80d9. A separate combined freeze promotion must follow independent integrated-product closure, protect83 static assets and107 API runtime files plus3 inputs, and preserve both historical product records. Never retain the old23e35c8 anchor against changed History runtime, drop the History dependency, or use a drift exception.

The prior interrupted local root run is not a successful acceptance receipt. Rerun full acceptance on the reconciled and independently reviewed baseline, then re-fetch current main before any merge. The existing University API remains6bc6a640/b5d33762;27 gates remain unchanged and live056 is not installed at this checkpoint.
