#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const SERVICE=require('../doe-policy-service.js');

const text=value=>String(value??'').trim();
const clone=value=>JSON.parse(JSON.stringify(value??null));
const roleType=value=>text(value).toLowerCase();

function classify(input,options={}){
  return SERVICE.classifyLegacyDoeSource(input,options);
}

function matchingRule(role,rules){
  const type=roleType(role?.type);
  return (Array.isArray(rules)?rules:[]).find(rule=>roleType(rule?.roleType)===type||roleType(rule?.appliesToRole)===type||roleType(rule?.ruleKey).includes(type))||null;
}
function matchingCourse(role,mappings){
  const course=text(role?.courseCode||role?.assignment);
  return (Array.isArray(mappings)?mappings:[]).find(row=>text(row?.courseCode)===course)||null;
}
function historicalEvidence(faculty){
  return{
    facultyId:text(faculty?.__id||faculty?.id||faculty?.ucid),
    facultySummary2026_27:clone(faculty?.facultySummary2026_27),
    workloadPolicy2026_27:clone(faculty?.workloadPolicy2026_27),
    managedRoles2026_27:clone(Array.isArray(faculty?.managedRoles2026_27)?faculty.managedRoles2026_27:[])
  };
}
function plan(facultyRows,{academicYear='2026-27',courseMappings=[],activeRules=[],tolerance=.01}={}){
  const rows=[],evidence=[];
  for(const faculty of Array.isArray(facultyRows)?facultyRows:[]){
    const facultyId=text(faculty?.__id||faculty?.id||faculty?.ucid);
    evidence.push(historicalEvidence(faculty));
    const explainedLines=[];
    for(const managedRole of Array.isArray(faculty?.managedRoles2026_27)?faculty.managedRoles2026_27:[]){
      const result=classify({facultyId,academicYear,managedRole,courseMapping:matchingCourse(managedRole,courseMappings),activeRule:matchingRule(managedRole,activeRules)},{tolerance});
      rows.push(result);
      if(result.classification==='assignment_fact_candidate'&&result.calculatedDoe!==null)explainedLines.push({resultDoe:result.calculatedDoe});
    }
    const sourceTotal=faculty?.facultySummary2026_27?.sourceNonTimetableTeachingDOE;
    if(sourceTotal!==undefined&&sourceTotal!==null&&sourceTotal!=='')rows.push(classify({facultyId,academicYear,sourceNonTimetableTeachingDOE:sourceTotal,explainedLines,sourceReference:'facultySummary2026_27.sourceNonTimetableTeachingDOE'},{tolerance}));
  }
  return{
    academicYear,
    rows,
    historicalEvidence:evidence,
    writes:[],
    summary:{
      assignmentFactCandidates:rows.filter(row=>row.classification==='assignment_fact_candidate').length,
      approvedDiscretionary:rows.filter(row=>row.classification==='approved_discretionary').length,
      fixedExceptions:rows.filter(row=>row.classification==='fixed_exception').length,
      unresolved:rows.filter(row=>row.classification==='unresolved').length
    }
  };
}

if(require.main===module){
  const inputPath=process.argv[2];
  if(!inputPath){console.error('Usage: node tools/plan-doe-assignment-migration.js <input.json>');process.exitCode=2}
  else{
    const payload=JSON.parse(fs.readFileSync(inputPath,'utf8'));
    process.stdout.write(JSON.stringify(plan(payload.faculty||payload.rows||[],payload.options||{}),null,2)+'\n');
  }
}

module.exports={classify,plan,historicalEvidence};
