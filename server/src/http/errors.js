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

// Codes that carry a fixed status without setting `statusCode` on the error.
// A malformed academic year is a caller error, not a server fault: without this
// entry it would surface as 500 and read as an outage.
const STATUS_BY_CODE=Object.freeze({
  AUTH_REQUIRED:401,
  FORBIDDEN:403,
  INVALID_ACADEMIC_YEAR:400,
  WRITE_DISABLED:503
});

function statusFor(error){
  const explicit=Number(error?.statusCode);
  if(Number.isInteger(explicit)&&explicit>=400&&explicit<=599)return explicit;
  const mapped=STATUS_BY_CODE[String(error?.code||'')];
  if(mapped)return mapped;
  return 500;
}

module.exports={ApiError,errorPayload,statusFor};
