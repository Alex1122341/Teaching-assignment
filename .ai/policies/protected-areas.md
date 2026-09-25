# Protected areas and role evidence

Never put credentials, Firebase/GitHub secrets, deployment tokens, account
passwords, live Firestore data, or production exports in task artifacts.
No script reads local auth files or environment variables into a prompt.

Changing firestore.rules, authentication, workflows/deployment, trusted server
code or authoritative DOE logic requires explicit expected_files and
protected_changes entries. Security-rule specifications must require emulator.
Runtime guards cover common paths; the human must classify other sensitive files.

Role authority lives in faculty-access.js, office-capabilities.js, account-profile.js,
firestore.rules and their security tests. Developer, ADC, LAB, ADFA, Faculty and
other roles are labels to investigate, not a newly defined permission matrix.
Each spec.role_checks entry records role, source, scenario and expected behavior.
Include allowed and denied cases, state transitions, calendar/workflow consistency,
audit visibility, stale requests and duplicate-event handling when relevant.
Use synthetic emulator data. Existing browser owner smoke is not full role coverage.

main is protected procedurally; V1 does not change repository branch protections.
No framework command publishes Pages, Firebase rules, data, DOE policies or Azure.
