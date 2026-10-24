'use strict';

const text=value=>String(value??'').trim();
const finite=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const round=value=>value===null?null:Number(Number(value).toFixed(6));

const minutes=value=>{
  const match=/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(text(value));
  return match?Number(match[1])*60+Number(match[2]):null;
};
const intervalHours=(start,end)=>{
  const first=minutes(start),last=minutes(end);
  return first===null||last===null||last<=first?null:(last-first)/60;
};
const dateParts=value=>{
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  if(!match)return{};
  const date=new Date(text(value)+'T00:00:00Z');
  return{year:Number(match[1]),week:Math.ceil((((date-new Date(Date.UTC(date.getUTCFullYear(),0,1)))/86400000)+1)/7)};
};

function assignmentFacts(session,assignment,facultyId){
  const hours=finite(assignment.creditedHours)??intervalHours(session.startTime,session.endTime);
  const facts={
    academicYear:text(session.academicYear),category:'teaching',activityType:text(session.sessionType),
    teachingRole:text(assignment.teachingRole),role:text(assignment.teachingRole),
    courseCode:text(session.courseCode),course:text(session.courseCode),sessionType:text(session.sessionType),
    curriculumStage:text(session.curriculumYear),shifts:1,date:text(session.sessionDate),topic:text(session.topic),
    facultyId:text(facultyId),sessionId:text(session.sessionId),assignmentId:text(assignment.sessionAssignmentId),
    sourceEntityType:'session_assignment',sourceEntityId:text(assignment.sessionAssignmentId),...dateParts(session.sessionDate)
  };
  if(hours!==null)facts.hours=hours;
  return facts;
}

const nullTotals=()=>({scheduledTeachingDoe:null,roleDoe:null,rawSupervisionDoe:null,appliedSupervisionDoe:null,adjustmentDoe:null,assignedTeachingDoe:null,effectiveTargetDoe:null,remainingDoe:null});
function summarize(worksheet){
  return{
    status:text(worksheet?.status)||'needs_review',
    contractDoe:finite(worksheet?.target?.contractTeachingDoe),
    policyVersionId:text(worksheet?.policyVersionId),
    totals:worksheet?.status==='calculated'?{...nullTotals(),...(worksheet.totals||{})}:nullTotals(),
    issueCodes:(worksheet?.errors||[]).map(error=>text(error?.code)).filter(Boolean)
  };
}

function createDoeWorkflowPreviewService({repository,worksheetService,calculationService}={}){
  if(typeof repository?.loadSessionDoeFacts!=='function')throw new TypeError('A SQL session DOE repository is required.');
  if(typeof worksheetService?.buildFacultyWorksheet!=='function'||typeof worksheetService?.previewFacultyWorksheet!=='function')throw new TypeError('A DOE worksheet preview service is required.');
  if(typeof calculationService?.preview!=='function')throw new TypeError('A server DOE calculation service is required.');

  return Object.freeze({
    async previewFacultyTransfer({sessionId,outgoingFacultyId,incomingFacultyId}={}){
      const id=text(sessionId),outgoingId=text(outgoingFacultyId),incomingId=text(incomingFacultyId);
      if(!id||!outgoingId||!incomingId)throw Object.assign(new Error('Session, outgoing faculty, and incoming faculty are required.'),{code:'DOE_WORKFLOW_PREVIEW_INVALID'});
      if(outgoingId===incomingId)throw Object.assign(new Error('Outgoing and incoming faculty must be different.'),{code:'FACULTY_TRANSFER_INVALID'});

      const session=await repository.loadSessionDoeFacts(id);
      if(!session)throw Object.assign(new Error('The SQL timetable session was not found.'),{code:'SESSION_NOT_FOUND'});
      const assignments=Array.isArray(session.assignments)?session.assignments:[];
      const outgoingMatches=assignments.filter(row=>text(row.facultyId)===outgoingId);
      if(outgoingMatches.length!==1)throw Object.assign(new Error('The outgoing faculty assignment is missing or ambiguous.'),{code:'FACULTY_ASSIGNMENT_AMBIGUOUS'});
      if(assignments.some(row=>text(row.facultyId)===incomingId))throw Object.assign(new Error('The incoming faculty member is already assigned to this session.'),{code:'FACULTY_ALREADY_ASSIGNED'});

      const outgoingAssignment=outgoingMatches[0];
      const [outgoingCurrent,incomingCurrent]=await Promise.all([
        worksheetService.buildFacultyWorksheet({facultyId:outgoingId,academicYear:session.academicYear}),
        worksheetService.buildFacultyWorksheet({facultyId:incomingId,academicYear:session.academicYear})
      ]);
      const outgoingLines=(outgoingCurrent.lines||[]).filter(line=>text(line.sourceEntityType)==='session_assignment'&&text(line.sourceEntityId)===text(outgoingAssignment.sessionAssignmentId));
      const outgoingLine=outgoingLines.length===1?outgoingLines[0]:null;
      const issueCodes=new Set([...summarize(outgoingCurrent).issueCodes,...summarize(incomingCurrent).issueCodes]);
      if(outgoingCurrent.status!=='calculated'||incomingCurrent.status!=='calculated'||outgoingLine?.status!=='calculated'||finite(outgoingLine?.resultDoe)===null){
        issueCodes.add('DOE_WORKSHEET_REVIEW_REQUIRED');
        return{
          status:'needs_review',academicYear:text(session.academicYear),sessionId:id,
          sessionDoeCredit:null,issueCodes:[...issueCodes],
          outgoing:{facultyId:outgoingId,current:summarize(outgoingCurrent),projected:{status:'needs_review',policyVersionId:'',totals:nullTotals(),issueCodes:[...issueCodes]}},
          incoming:{facultyId:incomingId,current:summarize(incomingCurrent),projected:{status:'needs_review',policyVersionId:'',totals:nullTotals(),issueCodes:[...issueCodes]}},
          evidencePersisted:false
        };
      }

      let proposed;
      try{
        proposed=await calculationService.preview({
          academicYear:text(session.academicYear),
          facts:assignmentFacts(session,outgoingAssignment,incomingId)
        });
      }catch(error){
        issueCodes.add(text(error?.code)||'DOE_CALCULATION_FAILED');
      }
      if(!proposed||proposed.status!=='calculated'||finite(proposed.resultDoe)===null){
        issueCodes.add('NEEDS_REVIEW');
        return{
          status:'needs_review',academicYear:text(session.academicYear),sessionId:id,
          sessionDoeCredit:null,issueCodes:[...issueCodes],
          outgoing:{facultyId:outgoingId,current:summarize(outgoingCurrent),projected:{status:'needs_review',policyVersionId:'',totals:nullTotals(),issueCodes:[...issueCodes]}},
          incoming:{facultyId:incomingId,current:summarize(incomingCurrent),projected:{status:'needs_review',policyVersionId:'',totals:nullTotals(),issueCodes:[...issueCodes]}},
          evidencePersisted:false
        };
      }

      const previewLine={
        lineId:'preview:'+text(outgoingAssignment.sessionAssignmentId),
        sourceEntityType:'session_assignment',sourceEntityId:text(outgoingAssignment.sessionAssignmentId),
        sessionId:id,category:'teaching',roleType:text(outgoingAssignment.teachingRole),
        resultDoe:round(finite(proposed.resultDoe)),status:'calculated',
        policyVersionId:text(proposed.policyVersionId),ruleId:text(proposed.ruleId),
        ruleKey:text(proposed.ruleKey),calculationText:text(proposed.calculationText)
      };
      const [outgoingProjected,incomingProjected]=await Promise.all([
        worksheetService.previewFacultyWorksheet({
          facultyId:outgoingId,academicYear:session.academicYear,
          removeSourceEntityId:text(outgoingAssignment.sessionAssignmentId)
        }),
        worksheetService.previewFacultyWorksheet({
          facultyId:incomingId,academicYear:session.academicYear,addLine:previewLine
        })
      ]);
      const out=summarize(outgoingProjected),incoming=summarize(incomingProjected);
      const policyVersionId=text(proposed.policyVersionId);
      const policyMatches=[outgoingCurrent,incomingCurrent,outgoingProjected,incomingProjected].every(row=>text(row?.policyVersionId)===policyVersionId);
      if(!policyMatches)issueCodes.add('DOE_POLICY_VERSION_MISMATCH');
      const status=out.status==='calculated'&&incoming.status==='calculated'&&policyMatches?'calculated':'needs_review';
      return{
        status,academicYear:text(session.academicYear),sessionId:id,
        sessionDoeCredit:status==='calculated'?round(finite(proposed.resultDoe)):null,
        policyVersionId,ruleKey:text(proposed.ruleKey),
        issueCodes:status==='calculated'?[]:[...new Set([...out.issueCodes,...incoming.issueCodes,'DOE_PROJECTED_WORKSHEET_REVIEW_REQUIRED'])],
        outgoing:{facultyId:outgoingId,current:summarize(outgoingCurrent),projected:status==='calculated'?out:{status:'needs_review',policyVersionId:out.policyVersionId,totals:nullTotals(),issueCodes:out.issueCodes}},
        incoming:{facultyId:incomingId,current:summarize(incomingCurrent),projected:status==='calculated'?incoming:{status:'needs_review',policyVersionId:incoming.policyVersionId,totals:nullTotals(),issueCodes:incoming.issueCodes}},
        evidencePersisted:false
      };
    }
  });
}

module.exports={createDoeWorkflowPreviewService};
