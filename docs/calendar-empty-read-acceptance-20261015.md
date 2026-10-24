# Calendar empty range acceptance correction

During owner-directed actual Beta acceptance before Hosting publication, accepted API9eb03c2 and SQL038–043 returned a503 for an authorized empty Calendar range. Trusted SQL reproduction returned `{"activities":null,"nextCursor":null,"facultyKeys":null}`. Capabilities and scheduling Tasks read succeeded; the real Tasks total was907. No actual working activities have been imported. Existing public static remains ca465bf while acceptance is open.

## RED and bounded fix

First public stored-procedure regression committed d38297b. Actual disposable SQL run38844624068/job116792218430 failed at `An authorized empty Calendar range must return an activities array.` This reproduces the real SQL contract failure, not a mock or deliberately broken assertion.

New044 alters only ListCalendarActivities: the existing activities JSON subquery is coalesced to literal[] inside JSON_QUERY, preserving JSON array typing. Original038 remains unchanged. Authorization, roles, faculty scope, joins, public fields, category/date/cursor/limit behavior and grants are copied unchanged. No business DML, data imports, accounts, role membership or gate expansion.

The shared disposable runner applies044 after every supported foundation depth before acceptance or guarded rollback. Tests cover empty database, empty date/category filters, populated array typing, null-sensitive original dates/time status and existing privacy. The earlier full foundation rollback drops the same altered procedure, with no new object to clean.

## Operational boundary

Main9eb03c26913cd2a0b85a7a1e4a3a7a406a944933 CI38841275903, SQL38841319455 and migration38841275971 passed. Exact downloaded artifact12021223639 ZIP SHA256eee9bf00ee77c4594055ee74deafe9f855ae47a3c3b48bc58495bef4f1fc9ed7;153-file inventory and static/API freezes verified, same raw-file inventory digest as accepted e76878c. University runtime74source/package files attested and397locked dependencies installed. SQL038–043 first compiled/rolled back, then applied in one outer transaction. Sessions1937/assignments4970/AFC803/manual2/audits23 unchanged; Calendar0/reviews0. All new roles empty, metadata trigger enabled. Previous definitions and prior launcher preserved. Existing gate values unchanged; four new Calendar/Tasks write gates false. No source import, AFC deletion, real teaching/review write or Hosting publication.

Before applying044: require independent review, green candidate/full SQL CI, merge and exact-main CI. Back up current ListCalendarActivities definition/SET metadata, compare with reviewed038, compile044 inside an outer rollback transaction, observe actual authorized empty[] result, rollback and verify original definition. Apply once only after that proof, verify original counts and actual authenticated API. SQL-only correction requires no new frozen runtime anchor. Preserve coherent prior API/static rollback; retain all data/audits/version metadata.

GREEN/review/final publication evidence will be appended after it exists.
