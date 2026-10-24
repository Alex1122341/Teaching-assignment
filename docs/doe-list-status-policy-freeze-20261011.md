# DOE List balance and policy presentation freeze

Product anchor: 51edeff6dd285a5062bb874117d24f4925889300. Promotes the entire immutable static/API runtime through this separately reviewed governance change.

Within DOE is green, At DOE blue, Over DOE red. Remaining/overage values are retained; At DOE uses the existing two-decimal display precision. Incomplete/review worksheets retain an orange Needs Review state. A compact legend explains colors without relying on color alone.

DOE List API exposes its existing workload source reference, target policy label and calculation basis. The UI displays the recorded guide title, update date, and applicable academic year separately, keeping exact source and version IDs in an expandable provenance bubble. Unknown sources remain explicitly unknown. Target provenance is not represented as an annual calculation policy.

No changes to DOE calculations, source records, approval workflow, permissions, numerical rates, or SQL schema/data. No additional tests requested; syntax checks and existing automatic CI provide build evidence. Release requires exact-main CI, attested University API update with previous runtime rollback, then Hosting-only deployment and authenticated browser acceptance.
