'use strict';

const { createSqlConnection } = require('./sql-connection.js');

const DEFAULT_SERVER='ucvm-teaching-lab-xz-20260911.database.windows.net';
const DEFAULT_DATABASE='teaching-assignment-lab';
const SQL_RESOURCE='https://database.windows.net/';

const text=value=>String(value??'').trim();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));

async function requestManagedIdentityPayload({env=process.env,fetchImpl=globalThis.fetch}={}){
  const endpoint=text(env.IDENTITY_ENDPOINT),header=text(env.IDENTITY_HEADER);
  if(!endpoint||!header||typeof fetchImpl!=='function'){
    throw Object.assign(Error('Azure App Service managed identity is not available.'),{code:'SQL_IDENTITY_UNAVAILABLE',statusCode:503});
  }
  const url=new URL(endpoint);
  url.searchParams.set('resource',SQL_RESOURCE);
  url.searchParams.set('api-version','2019-08-01');
  const response=await fetchImpl(url,{method:'GET',headers:{'X-IDENTITY-HEADER':header}});
  if(!response.ok){
    throw Object.assign(Error('Azure managed identity token request failed.'),{code:'SQL_IDENTITY_TOKEN_FAILED',statusCode:503});
  }
  const payload=await response.json();
  const token=text(payload?.access_token);
  if(!token)throw Object.assign(Error('Azure managed identity returned no SQL access token.'),{code:'SQL_IDENTITY_TOKEN_MISSING',statusCode:503});
  return {token,expiresOn:payload?.expires_on};
}

// Plain-string contract, retained for callers that only need the token.
async function appServiceManagedIdentityToken(options={}){
  const {token}=await requestManagedIdentityPayload(options);
  return token;
}

// Token plus Azure's reported expiry, so the shared connection can rebuild its
// pool before the bound token goes stale instead of failing the first query
// after expiry.
function appServiceManagedIdentityTokenWithExpiry(options={}){
  return requestManagedIdentityPayload(options);
}

function createSqlSessionRepository({sqlModule=null,tokenProvider=appServiceManagedIdentityTokenWithExpiry,server=DEFAULT_SERVER,database=DEFAULT_DATABASE,connection=null,requestTimeoutMs}={}){
  const serverName=text(server)||DEFAULT_SERVER,databaseName=text(database)||DEFAULT_DATABASE;
  // One shared connection per repository instance. Previously this opened and
  // closed a connection pool for every single call, paying a full handshake per
  // request and making transactions impossible.
  const sqlConnection=connection||createSqlConnection({sqlModule,tokenProvider,server:serverName,database:databaseName,requestTimeoutMs});

  async function ping(){
    await sqlConnection.query('SELECT TOP (1) 1 AS ok FROM paws.Session;');
    return true;
  }

  async function listSessions({start,end,facultyEmail='',academicYear=''}={}){
    if(!validDate(start)||!validDate(end)||start>end){
      throw Object.assign(Error('A valid start/end date range is required.'),{code:'INVALID_DATE_RANGE',statusCode:400});
    }
    // The year predicate is appended only when a year is supplied, so an
    // unfiltered read keeps its existing statement shape and parameter list.
    const yearFilter=text(academicYear);
    const params={start,end,facultyEmail:text(facultyEmail)||null};
    let yearClause='';
    if(yearFilter){
      params.academicYear=yearFilter;
      yearClause='  AND v.AcademicYear = @academicYear\n';
    }
    const rows=await sqlConnection.query(`
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
${yearClause}  AND (
    @facultyEmail IS NULL OR EXISTS (
      SELECT 1
      FROM paws.SessionAssignment AS sa
      INNER JOIN paws.Faculty AS f ON f.FacultyId=sa.FacultyId
      WHERE sa.SessionId=v.SessionId
        AND LOWER(f.Email)=LOWER(@facultyEmail)
    )
  )
ORDER BY v.SessionDate,v.StartTime,v.CourseCode,v.SessionId;`,params);
    return rows.map(row=>{
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
  }

  async function close(){
    await sqlConnection.close();
  }

  return Object.freeze({listSessions,ping,close,server:serverName,database:databaseName});
}

module.exports={
  DEFAULT_SERVER,
  DEFAULT_DATABASE,
  SQL_RESOURCE,
  appServiceManagedIdentityToken,
  appServiceManagedIdentityTokenWithExpiry,
  createSqlSessionRepository
};
