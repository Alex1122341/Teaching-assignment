CREATE VIEW paws.vCalendarSession
AS
SELECT
    s.SessionId,
    s.AcademicYear,
    s.CurriculumYear,
    s.CourseCode,
    s.CourseName,
    s.Topic,
    s.SessionType,
    s.SessionDate,
    s.StartTime,
    s.EndTime,
    s.Room,
    names.InstructorNames
FROM paws.Session AS s
OUTER APPLY (
    SELECT STRING_AGG(f.DisplayName, N'; ') WITHIN GROUP (ORDER BY f.DisplayName) AS InstructorNames
    FROM paws.SessionAssignment AS sa
    INNER JOIN paws.Faculty AS f ON f.FacultyId = sa.FacultyId
    WHERE sa.SessionId = s.SessionId
) AS names;
