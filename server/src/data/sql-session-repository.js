'use strict';

const {DEFAULT_SERVER,DEFAULT_DATABASE,SQL_RESOURCE,appServiceManagedIdentityToken,createSqlPoolRunner}=require('./sql-connection.js');

const text=value=>String(value??'').trim();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));

function createSqlSessionRepository({poolRunner=null,sqlModule=null,tokenProvider=appServiceManagedIdentityToken,connectionString='',server=DEFAULT_SERVER,database=DEFAULT_DATABASE}={}){
  const serverName=text(server)||DEFAULT_SERVER,databaseName=text(database)||DEFAULT_DATABASE;
  const withPool=poolRunner||createSqlPoolRunner({sqlModule,tokenProvider,connectionString,server:serverName,database:databaseName});

  async function ping(){
    return withPool(async pool=>{
      await pool.request().query('SELECT TOP (1) 1 AS ok FROM paws.Session;');
      return true;
    });
  }

  async function listSessions({start,end,facultyEmail=''}={}){
    if(!validDate(start)||!validDate(end)||start>end){
      throw Object.assign(Error('A valid start/end date range is required.'),{code:'INVALID_DATE_RANGE',statusCode:400});
    }
    return withPool(async pool=>{
      const request=pool.request();
      request.input('start',start);
      request.input('end',end);
      request.input('facultyEmail',text(facultyEmail)||null);
      const result=await request.query(`
SELECT
  CONVERT(varchar(36),v.SessionId) AS sessionId,
  v.AcademicYear AS academicYear,
  v.CurriculumYear AS curriculumYear,
  v.CourseCode AS course,
  v.CourseName AS courseName,
  v.Topic AS topic,
  v.SessionType AS type,
  CONVERT(varchar(10),v.SessionDate,23) AS [date],
  CASE WHEN v.StartTime IS NULL THEN '' ELSE LEFT(CONVERT(varchar(8),v.StartTime,108),5) END AS [start],
  CASE WHEN v.EndTime IS NULL THEN '' ELSE LEFT(CONVERT(varchar(8),v.EndTime,108),5) END AS [end],
  v.Room AS room,
  COALESCE(v.InstructorNames,N'') AS instructor
FROM paws.vCalendarSession AS v
WHERE v.SessionDate >= @start
  AND v.SessionDate <= @end
  AND (
    @facultyEmail IS NULL OR EXISTS (
      SELECT 1
      FROM paws.SessionAssignment AS sa
      INNER JOIN paws.Faculty AS f ON f.FacultyId=sa.FacultyId
      WHERE sa.SessionId=v.SessionId
        AND LOWER(f.Email)=LOWER(@facultyEmail)
    )
  )
ORDER BY v.SessionDate,v.StartTime,v.CourseCode,v.SessionId;`);
      return (result?.recordset||[]).map(row=>{
        const sessionId=text(row.sessionId),instructor=text(row.instructor),yearMatch=text(row.curriculumYear).match(/\d+/);
        return{
          id:sessionId,sessionId,academicYear:text(row.academicYear),
          year:yearMatch?Number(yearMatch[0]):null,
          course:text(row.course),courseName:text(row.courseName),topic:text(row.topic),type:text(row.type),
          date:text(row.date).slice(0,10),start:text(row.start),end:text(row.end),
          timeUnknown:!text(row.start)||!text(row.end),room:text(row.room),
          instructor,instructorNames:[...new Set(instructor.split(';').map(name=>name.trim()).filter(Boolean))]
        };
      });
    });
  }
  return Object.freeze({listSessions,ping,server:serverName,database:databaseName});
}

module.exports={DEFAULT_SERVER,DEFAULT_DATABASE,SQL_RESOURCE,appServiceManagedIdentityToken,createSqlSessionRepository};
