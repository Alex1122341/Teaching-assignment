IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = N'paws_swa_beta'
)
    THROW 50001, 'Contained user paws_swa_beta must exist before permissions are applied.', 1;

GRANT SELECT ON OBJECT::paws.UserProfile TO [paws_swa_beta];
GRANT INSERT ON OBJECT::paws.UserProfile TO [paws_swa_beta];
GRANT SELECT ON OBJECT::paws.Faculty TO [paws_swa_beta];
GRANT SELECT ON OBJECT::paws.SessionAssignment TO [paws_swa_beta];
GRANT SELECT ON OBJECT::paws.vCalendarSession TO [paws_swa_beta];

DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::staging TO [paws_swa_beta];
