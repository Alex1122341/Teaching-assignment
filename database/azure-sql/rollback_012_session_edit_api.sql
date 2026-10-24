/* Run only after the API no longer references this procedure. */
SET NOCOUNT ON;
IF OBJECT_ID(N'paws_api.UpdateCalendarSession', N'P') IS NOT NULL
    DROP PROCEDURE paws_api.UpdateCalendarSession;
GO
