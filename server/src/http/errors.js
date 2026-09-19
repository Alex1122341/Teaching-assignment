'use strict';

class ApiError extends Error{
  constructor(code,message,statusCode=400,details={}){
    super(message);
    this.name='ApiError';
    this.code=code;
    this.statusCode=statusCode;
    this.details=details;
  }
}

function errorPayload(error){
  return{
    code:String(error?.code||'INTERNAL_ERROR'),
    message:String(error?.message||'Unexpected server error.'),
    ...(error?.details&&typeof error.details==='object'?{details:error.details}:{})
  };
}

function statusFor(error){
  const explicit=Number(error?.statusCode);
  if(Number.isInteger(explicit)&&explicit>=400&&explicit<=599)return explicit;
  if(error?.code==='AUTH_REQUIRED')return 401;
  if(error?.code==='FORBIDDEN')return 403;
  return 500;
}

module.exports={ApiError,errorPayload,statusFor};
