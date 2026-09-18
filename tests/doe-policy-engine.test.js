'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ENGINE=require('../doe-policy-engine.js');

function lectureBundle(){
  return{
    version:{policyVersionId:'ucvm-workload-2027-28-v2',academicYear:'2027-28',status:'active'},
    rules:[{
      ruleId:'r-lecture',
      ruleKey:'teaching.lecture.standard',
      category:'teaching',
      name:'Standard Lecture',
      calculationMode:'per_hour',
      resultKind:'credit',
      priority:100,
      enabled:true,
      selectors:[{field:'activityType',operator:'equals',valueText:'LEC'}],
      inputs:[{inputName:'hours',required:true}],
      parameters:[{name:'rate',valueNumber:.30}]
    }],
    exceptions:[]
  };
}

test('calculates a matching per-hour DOE rule with provenance',()=>{
  const result=ENGINE.calculate(lectureBundle(),{
    academicYear:'2027-28',
    facultyId:'f1',
    sessionId:'s1',
    activityType:'LEC',
    hours:6
  });
  assert.ok(Math.abs(result.resultDoe-1.8)<1e-12);
  assert.equal(result.policyVersionId,'ucvm-workload-2027-28-v2');
  assert.equal(result.ruleId,'r-lecture');
  assert.equal(result.ruleKey,'teaching.lecture.standard');
  assert.equal(result.source,'rule');
  assert.deepEqual(result.inputs,{hours:6});
  assert.deepEqual(result.parameters,{rate:.30});
  assert.equal(result.ruleSnapshot.calculationMode,'per_hour');
});

test('exact enabled policy exception takes precedence over a generic rule',()=>{
  const bundle=lectureBundle();
  bundle.exceptions.push({
    exceptionId:'ex-1',
    facultyId:'f1',
    category:'teaching',
    scopeType:'session',
    scopeKey:'s1',
    fixedDoe:4.25,
    reason:'Existing prorated operational value',
    sourceReference:'2026-27 MASTER',
    enabled:true,
    priority:500
  });
  const result=ENGINE.calculate(bundle,{
    facultyId:'f1',
    sessionId:'s1',
    activityType:'LEC',
    hours:6
  });
  assert.equal(result.resultDoe,4.25);
  assert.equal(result.source,'exception');
  assert.equal(result.exceptionId,'ex-1');
  assert.equal(result.ruleId,null);
});

test('highest rule priority wins and equal top priority fails closed as ambiguous',()=>{
  const bundle=lectureBundle();
  bundle.rules.push({
    ...bundle.rules[0],
    ruleId:'r-special',
    ruleKey:'teaching.lecture.special',
    priority:200,
    parameters:[{name:'rate',valueNumber:.4}]
  });
  assert.ok(Math.abs(ENGINE.calculate(bundle,{activityType:'LEC',hours:2}).resultDoe-.8)<1e-12);

  bundle.rules.push({
    ...bundle.rules[1],
    ruleId:'r-special-2',
    ruleKey:'teaching.lecture.special-2'
  });
  assert.throws(
    ()=>ENGINE.calculate(bundle,{activityType:'LEC',hours:2}),
    error=>error&&error.code==='RULE_AMBIGUOUS'&&error.ruleIds.length===2
  );
});

test('missing input and missing rule fail closed rather than returning zero',()=>{
  assert.throws(
    ()=>ENGINE.calculate(lectureBundle(),{activityType:'LEC'}),
    error=>error&&error.code==='INPUT_MISSING'&&error.inputName==='hours'
  );
  assert.throws(
    ()=>ENGINE.calculate(lectureBundle(),{activityType:'LAB',hours:2}),
    error=>error&&error.code==='RULE_NOT_FOUND'
  );
});

test('selector operators are deterministic',()=>{
  const base=lectureBundle().rules[0];
  const cases=[
    ['equals','LEC',true],
    ['not_equals','LAB',true],
    ['in',['LEC','SRL'],true],
    ['not_in',['LAB','SRL'],true],
    ['gt',3,true],
    ['gte',4,true],
    ['lt',5,true],
    ['lte',4,true]
  ];
  for(const [operator,value,expected] of cases){
    const selector={field:operator.startsWith('g')||operator.startsWith('l')?'hours':'activityType',operator};
    if(Array.isArray(value))selector.values=value;
    else if(typeof value==='number')selector.valueNumber=value;
    else selector.valueText=value;
    assert.equal(ENGINE.selectorMatches(selector,{activityType:'LEC',hours:4}),expected,operator);
  }
});

test('structured calculation modes share one result contract',()=>{
  const calculate=(mode,context,parameters=[],tiers=[])=>{
    const bundle={
      version:{policyVersionId:'v1',academicYear:'2027-28',status:'draft'},
      rules:[{
        ruleId:'r',ruleKey:'r',category:'teaching',calculationMode:mode,resultKind:'credit',
        priority:1,enabled:true,selectors:[],
        inputs:Object.keys(context).map(inputName=>({inputName,required:true})),
        parameters,tiers
      }],
      exceptions:[]
    };
    return ENGINE.calculate(bundle,context).resultDoe;
  };
  assert.equal(calculate('fixed',{},[{name:'fixed',valueNumber:2.5}]),2.5);
  assert.equal(calculate('per_shift',{shifts:3},[{name:'rate',valueNumber:.5}]),1.5);
  assert.equal(calculate('per_week',{weeks:4},[{name:'rate',valueNumber:.75}]),3);
  assert.ok(Math.abs(calculate('per_trainee',{trainees:3},[{name:'rate',valueNumber:.4}])-1.2)<1e-12);
  assert.equal(calculate('percentage_of_target',{targetDoe:20},[{name:'rate',valueNumber:.1}]),2);
  assert.equal(calculate('prorated',{baseDoe:8,fte:.5}),4);
  assert.equal(calculate('capped',{baseValue:8},[{name:'cap',valueNumber:5}]),5);
  assert.equal(calculate('minimum',{baseValue:2},[{name:'minimum',valueNumber:4}]),4);
  assert.equal(
    calculate('tiered',{quantity:5},[],[
      {tierId:'t1',tierOrder:1,fromValue:0,toValue:2,rate:.5},
      {tierId:'t2',tierOrder:2,fromValue:2,toValue:null,rate:.25}
    ]),
    1.75
  );
});

test('advanced formula uses only declared inputs and parameters',()=>{
  const bundle={
    version:{policyVersionId:'v-formula',academicYear:'2027-28',status:'draft'},
    rules:[{
      ruleId:'formula',ruleKey:'supervision.resident.standard',category:'supervision',
      calculationMode:'formula',formulaText:'min(trainees * rate, cap)',
      resultKind:'credit',priority:1,enabled:true,selectors:[],
      inputs:[{inputName:'trainees',required:true}],
      parameters:[{name:'rate',valueNumber:.5},{name:'cap',valueNumber:4}]
    }],
    exceptions:[]
  };
  assert.equal(ENGINE.calculate(bundle,{trainees:12}).resultDoe,4);
  bundle.rules[0].formulaText='min(trainees * hiddenRate, cap)';
  const validation=ENGINE.validatePolicy(bundle);
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.some(error=>error.code==='FORMULA_IDENTIFIER_NOT_ALLOWED'));
});

test('credit results cannot be negative while adjustment results may be signed',()=>{
  const make=resultKind=>({
    version:{policyVersionId:'v1',academicYear:'2027-28',status:'draft'},
    rules:[{
      ruleId:'r',ruleKey:'r',category:'adjustment',calculationMode:'fixed',
      resultKind,priority:1,enabled:true,selectors:[],inputs:[],
      parameters:[{name:'fixed',valueNumber:-2}]
    }],
    exceptions:[]
  });
  assert.throws(
    ()=>ENGINE.calculate(make('credit'),{}),
    error=>error&&error.code==='OUTPUT_OUT_OF_RANGE'
  );
  assert.equal(ENGINE.calculate(make('adjustment'),{}).resultDoe,-2);
});

test('calculateTarget restricts matching to target rules',()=>{
  const bundle={
    version:{policyVersionId:'target-v1',academicYear:'2027-28',status:'active'},
    rules:[
      {
        ruleId:'earned',ruleKey:'teaching.any',category:'teaching',calculationMode:'fixed',
        resultKind:'credit',priority:100,enabled:true,selectors:[],inputs:[],
        parameters:[{name:'fixed',valueNumber:99}]
      },
      {
        ruleId:'target',ruleKey:'target.contract',category:'target',calculationMode:'prorated',
        resultKind:'target',priority:100,enabled:true,selectors:[],
        inputs:[{inputName:'baseDoe',required:true},{inputName:'fte',required:true}],
        parameters:[]
      }
    ],
    exceptions:[]
  };
  const result=ENGINE.calculateTarget(bundle,{baseDoe:40,fte:.75});
  assert.equal(result.resultDoe,30);
  assert.equal(result.ruleKey,'target.contract');
});

test('validatePolicy reports duplicate keys, malformed exceptions, and overlapping tiers',()=>{
  const bundle=lectureBundle();
  bundle.version.status='draft';
  bundle.rules.push({...bundle.rules[0],ruleId:'r2'});
  bundle.rules.push({
    ruleId:'tiered',ruleKey:'tiered',category:'supervision',calculationMode:'tiered',
    resultKind:'credit',priority:50,enabled:true,selectors:[],
    inputs:[{inputName:'quantity',required:true}],parameters:[],
    tiers:[
      {tierId:'a',tierOrder:1,fromValue:0,toValue:3,rate:.5},
      {tierId:'b',tierOrder:2,fromValue:2,toValue:5,rate:.25}
    ]
  });
  bundle.exceptions.push({
    exceptionId:'bad',facultyId:'f1',fixedDoe:2,reason:'',sourceReference:'',enabled:true
  });
  const validation=ENGINE.validatePolicy(bundle);
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.some(error=>error.code==='DUPLICATE_RULE_KEY'));
  assert.ok(validation.errors.some(error=>error.code==='TIER_OVERLAP'));
  assert.ok(validation.errors.some(error=>error.code==='EXCEPTION_INVALID'));
});

test('declared rule inputs determine whether an edit is DOE relevant',()=>{
  assert.equal(
    ENGINE.isDoeRelevantChange({hours:2,room:'A'},{hours:2,room:'B'},['hours']),
    false
  );
  assert.equal(
    ENGINE.isDoeRelevantChange({hours:2,room:'A'},{hours:3,room:'A'},['hours']),
    true
  );
  assert.equal(
    ENGINE.isDoeRelevantChange({trainees:2},{trainees:3},[{inputName:'trainees'}]),
    true
  );
});
