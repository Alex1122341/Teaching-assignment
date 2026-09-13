# Bulk Session Entry and Faculty Landing Design

The timetable remains the single calendar surface. Faculty accounts land on `index.html` in Day view with My Timetable enabled, while `faculty-dashboard.html` retains the teaching list, change history, and AFC workflow without its duplicate weekly calendar.

Administrators receive a spreadsheet-style bulk entry dialog. Each row contains date, year, course, type, start, end, topic, room, and faculty. Rows can be added, duplicated, removed, or pasted from tab-separated Excel data. Faculty cells accept semicolon-separated names, emails, or UCIDs and resolve them to Faculty Directory records before one atomic Firestore batch writes both sessions and session change logs. The dialog is capped at 200 rows because each row creates two Firestore writes.

The Latest Updates sidebar is removed. CSV, calendar, reload, and Outlook controls move into a compact bar below the timetable. Existing filters continue to determine exported rows.

The current Firebase sign-in has no Microsoft token. Directly creating and sending Outlook meetings therefore requires a UCalgary Entra application with delegated `User.Read` and `Calendars.ReadWrite`, an approved redirect URI, and tenant consent according to UCalgary policy. The immediately deployable option is an admin-only Outlook invitation package: it produces a standards-compliant `METHOD:REQUEST` ICS file with organizer and attendee email fields for all filtered sessions. Opening the package in Outlook allows the administrator to review invitations before sending. The dialog clearly states that downloading the package does not silently modify faculty calendars.

