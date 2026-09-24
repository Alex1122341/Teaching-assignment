'use strict';

const {DEFAULT_SERVER,DEFAULT_DATABASE,appServiceManagedIdentityToken}=require('./sql-session-repository.js');
const text=value=>String(value??'').trim();
const email=value=>text(value).toLowerCase();

function createSqlUserRepository({sqlModule=null,tokenProvider=appServiceManagedIdentityToken,server=DEFAULT_SERVER,database=DEFAULT_DATABASE}={}){
  const serverName=text(server)||DEFAULT_SERVER,databaseName=text(database)||DEFAULT_DATABASE;
  async function withPool(work){
    const sql=sqlModule||require('mssql');
    const token=await tokenProvider();
    const pool=new sql.ConnectionPool({
      server:serverName,database:databaseName,port:1433,
      options:{encrypt:true,trustServerCertificate:false,enableArithAbort:true},
      authentication:{type:'azure-active-directory-access-token',options:{token}}
    });
    await pool.connect();
    try{return await work(pool,sql)}finally{try{await pool.close()}catch{}}
  }
  const map=row=>row?{
    uid:text(row.FirebaseUid),email:email(row.Email),name:text(row.DisplayName),role:text(row.BaseRole).toLowerCase(),
    facultyId:text(row.FacultyId),active:Boolean(row.Active),mustChangePassword:Boolean(row.MustChangePassword),
    officeName:text(row.OfficeName)
  }:null;

  async function getByUid(uid){
    const id=text(uid);if(!id)return null;
    return withPool(async pool=>{
      const request=pool.request();request.input('uid',id);
      const result=await request.query(`
SELECT FirebaseUid,Email,DisplayName,BaseRole,CONVERT(varchar(36),FacultyId) AS FacultyId,
       Active,MustChangePassword,OfficeName
FROM paws.UserProfile
WHERE FirebaseUid=@uid;`);
      return map(result?.recordset?.[0]);
    });
  }

  async function provision({uid,email:rawEmail,name='',bootstrap=null}={}){
    const id=text(uid),mail=email(rawEmail);
    if(!id||!mail)throw Object.assign(Error('Verified Firebase UID and email are required.'),{code:'SQL_PROFILE_IDENTITY_REQUIRED',statusCode:403});
    return withPool(async pool=>{
      const existingReq=pool.request();existingReq.input('uid',id);
      let result=await existingReq.query(`
SELECT FirebaseUid,Email,DisplayName,BaseRole,CONVERT(varchar(36),FacultyId) AS FacultyId,
       Active,MustChangePassword,OfficeName
FROM paws.UserProfile WHERE FirebaseUid=@uid;`);
      if(result?.recordset?.[0])return map(result.recordset[0]);

      const byEmail=pool.request();byEmail.input('email',mail);
      result=await byEmail.query(`
SELECT TOP (1) FirebaseUid,Email,DisplayName,BaseRole,CONVERT(varchar(36),FacultyId) AS FacultyId,
       Active,MustChangePassword,OfficeName
FROM paws.UserProfile WHERE LOWER(Email)=LOWER(@email);`);
      if(result?.recordset?.[0]){
        throw Object.assign(Error('This account email is already linked to another Firebase UID.'),{code:'SQL_PROFILE_EMAIL_ALREADY_LINKED',statusCode:409});
      }

      const facultyReq=pool.request();facultyReq.input('email',mail);
      const faculty=await facultyReq.query(`
SELECT TOP (1) CONVERT(varchar(36),FacultyId) AS FacultyId,DisplayName
FROM paws.Faculty
WHERE Active=1 AND Email IS NOT NULL AND LOWER(Email)=LOWER(@email);`);
      const facultyRow=faculty?.recordset?.[0]||null;
      const seed=bootstrap&&typeof bootstrap==='object'?bootstrap:null;
      if(!facultyRow&&!seed){
        throw Object.assign(Error('No approved SQL account profile exists for this Firebase identity.'),{code:'SQL_PROFILE_REQUIRED',statusCode:403});
      }
      const allowedRoles=new Set(['developer','owner','administrator','adfa_general','adfa_regular','adc','lab','other_office','hicc','visc','faculty']);
      const role=text(seed?.role||(facultyRow?'faculty':'')).toLowerCase();
      if(!allowedRoles.has(role))throw Object.assign(Error('Approved bootstrap role is invalid.'),{code:'SQL_PROFILE_ROLE_INVALID',statusCode:500});
      const displayName=text(seed?.displayName||facultyRow?.DisplayName||name||mail);
      const facultyId=text(seed?.facultyId||facultyRow?.FacultyId)||null;
      const officeName=text(seed?.officeName)||null;

      const insert=pool.request();
      insert.input('uid',id);insert.input('email',mail);insert.input('displayName',displayName);
      insert.input('baseRole',role);insert.input('facultyId',facultyId);insert.input('officeName',officeName);
      await insert.query(`
INSERT paws.UserProfile
  (FirebaseUid,Email,DisplayName,BaseRole,FacultyId,Active,MustChangePassword,OfficeName)
VALUES
  (@uid,@email,@displayName,@baseRole,
   CASE WHEN @facultyId IS NULL OR @facultyId='' THEN NULL ELSE CONVERT(uniqueidentifier,@facultyId) END,
   1,0,@officeName);`);
      return{uid:id,email:mail,name:displayName,role,facultyId:facultyId||'',active:true,mustChangePassword:false,officeName:officeName||''};
    });
  }
  return Object.freeze({getByUid,provision,server:serverName,database:databaseName});
}

module.exports={createSqlUserRepository};
