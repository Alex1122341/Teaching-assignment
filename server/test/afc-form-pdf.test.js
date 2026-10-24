'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PDFDocument,PDFName,PDFString}=require('pdf-lib');
const file='../src/afc/afc-form-pdf';
async function pdf(pages=1,active=false){const d=await PDFDocument.create();for(let n=0;n<pages;n++)d.addPage();if(active)d.catalog.set(PDFName.of('OpenAction'),d.context.obj({S:PDFName.of('JavaScript'),JS:PDFString.of('app.alert(1)')}));return Buffer.from(await d.save());}
test('AFC form validator exists and preserves original PDF hash and page count',async()=>{
 const {validateAfcFormPdf}=require(file);const b=await pdf();const before=Buffer.from(b);const m=await validateAfcFormPdf(b);
 assert.equal(m.pageCount,1);assert.equal(m.byteLength,b.length);assert.match(m.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(b,before);
});
test('AFC form validator rejects malformed, oversized, active-action and excessive-page PDFs',async()=>{
 const {validateAfcFormPdf}=require(file);
 for(const b of [Buffer.from('%PDF-1.7\nnot a file'),Buffer.alloc(2097153),await pdf(1,true),await pdf(101)])await assert.rejects(validateAfcFormPdf(b),e=>e.code==='INVALID_PDF'||e.code==='PDF_LIMIT');
});
test('compressed PDF action objects are inspected structurally',async()=>{
 const {validateAfcFormPdf}=require(file),d=await PDFDocument.create();d.addPage();
 const action=d.context.register(d.context.obj({S:PDFName.of('Launch'),F:PDFString.of('malicious.exe')}));d.getPage(0).node.set(PDFName.of('AA'),action);
 await assert.rejects(validateAfcFormPdf(Buffer.from(await d.save({useObjectStreams:true}))),{code:'INVALID_PDF'});
});

function rawPdf(catalog='',extra=[]){
 const objects=['<< /Type /Catalog /Pages 2 0 R '+catalog+' >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',...extra];
 const chunks=[Buffer.from('%PDF-1.7\n')],offsets=[0];let length=chunks[0].length;
 objects.forEach((body,i)=>{offsets.push(length);const b=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),Buffer.isBuffer(body)?body:Buffer.from(body),Buffer.from('\nendobj\n')]);chunks.push(b);length+=b.length;});
 chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));return Buffer.concat(chunks);
}
test('PDF name escapes are normalized once including lowercase hex before action inspection',async()=>{
 const {validateAfcFormPdf}=require(file);
 for(const key of ['#4fpenAction','Open#41ction'])await assert.rejects(validateAfcFormPdf(rawPdf(`/${key} << /S /#4aavaScript /#4aS (alert) >>`)),{code:'INVALID_PDF'});
 for(const key of ['#4aS','J#53'])await assert.rejects(validateAfcFormPdf(rawPdf(`/Custom << /${key} (alert) >>`)),{code:'INVALID_PDF'});
 assert.equal((await validateAfcFormPdf(rawPdf('/#234aS (literal hash key)'))).pageCount,1);
});
test('PDF attachment references are rejected without optional EmbeddedFile marker',async()=>{
 const {validateAfcFormPdf}=require(file);
 for(const entry of ['/EF << /F 5 0 R >>','/RF << /F [5 0 R] >>','/Subtype /FileAttachment']){
  const bytes=rawPdf('/Custom 4 0 R',[`<< /Type /Filespec ${entry} >>`,'<< /Length 4 >>\nstream\ntest\nendstream']);
  await assert.rejects(validateAfcFormPdf(bytes),{code:'INVALID_PDF'});
 }
});
test('PDF object stream decoding is bounded per stream and across allocations',async()=>{
 const {validateAfcFormPdf}=require(file),{deflateSync}=require('node:zlib');
 function stream(size){const data=deflateSync(Buffer.alloc(size,32));return Buffer.concat([Buffer.from(`<< /Type /ObjStm /N 0 /First 0 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`),data,Buffer.from('\nendstream')]);}
 // Modest synthetic inputs: the former decoder expands these to at most 25MiB.
 for(const streams of [[stream(9*1024*1024)],Array.from({length:5},()=>stream(5*1024*1024))])await assert.rejects(validateAfcFormPdf(rawPdf('',streams)),{code:'INVALID_PDF'});
});
