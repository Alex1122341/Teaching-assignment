# Governance and manual acceptance handoff

Requested scope: bring the PAWS Constitution, role/capability guidance and Graphify into UCVM-Teaching-Assignment/Teaching-assignment; make first-visit agent guidance explain this repository; add an all-English, Beta-based manual acceptance list for the Testing site.

Implementation is documentation and generated source-map/checklist material only. It changes no browser/API/Firestore/SQL business implementation or build workflow. The root agent entry now points to a short onboarding sequence rather than the stale upstream/Lab-default description. Constitution is the product target; the role matrix and test catalog explicitly preserve current implementation gaps.

The checked-in Graphify snapshot is source-only, portable and excluded from extraction and deployment. Raw graph is separate from the clustered visualization. After a merge, regenerate on exact merged main and record new evidence before tracing/signoff. The snapshot's source-input fingerprint remains comparable across documentation-only commits.

The English catalog contains141 cases across27 groups, including Developer support-session expiry, actor/target audit and guarded Undo added after independent review. Markdown, JSON and Excel share the same IDs and content. Excel supplies filterable feature/role/lane/status columns and blank actual-result, evidence, tester and date fields. Every case starts Not run. Demo, real Firebase Lab and isolated backend lanes are separate. Current PR148 multi-role administration, real delivery/transactions and legacy Calendar-home differences remain visible, never silently passed.

Source baseline:069914cdfa1c2fb0f844b0abdd278f5275bde8f4. Beta reference reviewed from merged46aeefd5a2195e9eff540e005f3a1e0692e05fef. Neither reference means these manual cases have been executed. Runtime changes for identified gaps require a separate scoped implementation and acceptance.
