(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.UCVM_DOE_FORMULA=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';

 const SAFE_FUNCTIONS=Object.freeze({
  min:Math.min,
  max:Math.max,
  round:Math.round,
  floor:Math.floor,
  ceil:Math.ceil,
  abs:Math.abs
 });

 class FormulaError extends Error{
  constructor(code,message,details={}){
   super(message);
   this.name='FormulaError';
   this.code=code;
   Object.assign(this,details);
  }
 }

 function parseError(message,position){
  return new FormulaError('FORMULA_PARSE_ERROR',message,{position});
 }

 function tokenize(source){
  const input=String(source??'');
  const tokens=[];
  let index=0;
  const numberPattern=/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/;
  const identifierPattern=/^[A-Za-z_][A-Za-z0-9_]*/;
  const operators=['<=','>=','==','!=','&&','||','+','-','*','/','<','>','?',';',':','(',')',',','!'];

  while(index<input.length){
   const rest=input.slice(index);
   const whitespace=rest.match(/^\s+/);
   if(whitespace){index+=whitespace[0].length;continue}

   const number=rest.match(numberPattern);
   if(number){
    const value=Number(number[0]);
    if(!Number.isFinite(value))throw parseError('Numeric literal must be finite.',index);
    tokens.push({type:'number',value,position:index});
    index+=number[0].length;
    continue;
   }

   const identifier=rest.match(identifierPattern);
   if(identifier){
    tokens.push({type:'identifier',value:identifier[0],position:index});
    index+=identifier[0].length;
    continue;
   }

   const operator=operators.find(candidate=>rest.startsWith(candidate));
   if(operator){
    if(operator===';')throw parseError('Unexpected token ;.',index);
    tokens.push({type:'operator',value:operator,position:index});
    index+=operator.length;
    continue;
   }

   throw parseError(`Unexpected token ${rest[0]}.`,index);
  }

  tokens.push({type:'eof',value:'',position:index});
  return tokens;
 }

 function parse(source){
  const input=String(source??'');
  if(!input.trim())throw parseError('Formula is empty.',0);
  const tokens=tokenize(input);
  let cursor=0;
  const current=()=>tokens[cursor];
  const take=()=>tokens[cursor++];
  const match=value=>current().value===value;
  const consume=value=>{
   if(!match(value))throw parseError(`Expected ${value}.`,current().position);
   return take();
  };

  function primary(){
   const token=current();
   if(token.type==='number'){
    take();
    return{type:'number',value:token.value};
   }
   if(token.type==='identifier'){
    take();
    const name=token.value;
    if(match('(')){
     take();
     const args=[];
     if(!match(')')){
      while(true){
       args.push(conditional());
       if(match(',')){take();continue}
       break;
      }
     }
     consume(')');
     return{type:'call',name,args};
    }
    return{type:'identifier',name};
   }
   if(match('(')){
    take();
    const expression=conditional();
    consume(')');
    return expression;
   }
   throw parseError('Expected a number, identifier, or parenthesized expression.',token.position);
  }

  function unary(){
   if(match('+')||match('-')||match('!')){
    const operator=take().value;
    return{type:'unary',operator,argument:unary()};
   }
   return primary();
  }

  function multiplicative(){
   let node=unary();
   while(match('*')||match('/')){
    const operator=take().value;
    node={type:'binary',operator,left:node,right:unary()};
   }
   return node;
  }

  function additive(){
   let node=multiplicative();
   while(match('+')||match('-')){
    const operator=take().value;
    node={type:'binary',operator,left:node,right:multiplicative()};
   }
   return node;
  }

  function comparison(){
   let node=additive();
   while(['<','<=','>','>='].includes(current().value)){
    const operator=take().value;
    node={type:'binary',operator,left:node,right:additive()};
   }
   return node;
  }

  function equality(){
   let node=comparison();
   while(match('==')||match('!=')){
    const operator=take().value;
    node={type:'binary',operator,left:node,right:comparison()};
   }
   return node;
  }

  function logicalAnd(){
   let node=equality();
   while(match('&&')){
    take();
    node={type:'binary',operator:'&&',left:node,right:equality()};
   }
   return node;
  }

  function logicalOr(){
   let node=logicalAnd();
   while(match('||')){
    take();
    node={type:'binary',operator:'||',left:node,right:logicalAnd()};
   }
   return node;
  }

  function conditional(){
   let node=logicalOr();
   if(match('?')){
    take();
    const consequent=conditional();
    consume(':');
    const alternate=conditional();
    node={type:'conditional',test:node,consequent,alternate};
   }
   return node;
  }

  const ast=conditional();
  if(current().type!=='eof')throw parseError(`Unexpected token ${current().value}.`,current().position);
  return ast;
 }

 function walk(ast,visitor){
  visitor(ast);
  if(ast.type==='binary'){walk(ast.left,visitor);walk(ast.right,visitor);return}
  if(ast.type==='unary'){walk(ast.argument,visitor);return}
  if(ast.type==='conditional'){walk(ast.test,visitor);walk(ast.consequent,visitor);walk(ast.alternate,visitor);return}
  if(ast.type==='call')ast.args.forEach(arg=>walk(arg,visitor));
 }

 function validate(sourceOrAst,{allowedIdentifiers=[]}={}){
  const ast=typeof sourceOrAst==='string'?parse(sourceOrAst):sourceOrAst;
  if(!ast||typeof ast!=='object')throw parseError('Formula AST is invalid.',0);
  const allowed=new Set((Array.isArray(allowedIdentifiers)?allowedIdentifiers:[]).map(String));
  walk(ast,node=>{
   if(node.type==='identifier'&&!allowed.has(node.name)){
    throw new FormulaError(
     'FORMULA_IDENTIFIER_NOT_ALLOWED',
     `Identifier "${node.name}" is not allowed.`,
     {identifier:node.name}
    );
   }
   if(node.type==='call'&&!Object.prototype.hasOwnProperty.call(SAFE_FUNCTIONS,node.name)){
    throw new FormulaError(
     'FORMULA_FUNCTION_NOT_ALLOWED',
     `Function "${node.name}" is not allowed.`,
     {functionName:node.name}
    );
   }
  });
  return ast;
 }

 function finiteResult(value){
  if(typeof value==='boolean')return value;
  if(!Number.isFinite(value))throw new FormulaError('OUTPUT_NON_FINITE','Formula output must be finite.');
  return value;
 }

 function evaluate(sourceOrAst,scope={}){
  const ast=typeof sourceOrAst==='string'?parse(sourceOrAst):sourceOrAst;
  if(!ast||typeof ast!=='object')throw parseError('Formula AST is invalid.',0);
  const values=scope&&typeof scope==='object'?scope:{};

  function run(node){
   switch(node.type){
    case'number':
     return node.value;
    case'identifier':{
     if(!Object.prototype.hasOwnProperty.call(values,node.name)){
      throw new FormulaError(
       'FORMULA_IDENTIFIER_MISSING',
       `Runtime value for "${node.name}" is missing.`,
       {identifier:node.name}
      );
     }
     const value=values[node.name];
     if(typeof value==='boolean')return value;
     if(!Number.isFinite(value)){
      throw new FormulaError(
       'FORMULA_VALUE_NON_FINITE',
       `Runtime value for "${node.name}" must be finite.`,
       {identifier:node.name}
      );
     }
     return value;
    }
    case'unary':{
     const value=run(node.argument);
     if(node.operator==='+')return finiteResult(+value);
     if(node.operator==='-')return finiteResult(-value);
     if(node.operator==='!')return!value;
     throw parseError(`Unsupported unary operator ${node.operator}.`,0);
    }
    case'binary':{
     if(node.operator==='&&')return Boolean(run(node.left))&&Boolean(run(node.right));
     if(node.operator==='||')return Boolean(run(node.left))||Boolean(run(node.right));
     const left=run(node.left),right=run(node.right);
     switch(node.operator){
      case'+':return finiteResult(left+right);
      case'-':return finiteResult(left-right);
      case'*':return finiteResult(left*right);
      case'/':
       if(right===0)throw new FormulaError('FORMULA_DIVIDE_BY_ZERO','Division by zero is not allowed.');
       return finiteResult(left/right);
      case'<':return left<right;
      case'<=':return left<=right;
      case'>':return left>right;
      case'>=':return left>=right;
      case'==':return left===right;
      case'!=':return left!==right;
      default:throw parseError(`Unsupported binary operator ${node.operator}.`,0);
     }
    }
    case'conditional':
     return run(node.test)?run(node.consequent):run(node.alternate);
    case'call':{
     const fn=SAFE_FUNCTIONS[node.name];
     if(!fn){
      throw new FormulaError(
       'FORMULA_FUNCTION_NOT_ALLOWED',
       `Function "${node.name}" is not allowed.`,
       {functionName:node.name}
      );
     }
     return finiteResult(fn(...node.args.map(run)));
    }
    default:
     throw parseError(`Unsupported AST node ${node.type}.`,0);
   }
  }

  return finiteResult(run(ast));
 }

 return{FormulaError,SAFE_FUNCTIONS,parse,validate,evaluate};
});
