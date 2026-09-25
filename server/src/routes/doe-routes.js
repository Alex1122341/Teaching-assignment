'use strict';
const {ApiError,errorPayload,statusFor}=require('../http/errors.js');
const adminRoles=new Set(['developer','owner','administrator','admin','adfa_general','adfa_regular']);
const generalRoles=new Set(['developer','owner','adfa_general']);
const selfWorksheetRoles=new Set(['faculty','hicc','visc']);
const text=value=>String(value??'').trim().toLowerCase();

function createDoeRoutes({calculationService,rulebookService,worksheetService,workflowPreviewService,policyAdminService,targetService}={}){
  if(!calculationService?.calculateAssignment)throw new Error('calculationService.calculateAssignment is required.');
  return{
    async handle({method,path,actor,body={},query={}}={}){
      try{
        if(method==='POST'&&path==='/api/doe/preview-assignment'){
          const result=await calculationService.calculateAssignment({actor,academicYear:body.academicYear,facts:body.facts||{},persist:false});
          return{statusCode:200,body:result};
        }
        if(method==='POST'&&path==='/api/doe/session-changes/preview'){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot preview authoritative timetable DOE changes.',403);
          if(!workflowPreviewService?.previewSessionChange)throw new ApiError('WORKFLOW_PREVIEW_UNAVAILABLE','DOE workflow preview service is unavailable.',503);
          const result=await workflowPreviewService.previewSessionChange({actor,...(body||{})});
          return{statusCode:200,body:result};
        }
        if(method==='POST'&&path==='/api/doe/faculty-transfer/preview'){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot preview Faculty DOE transfers.',403);
          if(!workflowPreviewService?.previewFacultyTransfer)throw new ApiError('WORKFLOW_PREVIEW_UNAVAILABLE','DOE workflow preview service is unavailable.',503);
          const result=await workflowPreviewService.previewFacultyTransfer({actor,...(body||{})});
          return{statusCode:200,body:result};
        }
        if(method==='POST'&&path==='/api/doe/session-changes'){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot save authoritative timetable DOE changes.',403);
          if(!workflowPreviewService?.saveSessionChange)throw new ApiError('WORKFLOW_WRITE_UNAVAILABLE','DOE workflow save service is unavailable.',503);
          const result=await workflowPreviewService.saveSessionChange({actor,...(body||{})});
          return{statusCode:200,body:result};
        }
        const targetMatch=path.match(/^\/api\/doe\/faculty\/([^/]+)\/target$/);
        if(method==='PUT'&&targetMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot edit Faculty DOE targets.',403);
          if(!targetService?.saveFacultyTarget)throw new ApiError('TARGET_SERVICE_UNAVAILABLE','Faculty DOE target service is unavailable.',503);
          const result=await targetService.saveFacultyTarget({actor,facultyId:decodeURIComponent(targetMatch[1]),academicYear:body.academicYear,override:body.override??null});
          return{statusCode:200,body:result};
        }
        const worksheetMatch=path.match(/^\/api\/doe\/faculty\/([^/]+)\/worksheet$/);
        if(method==='GET'&&worksheetMatch){
          if(!worksheetService?.buildFacultyWorksheet)throw new ApiError('WORKSHEET_SERVICE_UNAVAILABLE','Faculty DOE Worksheet service is unavailable.',503);
          const requestedFacultyId=decodeURIComponent(worksheetMatch[1]),actorRole=text(actor?.role),actorFacultyId=String(actor?.facultyId||'').trim();
          const mayRead=adminRoles.has(actorRole)||(selfWorksheetRoles.has(actorRole)&&actorFacultyId&&actorFacultyId===requestedFacultyId);
          if(!mayRead)throw new ApiError('FORBIDDEN','This account cannot read another faculty member\'s DOE Worksheet.',403);
          const result=await worksheetService.buildFacultyWorksheet({facultyId:requestedFacultyId,academicYear:String(query.academicYear||'')});
          return{statusCode:200,body:result};
        }
        if(method==='GET'&&path==='/api/doe/list'){
          if(!worksheetService?.listFacultyDoe)throw new ApiError('WORKSHEET_SERVICE_UNAVAILABLE','Faculty DOE Worksheet service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read the Faculty DOE list.',403);
          const result=await worksheetService.listFacultyDoe({academicYear:String(query.academicYear||'')});
          return{statusCode:200,body:result};
        }
        const facultyRolesMatch=path.match(/^\/api\/doe\/faculty\/([^/]+)\/role-assignments$/);
        if(method==='GET'&&facultyRolesMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read DOE role assignments.',403);
          if(!calculationService?.listRoleAssignments)throw new ApiError('CALCULATION_SERVICE_UNAVAILABLE','DOE role assignment service is unavailable.',503);
          const result=await calculationService.listRoleAssignments({actor,facultyId:decodeURIComponent(facultyRolesMatch[1]),academicYear:String(query.academicYear||'')});
          return{statusCode:200,body:result};
        }
        const roleYearCopyMatch=path.match(/^\/api\/doe\/role-assignment-years\/([^/]+)\/copy-from\/([^/]+)$/);
        if(method==='POST'&&roleYearCopyMatch){
          if(!generalRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot copy annual DOE role assignments.',403);
          if(!calculationService?.copyRoleAssignmentsYear)throw new ApiError('CALCULATION_SERVICE_UNAVAILABLE','DOE role-assignment copy service is unavailable.',503);
          const result=await calculationService.copyRoleAssignmentsYear({actor,targetYear:decodeURIComponent(roleYearCopyMatch[1]),sourceYear:decodeURIComponent(roleYearCopyMatch[2])});
          return{statusCode:200,body:result};
        }
        const roleAssignmentMatch=path.match(/^\/api\/doe\/role-assignments\/([^/]+)$/);
        if(method==='DELETE'&&roleAssignmentMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot deactivate DOE role assignments.',403);
          if(!calculationService?.deactivateRoleAssignment)throw new ApiError('CALCULATION_SERVICE_UNAVAILABLE','DOE role assignment service is unavailable.',503);
          const result=await calculationService.deactivateRoleAssignment({actor,assignmentFactId:decodeURIComponent(roleAssignmentMatch[1])});
          return{statusCode:200,body:result};
        }
        if(method==='POST'&&path==='/api/doe/role-assignments'){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot save DOE role assignments.',403);
          if(!calculationService?.saveRoleAssignment)throw new ApiError('CALCULATION_SERVICE_UNAVAILABLE','DOE role assignment service is unavailable.',503);
          const result=await calculationService.saveRoleAssignment({actor,academicYear:body.academicYear,facultyId:body.facultyId,facts:body.facts||{}});
          return{statusCode:200,body:result};
        }
        if(method==='POST'&&path==='/api/doe/calculate'){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot persist authoritative DOE calculations.',403);
          const result=await calculationService.calculateAssignment({actor,academicYear:body.academicYear,facts:body.facts||{},persist:true});
          return{statusCode:200,body:result};
        }
        if(method==='GET'&&path==='/api/doe/policies'){
          if(!policyAdminService?.listPolicies)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read DOE policies.',403);
          return{statusCode:200,body:await policyAdminService.listPolicies({actor})};
        }
        const policyVersionsMatch=path.match(/^\/api\/doe\/policies\/([^/]+)\/versions$/);
        if(method==='GET'&&policyVersionsMatch){
          if(!policyAdminService?.listVersions)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read DOE policies.',403);
          return{statusCode:200,body:await policyAdminService.listVersions({actor,policyId:decodeURIComponent(policyVersionsMatch[1])})};
        }
        const policyBundleMatch=path.match(/^\/api\/doe\/policy-versions\/([^/]+)\/bundle$/);
        if(method==='GET'&&policyBundleMatch){
          if(!policyAdminService?.loadPolicyBundle)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read DOE policies.',403);
          return{statusCode:200,body:await policyAdminService.loadPolicyBundle({actor,policyVersionId:decodeURIComponent(policyBundleMatch[1])})};
        }
        const policyAuditMatch=path.match(/^\/api\/doe\/policy-versions\/([^/]+)\/audit$/);
        if(method==='GET'&&policyAuditMatch){
          if(!policyAdminService?.listAudit)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy audit history is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read DOE policy audit history.',403);
          return{statusCode:200,body:await policyAdminService.listAudit({actor,policyVersionId:decodeURIComponent(policyAuditMatch[1])})};
        }
        const impactReadMatch=path.match(/^\/api\/doe\/impact-runs\/([^/]+)$/);
        if(method==='GET'&&impactReadMatch){
          if(!policyAdminService?.getImpactPreview)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read DOE impact previews.',403);
          return{statusCode:200,body:await policyAdminService.getImpactPreview({actor,impactRunId:decodeURIComponent(impactReadMatch[1])})};
        }
        const saveRuleMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/rules\/([^/]+)$/);
        if(method==='PUT'&&saveRuleMatch){
          if(!policyAdminService?.saveRule)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot edit DOE Draft rules.',403);
          return{statusCode:200,body:await policyAdminService.saveRule({actor,policyVersionId:decodeURIComponent(saveRuleMatch[1]),rule:{...(body.rule||{}),ruleId:decodeURIComponent(saveRuleMatch[2])}})};
        }
        const saveExceptionMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/exceptions\/([^/]+)$/);
        if(method==='PUT'&&saveExceptionMatch){
          if(!policyAdminService?.saveException)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot edit DOE Draft exceptions.',403);
          return{statusCode:200,body:await policyAdminService.saveException({actor,policyVersionId:decodeURIComponent(saveExceptionMatch[1]),exception:{...(body.exception||{}),exceptionId:decodeURIComponent(saveExceptionMatch[2])}})};
        }
        const policyYearReadMatch=path.match(/^\/api\/doe\/policy-years\/([^/]+)$/);
        if(method==='GET'&&policyYearReadMatch){
          if(!policyAdminService?.getPolicyYear)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot read DOE policy years.',403);
          return{statusCode:200,body:await policyAdminService.getPolicyYear({actor,academicYear:decodeURIComponent(policyYearReadMatch[1])})};
        }
        if(method==='POST'&&path==='/api/doe/policy-years'){
          if(!policyAdminService?.createPolicyYear)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot create DOE policy years.',403);
          const result=await policyAdminService.createPolicyYear({actor,academicYear:body.academicYear});
          return{statusCode:200,body:result};
        }
        const clonePolicyMatch=path.match(/^\/api\/doe\/policy-versions\/([^/]+)\/clone$/);
        if(method==='POST'&&clonePolicyMatch){
          if(!policyAdminService?.cloneDraft)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot clone DOE policy drafts.',403);
          const result=await policyAdminService.cloneDraft({actor,policyVersionId:decodeURIComponent(clonePolicyMatch[1])});
          return{statusCode:200,body:result};
        }
        const testRuleMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/test-rule$/);
        if(method==='POST'&&testRuleMatch){
          if(!policyAdminService?.testRule)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot test DOE draft rules.',403);
          const result=await policyAdminService.testRule({actor,policyVersionId:decodeURIComponent(testRuleMatch[1]),rule:body.rule||{},sample:body.sample||{}});
          return{statusCode:200,body:result};
        }
        const impactMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/impact-preview$/);
        if(method==='POST'&&impactMatch){
          if(!policyAdminService?.runImpactPreview)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot preview DOE policy impact.',403);
          const result=await policyAdminService.runImpactPreview({actor,policyVersionId:decodeURIComponent(impactMatch[1])});
          return{statusCode:200,body:result};
        }
        const publishMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/publish$/);
        if(method==='POST'&&publishMatch){
          if(!policyAdminService?.publish)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!generalRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','Only ADFA General / Owner can publish DOE policies.',403);
          const result=await policyAdminService.publish({actor,policyVersionId:decodeURIComponent(publishMatch[1])});
          return{statusCode:200,body:result};
        }
        const archiveMatch=path.match(/^\/api\/doe\/policy-versions\/([^/]+)\/archive$/);
        if(method==='POST'&&archiveMatch){
          if(!policyAdminService?.archive)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!generalRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','Only ADFA General / Owner can archive DOE policies.',403);
          const result=await policyAdminService.archive({actor,policyVersionId:decodeURIComponent(archiveMatch[1])});
          return{statusCode:200,body:result};
        }
        if(method==='POST'&&path==='/api/doe/recalculate/preview'){
          if(!policyAdminService?.previewRecalculate)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!generalRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','Only ADFA General / Owner can preview DOE recalculation.',403);
          const result=await policyAdminService.previewRecalculate({actor,...(body||{})});
          return{statusCode:200,body:result};
        }
        if(method==='POST'&&path==='/api/doe/recalculate'){
          if(!policyAdminService?.runRecalculate)throw new ApiError('POLICY_ADMIN_UNAVAILABLE','DOE policy administration service is unavailable.',503);
          if(!generalRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','Only ADFA General / Owner can recalculate DOE.',403);
          const result=await policyAdminService.runRecalculate({actor,...(body||{})});
          return{statusCode:200,body:result};
        }
        const copyMatch=path.match(/^\/api\/doe\/policy-years\/([^/]+)\/copy-from\/([^/]+)$/);
        if(method==='POST'&&copyMatch){
          if(!rulebookService?.copyAcademicYear)throw new ApiError('RULEBOOK_SERVICE_UNAVAILABLE','DOE Rule Book service is unavailable.',503);
          if(!generalRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','Only ADFA General / Owner can start a new DOE policy year.',403);
          const targetYear=decodeURIComponent(copyMatch[1]),sourceYear=decodeURIComponent(copyMatch[2]);
          const result=await rulebookService.copyAcademicYear({sourceYear,targetYear,actor});
          return{statusCode:200,body:result};
        }
        const referenceMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/references\/([^/]+)$/);
        if(method==='PUT'&&referenceMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot edit DOE Draft References.',403);
          if(!rulebookService?.saveReference)throw new ApiError('RULEBOOK_SERVICE_UNAVAILABLE','DOE Rule Book service is unavailable.',503);
          const policyVersionId=decodeURIComponent(referenceMatch[1]),referenceId=decodeURIComponent(referenceMatch[2]);
          return{statusCode:200,body:await rulebookService.saveReference({actor,policyVersionId,reference:{...(body.reference||{}),referenceId}})};
        }
        const reservePolicyMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/reserve-policy$/);
        if(method==='PUT'&&reservePolicyMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot edit DOE Draft reserve policy.',403);
          if(!rulebookService?.saveReservePolicy)throw new ApiError('RULEBOOK_SERVICE_UNAVAILABLE','DOE Rule Book service is unavailable.',503);
          const policyVersionId=decodeURIComponent(reservePolicyMatch[1]);
          return{statusCode:200,body:await rulebookService.saveReservePolicy({actor,policyVersionId,reservePolicy:{...(body.reservePolicy||{})}})};
        }
        const courseMappingMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/course-mappings\/([^/]+)$/);
        if(method==='PUT'&&courseMappingMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot edit DOE Draft course mappings.',403);
          if(!rulebookService?.saveCourseMapping)throw new ApiError('RULEBOOK_SERVICE_UNAVAILABLE','DOE Rule Book service is unavailable.',503);
          const policyVersionId=decodeURIComponent(courseMappingMatch[1]),mappingId=decodeURIComponent(courseMappingMatch[2]);
          return{statusCode:200,body:await rulebookService.saveCourseMapping({actor,policyVersionId,mapping:{...(body.mapping||{}),mappingId}})};
        }
        const subjectMappingMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/subject-mappings\/([^/]+)$/);
        if(method==='PUT'&&subjectMappingMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot edit DOE Draft subject mappings.',403);
          if(!rulebookService?.saveSubjectMapping)throw new ApiError('RULEBOOK_SERVICE_UNAVAILABLE','DOE Rule Book service is unavailable.',503);
          const policyVersionId=decodeURIComponent(subjectMappingMatch[1]),mappingId=decodeURIComponent(subjectMappingMatch[2]);
          return{statusCode:200,body:await rulebookService.saveSubjectMapping({actor,policyVersionId,mapping:{...(body.mapping||{}),mappingId}})};
        }
        const validateMatch=path.match(/^\/api\/doe\/drafts\/([^/]+)\/validate$/);
        if(method==='POST'&&validateMatch){
          if(!adminRoles.has(text(actor?.role)))throw new ApiError('FORBIDDEN','This account cannot validate DOE policy drafts.',403);
          const policyVersionId=decodeURIComponent(validateMatch[1]);
          const result=policyAdminService?.validateDraft
            ?await policyAdminService.validateDraft({actor,policyVersionId})
            :rulebookService?.validateAnnualReview
              ?await rulebookService.validateAnnualReview(policyVersionId,undefined,{actor})
              :(()=>{throw new ApiError('RULEBOOK_SERVICE_UNAVAILABLE','DOE Rule Book service is unavailable.',503)})();
          return{statusCode:200,body:result};
        }
        return null;
      }catch(error){
        return{statusCode:statusFor(error),body:errorPayload(error)};
      }
    }
  };
}

module.exports={createDoeRoutes};
