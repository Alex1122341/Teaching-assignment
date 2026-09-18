(function(root,factory){
 const formula=typeof module==='object'&&module.exports?require('./doe-formula.js'):(root&&root.UCVM_DOE_FORMULA);
 const api=factory(formula);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_POLICY_ENGINE=api;
})(typeof window!=='undefined'?window:null,function(FORMULA){
 'use strict';
 if(!FORMULA)throw new Error('UCVM DOE formula engine is required.');

 const SELECTOR_OPERATORS=new Set(['equals','not_equals','in','not_in','gt','gte','lt','lte']);
 const CALCULATION_MODES=new Set([
  'fixed','per_hour','per_shift','per_week','per_trainee','tiered',
  'minimum','capped','percentage_of_target','prorated','formula'
 ]);

 class DoePolicyError extends Error{
  constructor(code,message,details={}){
   super(message);
   this.name='DoePolicyError';
   this.code=code;
   Object.assign(this,details);
  }
 }

 const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
 const text=value=>String(value??'').trim();
 const number=value=>{
  if(value===null||value===undefined||value==='')return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
 };
 const priority=value=>number(value)??0;
 const enabled=row=>row?.enabled!==false;

 function parameterMap(rule){
  const result={};
  for(const parameter of Array.isArray(rule?.parameters)?rule.parameters:[]){
   const name=text(parameter?.name);
   if(!name)continue;
   const numeric=number(parameter?.valueNumber);
   if(numeric!==null)result[name]=numeric;
   else if(parameter?.valueText!==undefined&&parameter?.valueText!==null)result[name]=parameter.valueText;
  }
  return result;
 }

 function inputNames(rule){
  return(Array.isArray(rule?.inputs)?rule.inputs:[])
   .map(input=>typeof input==='string'?text(input):text(input?.inputName))
   .filter(Boolean);
 }

 function selectorExpected(selector){
  if(Array.isArray(selector?.values))return selector.values;
  if(Array.isArray(selector?.valueText))return selector.valueText;
  if(Array.isArray(selector?.valueNumber))return selector.valueNumber;
  if(selector?.valueNumber!==undefined&&selector?.valueNumber!==null)return selector.valueNumber;
  return selector?.valueText;
 }

 function equalValue(actual,expected){
  if(typeof expected==='number')return Number(actual)===expected;
  return String(actual??'')===String(expected??'');
 }

 function selectorMatches(selector,context={}){
  const field=text(selector?.field);
  const operator=text(selector?.operator);
  if(!field||!SELECTOR_OPERATORS.has(operator))return false;
  const actual=context?.[field];
  const expected=selectorExpected(selector);
  if(operator==='equals')return equalValue(actual,expected);
  if(operator==='not_equals')return!equalValue(actual,expected);
  if(operator==='in'){
   const values=Array.isArray(expected)?expected:[expected];
   return values.some(value=>equalValue(actual,value));
  }
  if(operator==='not_in'){
   const values=Array.isArray(expected)?expected:[expected];
   return!values.some(value=>equalValue(actual,value));
  }
  const actualNumber=number(actual),expectedNumber=number(expected);
  if(actualNumber===null||expectedNumber===null)return false;
  if(operator==='gt')return actualNumber>expectedNumber;
  if(operator==='gte')return actualNumber>=expectedNumber;
  if(operator==='lt')return actualNumber<expectedNumber;
  if(operator==='lte')return actualNumber<=expectedNumber;
  return false;
 }

 function ruleMatches(rule,context={}){
  if(!enabled(rule))return false;
  const selectors=Array.isArray(rule?.selectors)?rule.selectors:[];
  return selectors.every(selector=>selectorMatches(selector,context));
 }

 function exceptionScopeValue(exception,context){
  const type=text(exception?.scopeType).toLowerCase();
  if(!type||type==='global')return'global';
  const mapping={
   faculty:'facultyId',
   session:'sessionId',
   assignment:'assignmentId',
   course:'course',
   role:'roleType',
   source_entity:'sourceEntityId'
  };
  const direct=mapping[type]||type;
  if(own(context,direct))return context[direct];
  const idField=`${type}Id`;
  return own(context,idField)?context[idField]:undefined;
 }

 function exceptionMatches(exception,context={}){
  if(!enabled(exception))return false;
  const facultyId=text(exception?.facultyId);
  if(facultyId&&text(context?.facultyId)!==facultyId)return false;
  const category=text(exception?.category);
  if(category&&text(context?.category)&&text(context.category)!==category)return false;
  const scopeType=text(exception?.scopeType);
  const scopeKey=text(exception?.scopeKey);
  if(scopeKey){
   const actual=exceptionScopeValue(exception,context);
   if(text(actual)!==scopeKey)return false;
  }else if(scopeType&&scopeType.toLowerCase()!=='global'){
   return false;
  }
  const date=text(context?.date).slice(0,10);
  const start=text(exception?.effectiveStart).slice(0,10);
  const end=text(exception?.effectiveEnd).slice(0,10);
  if(date&&start&&date<start)return false;
  if(date&&end&&date>end)return false;
  return true;
 }

 function policyError(code,message,details={}){
  return new DoePolicyError(code,message,details);
 }

 function requiredInput(context,name){
  if(!own(context,name)||context[name]===null||context[name]===undefined||context[name]===''){
   throw policyError('INPUT_MISSING',`Required DOE input "${name}" is missing.`,{inputName:name});
  }
  const value=Number(context[name]);
  if(!Number.isFinite(value)){
   throw policyError('INPUT_INVALID',`DOE input "${name}" must be finite.`,{inputName:name});
  }
  return value;
 }

 function requiredParameter(parameters,name){
  if(!own(parameters,name)){
   throw policyError('PARAMETER_MISSING',`Required DOE parameter "${name}" is missing.`,{parameterName:name});
  }
  const value=Number(parameters[name]);
  if(!Number.isFinite(value)){
   throw policyError('PARAMETER_INVALID',`DOE parameter "${name}" must be finite.`,{parameterName:name});
  }
  return value;
 }

 function calculateTiered(rule,context){
  const quantity=requiredInput(context,'quantity');
  if(quantity<0)throw policyError('INPUT_INVALID','Tier quantity cannot be negative.',{inputName:'quantity'});
  const tiers=(Array.isArray(rule?.tiers)?rule.tiers:[])
   .filter(Boolean)
   .slice()
   .sort((a,b)=>(number(a?.tierOrder)??0)-(number(b?.tierOrder)??0)||(number(a?.fromValue)??0)-(number(b?.fromValue)??0));
  if(!tiers.length)throw policyError('TIER_INVALID','Tiered DOE rule requires at least one tier.');
  let total=0;
  for(const tier of tiers){
   const from=number(tier?.fromValue)??0;
   const to=number(tier?.toValue);
   if(quantity<=from)continue;
   const upper=to===null?quantity:Math.min(quantity,to);
   const span=Math.max(0,upper-from);
   const fixed=number(tier?.fixedCredit);
   const rate=number(tier?.rate);
   if(fixed!==null)total+=fixed;
   else if(rate!==null)total+=span*rate;
   else throw policyError('TIER_INVALID','Tier must define rate or fixedCredit.',{tierId:text(tier?.tierId)});
  }
  return total;
 }

 function calculateRuleValue(rule,context,parameters){
  const mode=text(rule?.calculationMode).toLowerCase();
  if(!CALCULATION_MODES.has(mode)){
   throw policyError('CALCULATION_MODE_INVALID',`Unsupported DOE calculation mode "${mode}".`,{calculationMode:mode});
  }
  if(mode==='formula'){
   const source=text(rule?.formulaText);
   if(!source)throw policyError('FORMULA_PARSE_ERROR','Advanced Formula rule is missing formulaText.');
   const allowed=[...inputNames(rule),...Object.keys(parameters)];
   try{
    FORMULA.validate(source,{allowedIdentifiers:allowed});
    const scope={...parameters};
    for(const name of inputNames(rule))scope[name]=requiredInput(context,name);
    return FORMULA.evaluate(source,scope);
   }catch(error){
    if(error&&error.code)throw policyError(error.code,error.message,error);
    throw error;
   }
  }
  if(mode==='fixed')return requiredParameter(parameters,'fixed');
  if(mode==='per_hour')return requiredInput(context,'hours')*requiredParameter(parameters,'rate');
  if(mode==='per_shift')return requiredInput(context,'shifts')*requiredParameter(parameters,'rate');
  if(mode==='per_week')return requiredInput(context,'weeks')*requiredParameter(parameters,'rate');
  if(mode==='per_trainee')return requiredInput(context,'trainees')*requiredParameter(parameters,'rate');
  if(mode==='percentage_of_target')return requiredInput(context,'targetDoe')*requiredParameter(parameters,'rate');
  if(mode==='prorated')return requiredInput(context,'baseDoe')*requiredInput(context,'fte');
  if(mode==='capped')return Math.min(requiredInput(context,'baseValue'),requiredParameter(parameters,'cap'));
  if(mode==='minimum')return Math.max(requiredInput(context,'baseValue'),requiredParameter(parameters,'minimum'));
  if(mode==='tiered')return calculateTiered(rule,context);
  throw policyError('CALCULATION_MODE_INVALID',`Unsupported DOE calculation mode "${mode}".`,{calculationMode:mode});
 }

 function validateResult(value,resultKind){
  const numeric=Number(value);
  if(!Number.isFinite(numeric))throw policyError('OUTPUT_NON_FINITE','DOE result must be finite.');
  const kind=text(resultKind)||'credit';
  if((kind==='credit'||kind==='target')&&numeric<0){
   throw policyError('OUTPUT_OUT_OF_RANGE',`${kind} DOE cannot be negative.`,{resultKind:kind,value:numeric});
  }
  return numeric;
 }

 function chooseException(bundle,context,category){
  const matches=(Array.isArray(bundle?.exceptions)?bundle.exceptions:[])
   .filter(exception=>{
    if(category&&text(exception?.category)&&text(exception.category)!==category)return false;
    return exceptionMatches(exception,context);
   });
  if(!matches.length)return null;
  const top=Math.max(...matches.map(exception=>priority(exception?.priority)));
  const winners=matches.filter(exception=>priority(exception?.priority)===top);
  if(winners.length>1){
   throw policyError('EXCEPTION_AMBIGUOUS','Multiple DOE exceptions match at the same priority.',{
    exceptionIds:winners.map(row=>text(row?.exceptionId)).filter(Boolean)
   });
  }
  return winners[0];
 }

 function chooseRule(bundle,context,category){
  const matches=(Array.isArray(bundle?.rules)?bundle.rules:[])
   .filter(rule=>(!category||text(rule?.category)===category)&&ruleMatches(rule,context));
  if(!matches.length)throw policyError('RULE_NOT_FOUND','No DOE rule matches the supplied context.');
  const top=Math.max(...matches.map(rule=>priority(rule?.priority)));
  const winners=matches.filter(rule=>priority(rule?.priority)===top);
  if(winners.length>1){
   throw policyError('RULE_AMBIGUOUS','Multiple DOE rules match at the same priority.',{
    ruleIds:winners.map(rule=>text(rule?.ruleId)).filter(Boolean)
   });
  }
  return winners[0];
 }

 function exceptionResult(bundle,exception,context){
  const value=validateResult(exception?.fixedDoe,exception?.resultKind||'credit');
  return{
   ok:true,
   academicYear:text(bundle?.version?.academicYear||context?.academicYear),
   policyVersionId:text(bundle?.version?.policyVersionId),
   ruleId:null,
   ruleKey:'',
   exceptionId:text(exception?.exceptionId),
   source:'exception',
   inputs:{},
   parameters:{},
   ruleSnapshot:{
    type:'exception',
    fixedDoe:value,
    reason:text(exception?.reason),
    sourceReference:text(exception?.sourceReference),
    scopeType:text(exception?.scopeType),
    scopeKey:text(exception?.scopeKey)
   },
   resultDoe:value
  };
 }

 function calculateInternal(bundle,context={},category=''){
  const exception=chooseException(bundle,context,category);
  if(exception)return exceptionResult(bundle,exception,context);

  const rule=chooseRule(bundle,context,category);
  const required=(Array.isArray(rule?.inputs)?rule.inputs:[]).filter(input=>typeof input==='string'||input?.required!==false);
  const capturedInputs={};
  for(const item of required){
   const name=typeof item==='string'?text(item):text(item?.inputName);
   if(!name)continue;
   capturedInputs[name]=requiredInput(context,name);
  }
  for(const name of inputNames(rule)){
   if(own(capturedInputs,name))continue;
   if(own(context,name)&&context[name]!==''&&context[name]!==null&&context[name]!==undefined){
    const value=Number(context[name]);
    if(Number.isFinite(value))capturedInputs[name]=value;
   }
  }

  const parameters=parameterMap(rule);
  const raw=calculateRuleValue(rule,context,parameters);
  const resultDoe=validateResult(raw,rule?.resultKind);
  return{
   ok:true,
   academicYear:text(bundle?.version?.academicYear||context?.academicYear),
   policyVersionId:text(bundle?.version?.policyVersionId),
   ruleId:text(rule?.ruleId),
   ruleKey:text(rule?.ruleKey),
   exceptionId:null,
   source:'rule',
   inputs:capturedInputs,
   parameters:{...parameters},
   ruleSnapshot:{
    calculationMode:text(rule?.calculationMode),
    formulaText:text(rule?.formulaText),
    resultKind:text(rule?.resultKind)||'credit',
    priority:priority(rule?.priority)
   },
   resultDoe
  };
 }

 function calculate(bundle,context={}){
  return calculateInternal(bundle,context,'');
 }

 function calculateTarget(bundle,context={}){
  const targetBundle={
   ...bundle,
   rules:(Array.isArray(bundle?.rules)?bundle.rules:[]).filter(rule=>text(rule?.category)==='target'),
   exceptions:(Array.isArray(bundle?.exceptions)?bundle.exceptions:[]).filter(exception=>!text(exception?.category)||text(exception?.category)==='target')
  };
  return calculateInternal(targetBundle,{...context,category:'target'},'target');
 }

 function pushError(errors,code,message,details={}){
  errors.push({code,message,...details});
 }

 function selectorSignature(rule){
  const selectors=(Array.isArray(rule?.selectors)?rule.selectors:[]).map(selector=>({
   field:text(selector?.field),
   operator:text(selector?.operator),
   expected:selectorExpected(selector)
  }));
  selectors.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({priority:priority(rule?.priority),selectors});
 }

 function validateTiers(rule,errors){
  if(text(rule?.calculationMode)!=='tiered')return;
  const tiers=(Array.isArray(rule?.tiers)?rule.tiers:[]).slice().sort((a,b)=>(number(a?.fromValue)??0)-(number(b?.fromValue)??0));
  if(!tiers.length){
   pushError(errors,'TIER_INVALID','Tiered rule requires at least one tier.',{ruleId:text(rule?.ruleId)});
   return;
  }
  for(let index=0;index<tiers.length;index++){
   const tier=tiers[index],from=number(tier?.fromValue)??0,to=number(tier?.toValue);
   if(to!==null&&to<=from)pushError(errors,'TIER_INVALID','Tier upper bound must exceed lower bound.',{ruleId:text(rule?.ruleId),tierId:text(tier?.tierId)});
   if(number(tier?.rate)===null&&number(tier?.fixedCredit)===null)pushError(errors,'TIER_INVALID','Tier requires rate or fixedCredit.',{ruleId:text(rule?.ruleId),tierId:text(tier?.tierId)});
   if(index>0){
    const previous=tiers[index-1],previousTo=number(previous?.toValue);
    if(previousTo===null||from<previousTo)pushError(errors,'TIER_OVERLAP','DOE rule tiers overlap.',{ruleId:text(rule?.ruleId)});
    else if(from>previousTo)pushError(errors,'TIER_GAP','DOE rule tiers contain a gap.',{ruleId:text(rule?.ruleId)});
   }
  }
 }

 function validatePolicy(bundle={}){
  const errors=[],warnings=[];
  const rules=Array.isArray(bundle?.rules)?bundle.rules:[];
  const seenKeys=new Map();
  const seenSignatures=new Map();

  for(const rule of rules){
   const ruleId=text(rule?.ruleId),ruleKey=text(rule?.ruleKey);
   if(!ruleKey)pushError(errors,'RULE_KEY_REQUIRED','DOE rule requires ruleKey.',{ruleId});
   else if(seenKeys.has(ruleKey))pushError(errors,'DUPLICATE_RULE_KEY','DOE ruleKey must be unique.',{ruleKey,ruleIds:[seenKeys.get(ruleKey),ruleId]});
   else seenKeys.set(ruleKey,ruleId);

   if(!CALCULATION_MODES.has(text(rule?.calculationMode))){
    pushError(errors,'CALCULATION_MODE_INVALID','DOE calculation mode is invalid.',{ruleId,calculationMode:text(rule?.calculationMode)});
   }

   for(const selector of Array.isArray(rule?.selectors)?rule.selectors:[]){
    if(!text(selector?.field)||!SELECTOR_OPERATORS.has(text(selector?.operator))){
     pushError(errors,'SELECTOR_INVALID','DOE rule selector is invalid.',{ruleId});
    }
   }

   if(text(rule?.calculationMode)==='formula'){
    const allowed=[...inputNames(rule),...Object.keys(parameterMap(rule))];
    try{FORMULA.validate(text(rule?.formulaText),{allowedIdentifiers:allowed})}
    catch(error){pushError(errors,error?.code||'FORMULA_PARSE_ERROR',error?.message||'Formula is invalid.',{ruleId})}
   }

   validateTiers(rule,errors);

   if(enabled(rule)){
    const signature=selectorSignature(rule);
    if(seenSignatures.has(signature)){
     pushError(errors,'RULE_AMBIGUOUS','Enabled DOE rules have identical selectors and priority.',{
      ruleIds:[seenSignatures.get(signature),ruleId]
     });
    }else seenSignatures.set(signature,ruleId);
   }
  }

  for(const exception of Array.isArray(bundle?.exceptions)?bundle.exceptions:[]){
   const exceptionId=text(exception?.exceptionId);
   if(number(exception?.fixedDoe)===null||!text(exception?.reason)||!text(exception?.sourceReference)){
    pushError(errors,'EXCEPTION_INVALID','DOE exception requires fixed DOE, reason, and source reference.',{exceptionId});
   }
   if(text(exception?.scopeType)&&text(exception.scopeType).toLowerCase()!=='global'&&!text(exception?.scopeKey)){
    pushError(errors,'EXCEPTION_INVALID','Scoped DOE exception requires scopeKey.',{exceptionId});
   }
  }

  return{valid:errors.length===0,errors,warnings};
 }

 function isDoeRelevantChange(before={},after={},inputs=[]){
  const names=(Array.isArray(inputs)?inputs:[])
   .map(input=>typeof input==='string'?text(input):text(input?.inputName))
   .filter(Boolean);
  return names.some(name=>JSON.stringify(before?.[name]??null)!==JSON.stringify(after?.[name]??null));
 }

 return{
  DoePolicyError,
  SELECTOR_OPERATORS,
  CALCULATION_MODES,
  selectorMatches,
  ruleMatches,
  exceptionMatches,
  validatePolicy,
  calculate,
  calculateTarget,
  isDoeRelevantChange
 };
});
