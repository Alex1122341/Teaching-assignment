from __future__ import annotations

BUSINESS_SHEETS = {
    "Key": ("faculty_raw.jsonl", "preferred_full_name_last_first"),
    "Education & Experience": ("faculty_professional_raw.jsonl", "preferred_full_name_last_first"),
    "Joint Appointments": ("joint_appointment_raw.jsonl", "preferred_full_name_last_first"),
    "Faculty Overview": ("faculty_overview_raw.jsonl", "faculty_name"),
    "Teaching Assignments": ("teaching_assignment_raw.jsonl", "faculty_name"),
    "Role Assignments": ("role_assignment_raw.jsonl", "faculty_name"),
    "Courses": ("course_raw.jsonl", "course"),
    "DOE Rules": ("doe_rule_raw.jsonl", "category"),
    "Account Roles": ("account_role_raw.jsonl", "database_role"),
    "AFC records": ("afc_record_raw.jsonl", "faculty_member"),
}

PLACEHOLDERS = {
    "Z-Sessional": "sessional_pool",
    "Z-Other": "other_pool",
    "TBD - New Clin Path Hire - AG": "vacancy",
    "TBD - New Clin Path Hire - CW": "vacancy",
}


FORMER_FACULTY_EXCLUSIONS = {
    "Zachar, Erin",
}
