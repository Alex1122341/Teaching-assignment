'use strict';

// These patches run only inside the disposable PDF inspection worker. pdf-lib
// 1.17.1 has no decoder allocation limit and only decodes uppercase name escapes.
// Keep the dependency pinned; fail closed if its internal guard seam changes.
function installPdfGuards(){
 const {isMainThread}=require('node:worker_threads');
 const {PDFName}=require('pdf-lib');
 const DecodeStream=require('pdf-lib/cjs/core/streams/DecodeStream').default;
 if(isMainThread||require('pdf-lib/package.json').version!=='1.17.1'||typeof DecodeStream?.prototype?.ensureBuffer!=='function'||typeof PDFName.of!=='function')throw Error('Unsupported PDF guard runtime');
 const nameOf=PDFName.of,ensureBuffer=DecodeStream.prototype.ensureBuffer;
 PDFName.of=function(name){return nameOf(name.replace(/#[0-9a-f]{2}/gi,token=>token.toUpperCase()));};
 const streamLimit=8*1024*1024,totalLimit=32*1024*1024;let allocated=0;
 DecodeStream.prototype.ensureBuffer=function(requested){
  if(!Number.isSafeInteger(requested)||requested<0||requested>streamLimit||!(this.buffer instanceof Uint8Array))throw Error('PDF decode limit');
  if(requested<=this.buffer.byteLength)return this.buffer;
  let capacity=this.minBufferLength;
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>streamLimit)throw Error('PDF decode limit');
  while(capacity<requested)capacity*=2;
  if(capacity>streamLimit||allocated+capacity>totalLimit)throw Error('PDF decode limit');
  // Count every new allocation, including superseded buffers that GC may retain.
  // Check before entering the library; V8 heap limits do not cover ArrayBuffers.
  allocated+=capacity;
  const result=ensureBuffer.call(this,requested);
  if(result.byteLength!==capacity)throw Error('Unsupported PDF decoder allocation');
  return result;
 };
}
module.exports={installPdfGuards};
