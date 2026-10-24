/*
  PAWS Beta stabilization data-quality audit.
  READ ONLY: aggregate counts only; no row-level contact/HR/signature values.
  Execute against VetMed-Ops before preparing any normalization script.
*/
SET NOCOUNT ON;

SELECT Scope, Metric, IssueCount
FROM (
  SELECT 'Faculty' AS Scope, 'rows' AS Metric, COUNT_BIG(*) AS IssueCount FROM paws.Faculty
  UNION ALL SELECT 'Faculty', 'active_rows', COUNT_BIG(*) FROM paws.Faculty WHERE Active = 1
  UNION ALL SELECT 'Faculty', 'fte_null', COUNT_BIG(*) FROM paws.Faculty WHERE Fte IS NULL
  UNION ALL SELECT 'Faculty', 'blank_required_display_name_or_record_type', COUNT_BIG(*) FROM paws.Faculty WHERE NULLIF(LTRIM(RTRIM(DisplayName)), '') IS NULL OR NULLIF(LTRIM(RTRIM(RecordType)), '') IS NULL
  UNION ALL SELECT 'Faculty', 'whitespace_in_display_name_or_email', COUNT_BIG(*) FROM paws.Faculty WHERE DisplayName <> LTRIM(RTRIM(DisplayName)) OR Email <> LTRIM(RTRIM(Email))
  UNION ALL SELECT 'Faculty', 'duplicate_normalized_display_name_groups', COUNT_BIG(*) FROM (SELECT LOWER(LTRIM(RTRIM(DisplayName))) AS K FROM paws.Faculty WHERE NULLIF(LTRIM(RTRIM(DisplayName)), '') IS NOT NULL GROUP BY LOWER(LTRIM(RTRIM(DisplayName))) HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'Faculty', 'duplicate_normalized_email_groups', COUNT_BIG(*) FROM (SELECT LOWER(LTRIM(RTRIM(Email))) AS K FROM paws.Faculty WHERE NULLIF(LTRIM(RTRIM(Email)), '') IS NOT NULL GROUP BY LOWER(LTRIM(RTRIM(Email))) HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'Faculty', 'blank_rank', COUNT_BIG(*) FROM paws.Faculty WHERE NULLIF(LTRIM(RTRIM(Rank)), '') IS NULL
  UNION ALL SELECT 'Faculty', 'blank_stream', COUNT_BIG(*) FROM paws.Faculty WHERE NULLIF(LTRIM(RTRIM(Stream)), '') IS NULL
  UNION ALL SELECT 'FacultyAlias', 'rows', COUNT_BIG(*) FROM paws.FacultyAlias
  UNION ALL SELECT 'FacultyAlias', 'duplicate_normalized_alias_groups', COUNT_BIG(*) FROM (SELECT LOWER(LTRIM(RTRIM(AliasName))) AS K FROM paws.FacultyAlias WHERE Active = 1 GROUP BY LOWER(LTRIM(RTRIM(AliasName))) HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'FacultyAlias', 'blank_alias_or_target', COUNT_BIG(*) FROM paws.FacultyAlias WHERE NULLIF(LTRIM(RTRIM(AliasName)), '') IS NULL OR NULLIF(LTRIM(RTRIM(TargetDisplayName)), '') IS NULL
  UNION ALL SELECT 'FacultyAlias', 'alias_target_without_faculty_match', COUNT_BIG(*) FROM paws.FacultyAlias a WHERE NOT EXISTS (SELECT 1 FROM paws.Faculty f WHERE LOWER(LTRIM(RTRIM(f.DisplayName))) = LOWER(LTRIM(RTRIM(a.TargetDisplayName))))
  UNION ALL SELECT 'FacultyAlias', 'missing_faculty_reference', COUNT_BIG(*) FROM paws.FacultyAlias a LEFT JOIN paws.Faculty f ON f.FacultyId = a.FacultyId WHERE f.FacultyId IS NULL
  UNION ALL SELECT 'FacultyProfessionalProfile', 'rows', COUNT_BIG(*) FROM paws.FacultyProfessionalProfile
  UNION ALL SELECT 'FacultyProfessionalProfile', 'active_faculty_without_profile', COUNT_BIG(*) FROM paws.Faculty f LEFT JOIN paws.FacultyProfessionalProfile p ON p.FacultyId = f.FacultyId WHERE f.Active = 1 AND p.FacultyId IS NULL
  UNION ALL SELECT 'JointAppointment', 'rows', COUNT_BIG(*) FROM paws.JointAppointment
  UNION ALL SELECT 'JointAppointment', 'missing_faculty_reference', COUNT_BIG(*) FROM paws.JointAppointment j LEFT JOIN paws.Faculty f ON f.FacultyId = j.FacultyId WHERE f.FacultyId IS NULL
  UNION ALL SELECT 'JointAppointment', 'missing_fte_values', COUNT_BIG(*) FROM paws.JointAppointment WHERE FteUcvm IS NULL OR FteOtherFaculty IS NULL
  UNION ALL SELECT 'JointAppointment', 'duplicate_normalized_exact_identity_groups', COUNT_BIG(*) FROM (SELECT FacultyId, LOWER(LTRIM(RTRIM(COALESCE(HomeFaculty, '')))) AS H, LOWER(LTRIM(RTRIM(COALESCE(JointFaculty, '')))) AS J, FteUcvm, FteOtherFaculty, ExpiryDate FROM paws.JointAppointment GROUP BY FacultyId, LOWER(LTRIM(RTRIM(COALESCE(HomeFaculty, '')))), LOWER(LTRIM(RTRIM(COALESCE(JointFaculty, '')))), FteUcvm, FteOtherFaculty, ExpiryDate HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'Course', 'rows', COUNT_BIG(*) FROM paws.Course
  UNION ALL SELECT 'Course', 'blank_course_code', COUNT_BIG(*) FROM paws.Course WHERE NULLIF(LTRIM(RTRIM(CourseCode)), '') IS NULL
  UNION ALL SELECT 'Course', 'duplicate_normalized_course_code_groups', COUNT_BIG(*) FROM (SELECT UPPER(REPLACE(LTRIM(RTRIM(CourseCode)), ' ', '')) AS K FROM paws.Course GROUP BY UPPER(REPLACE(LTRIM(RTRIM(CourseCode)), ' ', '')) HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'Course', 'course_code_whitespace_variants', COUNT_BIG(*) FROM paws.Course WHERE CourseCode <> LTRIM(RTRIM(CourseCode))
  UNION ALL SELECT 'Course', 'mixed_case_course_codes_review_only', COUNT_BIG(*) FROM paws.Course WHERE CourseCode COLLATE Latin1_General_CS_AS <> UPPER(CourseCode)
  UNION ALL SELECT 'Session', 'rows', COUNT_BIG(*) FROM paws.Session
  UNION ALL SELECT 'Session', 'academic_year_distinct_values', COUNT_BIG(DISTINCT AcademicYear) FROM paws.Session
  UNION ALL SELECT 'Session', 'noncanonical_academic_year_rows', COUNT_BIG(*) FROM paws.Session WHERE AcademicYear NOT LIKE '[12][0-9][0-9][0-9]-[0-9][0-9]' OR TRY_CONVERT(int, LEFT(AcademicYear, 4)) + 1 <> TRY_CONVERT(int, RIGHT(AcademicYear, 2)) + 2000
  UNION ALL SELECT 'Session', 'course_code_whitespace_variants', COUNT_BIG(*) FROM paws.Session WHERE CourseCode <> LTRIM(RTRIM(CourseCode))
  UNION ALL SELECT 'Session', 'course_code_not_equal_linked_course', COUNT_BIG(*) FROM paws.Session s JOIN paws.Course c ON c.CourseId = s.CourseId WHERE s.CourseCode COLLATE Latin1_General_CS_AS <> c.CourseCode COLLATE Latin1_General_CS_AS
  UNION ALL SELECT 'Session', 'session_type_distinct_vocabulary_values', COUNT_BIG(DISTINCT SessionType) FROM paws.Session
  UNION ALL SELECT 'Session', 'session_type_whitespace_variants', COUNT_BIG(*) FROM paws.Session WHERE SessionType <> LTRIM(RTRIM(SessionType))
  UNION ALL SELECT 'Session', 'missing_course_reference', COUNT_BIG(*) FROM paws.Session s LEFT JOIN paws.Course c ON c.CourseId = s.CourseId WHERE s.CourseId IS NOT NULL AND c.CourseId IS NULL
  UNION ALL SELECT 'Session', 'missing_session_date', COUNT_BIG(*) FROM paws.Session WHERE SessionDate IS NULL
  UNION ALL SELECT 'Session', 'missing_start_or_end_time', COUNT_BIG(*) FROM paws.Session WHERE StartTime IS NULL OR EndTime IS NULL
  UNION ALL SELECT 'Session', 'invalid_nonnull_time_interval', COUNT_BIG(*) FROM paws.Session WHERE StartTime IS NOT NULL AND EndTime IS NOT NULL AND StartTime >= EndTime
  UNION ALL SELECT 'Session', 'unknown_or_invalid_time_interval', COUNT_BIG(*) FROM paws.Session WHERE SessionDate IS NULL OR StartTime IS NULL OR EndTime IS NULL OR StartTime >= EndTime
  UNION ALL SELECT 'Session', 'before_calendar_grid', COUNT_BIG(*) FROM paws.Session WHERE SessionDate IS NOT NULL AND StartTime IS NOT NULL AND EndTime IS NOT NULL AND StartTime < EndTime AND EndTime <= CAST('07:30' AS time)
  UNION ALL SELECT 'Session', 'after_calendar_grid', COUNT_BIG(*) FROM paws.Session WHERE SessionDate IS NOT NULL AND StartTime IS NOT NULL AND EndTime IS NOT NULL AND StartTime < EndTime AND StartTime >= CAST('17:00' AS time)
  UNION ALL SELECT 'Session', 'duplicate_session_identity_groups', COUNT_BIG(*) FROM (SELECT AcademicYear, CourseId, SessionDate, StartTime, EndTime, LOWER(LTRIM(RTRIM(COALESCE(SessionType, '')))) AS T, LOWER(LTRIM(RTRIM(COALESCE(Topic, '')))) AS TopicKey FROM paws.Session GROUP BY AcademicYear, CourseId, SessionDate, StartTime, EndTime, LOWER(LTRIM(RTRIM(COALESCE(SessionType, '')))), LOWER(LTRIM(RTRIM(COALESCE(Topic, '')))) HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'SessionAssignment', 'rows', COUNT_BIG(*) FROM paws.SessionAssignment
  UNION ALL SELECT 'SessionAssignment', 'missing_session_reference', COUNT_BIG(*) FROM paws.SessionAssignment a LEFT JOIN paws.Session s ON s.SessionId = a.SessionId WHERE s.SessionId IS NULL
  UNION ALL SELECT 'SessionAssignment', 'null_faculty_id', COUNT_BIG(*) FROM paws.SessionAssignment WHERE FacultyId IS NULL
  UNION ALL SELECT 'SessionAssignment', 'orphan_faculty_reference', COUNT_BIG(*) FROM paws.SessionAssignment a LEFT JOIN paws.Faculty f ON f.FacultyId = a.FacultyId WHERE a.FacultyId IS NOT NULL AND f.FacultyId IS NULL
  UNION ALL SELECT 'SessionAssignment', 'resolution_method_distinct_values', COUNT_BIG(DISTINCT FacultyResolutionStatus) FROM paws.SessionAssignment
  UNION ALL SELECT 'SessionAssignment', 'duplicate_session_faculty_groups', COUNT_BIG(*) FROM (SELECT SessionId, FacultyId FROM paws.SessionAssignment WHERE FacultyId IS NOT NULL GROUP BY SessionId, FacultyId HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'SessionAssignment', '2026_27_rows_missing_doe_credit_rate_or_unit', COUNT_BIG(*) FROM paws.SessionAssignment a JOIN paws.Session s ON s.SessionId = a.SessionId WHERE s.AcademicYear = '2026-27' AND (a.DoeCredit IS NULL OR a.DoeRate IS NULL OR NULLIF(LTRIM(RTRIM(a.DoeUnit)), '') IS NULL)
  UNION ALL SELECT 'SessionAssignment', '2026_27_rows_missing_doe_quantity', COUNT_BIG(*) FROM paws.SessionAssignment a JOIN paws.Session s ON s.SessionId = a.SessionId WHERE s.AcademicYear = '2026-27' AND a.DoeQuantity IS NULL
  UNION ALL SELECT 'RoleDefinition', 'rows', COUNT_BIG(*) FROM paws.RoleDefinition
  UNION ALL SELECT 'RoleAssignment', 'rows', COUNT_BIG(*) FROM paws.RoleAssignment
  UNION ALL SELECT 'RoleAssignment', 'missing_faculty_reference', COUNT_BIG(*) FROM paws.RoleAssignment a LEFT JOIN paws.Faculty f ON f.FacultyId = a.FacultyId WHERE a.FacultyId IS NOT NULL AND f.FacultyId IS NULL
  UNION ALL SELECT 'RoleAssignment', 'missing_course_reference', COUNT_BIG(*) FROM paws.RoleAssignment a LEFT JOIN paws.Course c ON c.CourseId = a.CourseId WHERE a.CourseId IS NOT NULL AND c.CourseId IS NULL
  UNION ALL SELECT 'RoleAssignment', 'academic_year_distinct_values', COUNT_BIG(DISTINCT AcademicYear) FROM paws.RoleAssignment
  UNION ALL SELECT 'RoleAssignment', 'blank_role_type_or_category', COUNT_BIG(*) FROM paws.RoleAssignment WHERE NULLIF(LTRIM(RTRIM(RoleType)), '') IS NULL OR NULLIF(LTRIM(RTRIM(RoleCategory)), '') IS NULL
  UNION ALL SELECT 'RoleAssignment', 'distinct_role_type_values', COUNT_BIG(DISTINCT RoleType) FROM paws.RoleAssignment
  UNION ALL SELECT 'RoleAssignment', 'blank_role_category', COUNT_BIG(*) FROM paws.RoleAssignment WHERE NULLIF(LTRIM(RTRIM(RoleCategory)), '') IS NULL
  UNION ALL SELECT 'RoleAssignment', 'role_type_whitespace_variants', COUNT_BIG(*) FROM paws.RoleAssignment WHERE RoleType <> LTRIM(RTRIM(RoleType))
  UNION ALL SELECT 'RoleAssignment', 'missing_both_mapped_and_override_doe', COUNT_BIG(*) FROM paws.RoleAssignment WHERE DoeMappedValue IS NULL AND DoeOverrideValue IS NULL
  UNION ALL SELECT 'RoleAssignment', 'missing_effective_or_expiration_date', COUNT_BIG(*) FROM paws.RoleAssignment WHERE EffectiveDate IS NULL OR ExpirationDate IS NULL
  UNION ALL SELECT 'RoleAssignment', 'duplicate_role_assignment_identity_groups', COUNT_BIG(*) FROM (SELECT FacultyId, AcademicYear, CourseId, LOWER(LTRIM(RTRIM(COALESCE(RoleType, '')))) AS T, LOWER(LTRIM(RTRIM(COALESCE(RoleCategory, '')))) AS C, LOWER(LTRIM(RTRIM(COALESCE(CourseOrSubjectOrRotation, '')))) AS S, EffectiveDate, ExpirationDate FROM paws.RoleAssignment GROUP BY FacultyId, AcademicYear, CourseId, LOWER(LTRIM(RTRIM(COALESCE(RoleType, '')))), LOWER(LTRIM(RTRIM(COALESCE(RoleCategory, '')))), LOWER(LTRIM(RTRIM(COALESCE(CourseOrSubjectOrRotation, '')))), EffectiveDate, ExpirationDate HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'RoleAssignment', 'expiration_before_effective_date', COUNT_BIG(*) FROM paws.RoleAssignment WHERE EffectiveDate IS NOT NULL AND ExpirationDate IS NOT NULL AND ExpirationDate < EffectiveDate
  UNION ALL SELECT 'AfcRecord', 'legacy_rows', COUNT_BIG(*) FROM paws.AfcRecord
  UNION ALL SELECT 'AfcManualRecord', 'manual_rows', COUNT_BIG(*) FROM paws.AfcManualRecord
  UNION ALL SELECT 'AfcRequest', 'request_rows', COUNT_BIG(*) FROM paws.AfcRequest
  UNION ALL SELECT 'AfcApproval', 'approval_rows', COUNT_BIG(*) FROM paws.AfcApproval
  UNION ALL SELECT 'AfcArtifact', 'artifact_rows', COUNT_BIG(*) FROM paws.AfcArtifact
  UNION ALL SELECT 'AfcRequest', 'missing_faculty_reference', COUNT_BIG(*) FROM paws.AfcRequest r LEFT JOIN paws.Faculty f ON f.FacultyId = r.FacultyId WHERE f.FacultyId IS NULL
  UNION ALL SELECT 'AfcApproval', 'missing_request_reference', COUNT_BIG(*) FROM paws.AfcApproval a LEFT JOIN paws.AfcRequest r ON r.AfcRequestId = a.AfcRequestId WHERE r.AfcRequestId IS NULL
  UNION ALL SELECT 'AfcArtifact', 'missing_request_reference', COUNT_BIG(*) FROM paws.AfcArtifact a LEFT JOIN paws.AfcRequest r ON r.AfcRequestId = a.AfcRequestId WHERE r.AfcRequestId IS NULL
  UNION ALL SELECT 'AfcRecordUnified', 'unified_rows', COUNT_BIG(*) FROM paws.vAfcRecordUnified
  UNION ALL SELECT 'AfcRecordUnified', 'import_source_rows', COUNT_BIG(*) FROM paws.vAfcRecordUnified WHERE SourceKind = 'import'
  UNION ALL SELECT 'AfcRecordUnified', 'manual_source_rows', COUNT_BIG(*) FROM paws.vAfcRecordUnified WHERE SourceKind = 'manual'
  UNION ALL SELECT 'AfcRecordUnified', 'request_source_rows', COUNT_BIG(*) FROM paws.vAfcRecordUnified WHERE SourceKind = 'request'
  UNION ALL SELECT 'UserProfile', 'rows', COUNT_BIG(*) FROM paws.UserProfile
  UNION ALL SELECT 'UserProfile', 'blank_email_or_display_name_or_base_role', COUNT_BIG(*) FROM paws.UserProfile WHERE NULLIF(LTRIM(RTRIM(Email)), '') IS NULL OR NULLIF(LTRIM(RTRIM(DisplayName)), '') IS NULL OR NULLIF(LTRIM(RTRIM(BaseRole)), '') IS NULL
  UNION ALL SELECT 'UserProfile', 'faculty_roles_without_faculty_link', COUNT_BIG(*) FROM paws.UserProfile WHERE LOWER(BaseRole) IN ('faculty','hicc','visc') AND FacultyId IS NULL
  UNION ALL SELECT 'UserProfile', 'nonfaculty_roles_with_faculty_link', COUNT_BIG(*) FROM paws.UserProfile WHERE LOWER(BaseRole) NOT IN ('faculty','hicc','visc') AND FacultyId IS NOT NULL
  UNION ALL SELECT 'UserProfile', 'profile_with_inactive_faculty', COUNT_BIG(*) FROM paws.UserProfile p JOIN paws.Faculty f ON f.FacultyId = p.FacultyId WHERE p.Active = 1 AND f.Active = 0
  UNION ALL SELECT 'UserProfile', 'active_faculty_without_active_user_profile', COUNT_BIG(*) FROM paws.Faculty f WHERE f.Active = 1 AND NOT EXISTS (SELECT 1 FROM paws.UserProfile p WHERE p.FacultyId = f.FacultyId AND p.Active = 1)
  UNION ALL SELECT 'UserProfile', 'duplicate_normalized_email_groups', COUNT_BIG(*) FROM (SELECT LOWER(LTRIM(RTRIM(Email))) AS K FROM paws.UserProfile GROUP BY LOWER(LTRIM(RTRIM(Email))) HAVING COUNT_BIG(*) > 1) q
  UNION ALL SELECT 'DoePolicyVersion', 'rows', COUNT_BIG(*) FROM paws.DoePolicyVersion
  UNION ALL SELECT 'DoeFacultyTarget', 'rows', COUNT_BIG(*) FROM paws.DoeFacultyTarget
  UNION ALL SELECT 'DoeFacultyTarget', 'active_2026_27_targets', COUNT_BIG(*) FROM paws.DoeFacultyTarget WHERE Active = 1 AND AcademicYear = '2026-27'
  UNION ALL SELECT 'DoeFacultyTarget', 'active_targets_missing_contract_or_policy_source', COUNT_BIG(*) FROM paws.DoeFacultyTarget WHERE Active = 1 AND (ContractTeachingDoe IS NULL OR NULLIF(LTRIM(RTRIM(Source)), '') IS NULL OR PolicyVersionId IS NULL)
  UNION ALL SELECT 'DoeFacultyAllocation', 'rows', COUNT_BIG(*) FROM paws.DoeFacultyAllocation
  UNION ALL SELECT 'DoeFacultyAllocation', 'active_2026_27_rows', COUNT_BIG(*) FROM paws.DoeFacultyAllocation WHERE Active = 1 AND AcademicYear = '2026-27'
  UNION ALL SELECT 'DoeFacultyAllocation', 'active_rows_missing_source_or_policy', COUNT_BIG(*) FROM paws.DoeFacultyAllocation WHERE Active = 1 AND (NULLIF(LTRIM(RTRIM(SourceReference)), '') IS NULL OR PolicyVersionId IS NULL)
  UNION ALL SELECT 'DoeRuleSeed', 'rows', COUNT_BIG(*) FROM paws.DoeRuleSeed
  UNION ALL SELECT 'DoeRuleSeed', 'rows_with_rate_or_tier', COUNT_BIG(*) FROM paws.DoeRuleSeed WHERE RateOrTierPct IS NOT NULL
  UNION ALL SELECT 'DoeRuleSeed', 'rows_with_authority_indicator', COUNT_BIG(*) FROM paws.DoeRuleSeed WHERE AuthoritativeInExcel IS NOT NULL
  UNION ALL SELECT 'DoeRuleSeed', 'rows_with_source_link', COUNT_BIG(*) FROM paws.DoeRuleSeed WHERE SourceUrl IS NOT NULL
  UNION ALL SELECT 'AuditEvent', 'rows', COUNT_BIG(*) FROM paws.AuditEvent
) AS Audit
ORDER BY Scope, Metric;

SELECT 'RoleType' AS Vocabulary, RoleType AS Value, RoleCategory AS Category,
       CASE WHEN EXISTS (SELECT 1 FROM paws.RoleDefinition d WHERE LOWER(LTRIM(RTRIM(d.DatabaseRole))) = LOWER(LTRIM(RTRIM(r.RoleType)))) THEN 1 ELSE 0 END AS RoleDefinitionMatch,
       COUNT_BIG(*) AS Rows
FROM paws.RoleAssignment r
GROUP BY RoleType, RoleCategory
ORDER BY RoleType, RoleCategory;

SELECT 'SessionType' AS Vocabulary, SessionType AS Value, COUNT_BIG(*) AS Rows
FROM paws.Session
GROUP BY SessionType
ORDER BY SessionType;
