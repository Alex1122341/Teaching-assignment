'use strict';

const {DEFAULT_SERVER,DEFAULT_DATABASE,appServiceManagedIdentityTokenWithExpiry}=require('./sql-session-repository.js');
const {createSqlConnection}=require('./sql-connection.js');
const text=value=>String(value??'').trim();
const email=value=>text(value).toLowerCase();

const PROFILE_COLUMNS=`FirebaseUid,Email,DisplayName,BaseRole,CONVERT(varchar(36),FacultyId) AS FacultyId,
       Active,MustChangePassword,OfficeName`;

const SELECT_BY_UID=`SELECT ${PROFILE_COLUMNS}
FROM paws.UserProfile
WHERE FirebaseUid=@uid;`;

const SELECT_BY_EMAIL=`SELECT TOP (1) ${PROFILE_COLUMNS}
FROM paws.UserProfile
WHERE LOWER(Email)=LOWER(@email);`;

const SELECT_FACULTY_BY_EMAIL=`
SELECT TOP (1) CONVERT(varchar(36),FacultyId) AS FacultyId,DisplayName
FROM paws.Faculty
WHERE Active=1 AND Email IS NOT NULL AND LOWER(Email)=LOWER(@email);`;

const INSERT_PROFILE=`
INSERT paws.UserProfile
  (FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword,OfficeName)
VALUES
  (@uid,@email,@displayName,@baseRole,
   CASE WHEN @facultyId IS NULL OR @facultyId='' THEN NULL ELSE CONVERT(uniqueidentifier,@facultyId) END,
   1,0,@officeName);`;

// Roles this repository is allowed to write into paws.UserProfile. Mirrors
// `server/src/auth/role-policy.js`; `other_office` is a formal role here.
const ALLOWED_ROLES=new Set(['developer','owner','administrator','adfa_general','adfa_regular','adc','lab','other_office','hicc','visc','faculty']);

function createSqlUserRepository({sqlModule=null,tokenProvider=appServiceManagedIdentityTokenWithExpiry,server=DEFAULT_SERVER,database=DEFAULT_DATABASE,connection=null,requestTimeoutMs}={}){
  const serverName=text(server)||DEFAULT_SERVER,databaseName=text(database)||DEFAULT_DATABASE;
  // One shared connection per repository instance. This used to open and close a
  // connection pool around every statement, so a single sign-in paid for several
  // full handshakes.
  const sqlConnection=connection||createSqlConnection({sqlModule,tokenProvider,server:serverName,database:databaseName,requestTimeoutMs});

  const map=row=>row?{
    uid:text(row.FirebaseUid),email:email(row.Email),name:text(row.DisplayName),role:text(row.BaseRole).toLowerCase(),
    facultyId:text(row.FacultyId),active:Boolean(row.Active),mustChangePassword:Boolean(row.MustChangePassword),
    officeName:text(row.OfficeName)
  }:null;

  async function getByUid(uid){
    const id=text(uid);if(!id)return null;
    const rows=await sqlConnection.query(SELECT_BY_UID,{uid:id});
    return map(rows[0]);
  }

  // KNOWN ISSUE (tracked, deliberately not changed here): this is a
  // read-then-insert sequence. Two concurrent first sign-ins for the same
  // identity can both pass the "email already linked" check. The correct fix is
  // to run the sequence inside `sqlConnection.transaction(...)` at SERIALIZABLE
  // isolation, which this connection now supports. That change is NOT made here
  // because it alters the authentication path and cannot be validated without a
  // reachable Azure SQL instance. See docs/migration/phase-a-foundation.md.
  async function provision({uid,email:rawEmail,name='',bootstrap=null}={}){
    const id=text(uid),mail=email(rawEmail);
    if(!id||!mail)throw Object.assign(Error('Verified Firebase UID and email are required.'),{code:'SQL_PROFILE_IDENTITY_REQUIRED',statusCode:403});

    let rows=await sqlConnection.query(SELECT_BY_UID,{uid:id});
    if(rows[0])return map(rows[0]);

    rows=await sqlConnection.query(SELECT_BY_EMAIL,{email:mail});
    if(rows[0]){
      throw Object.assign(Error('This account email is already linked to another Firebase UID.'),{code:'SQL_PROFILE_EMAIL_ALREADY_LINKED',statusCode:409});
    }

    const faculty=await sqlConnection.query(SELECT_FACULTY_BY_EMAIL,{email:mail});
    const facultyRow=faculty[0]||null;
    const seed=bootstrap&&typeof bootstrap==='object'?bootstrap:null;
    if(!facultyRow&&!seed){
      throw Object.assign(Error('No approved SQL account profile exists for this Firebase identity.'),{code:'SQL_PROFILE_REQUIRED',statusCode:403});
    }
    const role=text(seed?.role||(facultyRow?'faculty':'')).toLowerCase();
    if(!ALLOWED_ROLES.has(role))throw Object.assign(Error('Approved bootstrap role is invalid.'),{code:'SQL_PROFILE_ROLE_INVALID',statusCode:500});
    const displayName=text(seed?.displayName||facultyRow?.DisplayName||name||mail);
    const facultyId=text(seed?.facultyId||facultyRow?.FacultyId)||null;
    const officeName=text(seed?.officeName)||null;

    await sqlConnection.query(INSERT_PROFILE,{
      uid:id,email:mail,displayName,baseRole:role,facultyId,officeName
    });
    return{uid:id,email:mail,name:displayName,role,facultyId:facultyId||'',active:true,mustChangePassword:false,officeName:officeName||''};
  }

  async function close(){
    await sqlConnection.close();
  }

  return Object.freeze({getByUid,provision,close,server:serverName,database:databaseName});
}

module.exports={createSqlUserRepository,ALLOWED_ROLES};
