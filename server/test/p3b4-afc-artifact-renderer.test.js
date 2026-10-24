'use strict';

const { repositoryPath } = require('../../tools/build/frontend-paths');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const zlib = require('node:zlib');
const { PDFDocument } = require('pdf-lib');
const {
  renderApprovedAfcArtifact,
  mapAfcSourceToPdfFields,
  verifyTemplateBytes,
  assertPdfSize,
  MAX_PDF_BYTES,
  TEMPLATE_SHA256_HEX,
  RENDERER_VERSION,
} = require('../src/afc/afc-approved-artifact-renderer');

const TEMPLATE_PATH = repositoryPath(__dirname, '..', 'src', 'afc', 'assets', 'absence-from-campus-app.pdf');
const JPEG_1X1 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooA//2Q==';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const nameBytes = Buffer.from(name, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([nameBytes, data])));
  return Buffer.concat([length, nameBytes, data, checksum]);
}

function onePixelPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const pixels = zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', pixels),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function imageUrl(mime, bytes) {
  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}

function approvedSource(overrides = {}) {
  const png = onePixelPng();
  const jpeg = Buffer.from(JPEG_1X1, 'base64');
  return {
    afcRequestId: '22222222-2222-4222-8222-222222222222',
    facultyId: '11111111-1111-4111-8111-111111111111',
    facultyName: 'Jane Doe',
    employeeId: 'UCID-1001',
    preferredFirstName: 'Jane',
    preferredLastName: 'Doe',
    rank: 'Assistant Professor',
    requesterFirebaseUid: 'uid-applicant',
    requesterEmail: 'jane.doe@example.edu',
    reportsToFacultyId: '44444444-4444-4444-8444-444444444444',
    reportToFirebaseUid: 'uid-report-to',
    startDate: '2026-11-02',
    endDate: '2026-11-03',
    workDays: 2,
    reason: 'vacation',
    purposeDestination: null,
    coverage: null,
    contactAddress: '2500 University Drive NW',
    contactPhone: '403-555-0100',
    teachingSessions: null,
    applicantSignatureMode: 'typed',
    applicantSignatureName: 'Jane Doe',
    applicantSignatureUid: 'uid-applicant',
    applicantSignatureSignedAtUtc: '2026-10-04T12:00:00.000Z',
    applicantSignatureFingerprint: 'a'.repeat(64),
    applicantSignatureImageDataUrl: null,
    approvedAtUtc: '2026-10-04T13:00:00.000Z',
    approvals: [
      {
        stage: 'report_to', approverFirebaseUid: 'uid-report-to', signatureMode: 'drawn',
        signatureName: 'Report To Example', signatureSignedAtUtc: '2026-10-04T12:30:00.000Z',
        signatureFingerprint: 'b'.repeat(64), signatureImageDataUrl: imageUrl('png', png),
      },
      {
        stage: 'admin', approverFirebaseUid: 'uid-admin', signatureMode: 'uploaded',
        signatureName: 'Admin Example', signatureSignedAtUtc: '2026-10-04T13:00:00.000Z',
        signatureFingerprint: 'c'.repeat(64), signatureImageDataUrl: imageUrl('jpeg', jpeg),
      },
    ],
    ...overrides,
  };
}

function imageObjectCount(bytes) {
  return (Buffer.from(bytes).toString('latin1').match(/\/Subtype\s*\/Image\b/g) || []).length;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

test('reviewed AFC template is present in the server bundle source with the approved SHA-256', () => {
  const template = fs.readFileSync(TEMPLATE_PATH);
  const actualHash = crypto.createHash('sha256').update(template).digest('hex').toUpperCase();

  assert.equal(actualHash, TEMPLATE_SHA256_HEX);
});

test('SQL-authoritative fields map to the reviewed form without inferred identity or missing appointment data', () => {
  const values = mapAfcSourceToPdfFields(approvedSource());
  assert.equal(values.fields['Employee ID'], 'UCID-1001');
  assert.equal(values.fields['First Name'], 'Jane');
  assert.equal(values.fields['Last Name'], 'Doe');
  assert.equal(values.fields['Number of Work Days'], '2');
  assert.equal(values.fields['Start Date'], '2026-11-02');
  assert.equal(values.fields['End Date'], '2026-11-03');
  assert.equal(values.fields.Rank, 'Assistant Professor - AC0003');
  assert.equal(values.fields['Primary Department'], '30060 - Faculty of Veterinary Medicine');
  assert.equal(values.fields['Appt Type'], ' ');
  assert.equal(values.fields['Expiry Date'], '');
  assert.equal(values.fields['Staff Member Name'], 'Doe, Jane');
  assert.equal(values.fields.Name, 'Example, Report To');
  assert.equal(values.fields.Name_2, 'Example, Admin');
  assert.equal(values.fields['Please provide details of arrangements to cover absenceRow1'], 'No teaching assignments during this period.');
  assert.equal(values.signatures.applicant.displayName, 'Jane Doe');
  assert.equal(values.signatures.reportTo.imageDataUrl.startsWith('data:image/png;base64,'), true);
  assert.equal(values.signatures.admin.imageDataUrl.startsWith('data:image/jpeg;base64,'), true);
});

test('missing optional reports-to data remains blank and absence of teaching derives the approved no-teaching message', () => {
  const source = approvedSource({
    reportsToFacultyId: null,
    reportToFirebaseUid: null,
    preferredFirstName: null,
    preferredLastName: null,
    employeeId: null,
    rank: null,
    approvals: [approvedSource().approvals[1]],
  });
  const values = mapAfcSourceToPdfFields(source);
  assert.equal(values.fields['Employee ID'], '');
  assert.equal(values.fields['First Name'], '');
  assert.equal(values.fields['Last Name'], '');
  assert.equal(values.fields.Rank, ' ');
  assert.equal(values.fields.Name, '');
  assert.equal(values.fields.Date_2, '');
  assert.equal(values.signatures.reportTo, null);
  assert.equal(values.fields['Expiry Date'], '');
});

test('renderer returns exact PDF bytes, hash, length, flattened form, and embedded PNG/JPEG signatures deterministically', async () => {
  const sourceJson = JSON.stringify(approvedSource());
  const template = fs.readFileSync(TEMPLATE_PATH);
  const expectedImages = imageObjectCount(template) + 2;
  const first = await renderApprovedAfcArtifact(sourceJson);
  const second = await renderApprovedAfcArtifact(sourceJson);

  assert.equal(first.rendererVersion, RENDERER_VERSION);
  assert.equal(first.templateSha256.toString('hex').toUpperCase(), TEMPLATE_SHA256_HEX);
  assert.equal(first.byteLength, first.pdfBytes.length);
  assert.equal(first.byteLength, 1_088_141);
  assert.equal(first.byteLength <= MAX_PDF_BYTES, true);
  assert.deepEqual(first.pdfSha256, sha256(first.pdfBytes));
  assert.equal(first.pdfSha256.toString('hex').toUpperCase(), '0B762577584911DE65486E2FA19757CEFF4FC7946AA3D57BA3DC199F1494A165');
  assert.deepEqual(first.pdfBytes, second.pdfBytes);
  assert.equal(first.pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(imageObjectCount(first.pdfBytes) >= expectedImages, true);

  const pdf = await PDFDocument.load(first.pdfBytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getForm().getFields().length, 0);
});

test('SQL datetime2 approval timestamps render identically across machine time zones', async () => {
  const utcSource = JSON.stringify(approvedSource({ approvedAtUtc: '2026-10-04T13:00:00.000Z' }));
  const sqlDatetime2Source = JSON.stringify(approvedSource({ approvedAtUtc: '2026-10-04T13:00:00.000' }));
  const withExplicitZone = await renderApprovedAfcArtifact(utcSource);
  const sqlDatetime2 = await renderApprovedAfcArtifact(sqlDatetime2Source);
  assert.equal(sqlDatetime2.pdfBytes.equals(withExplicitZone.pdfBytes), true);
});

test('malformed or mismatched signature image data is rejected without returning PDF bytes', async () => {
  const source = approvedSource();
  source.approvals[0].signatureImageDataUrl = 'data:image/png;base64,not-a-png';
  await assert.rejects(
    renderApprovedAfcArtifact(JSON.stringify(source)),
    error => error.code === 'ARTIFACT_SOURCE_INVALID' && !('pdfBytes' in error) && !/not-a-png|Report To Example/i.test(error.message),
  );

  assert.throws(
    () => verifyTemplateBytes(Buffer.from('not the approved template')),
    error => error.code === 'ARTIFACT_TEMPLATE_MISMATCH',
  );
});

test('PDF size guard accepts exactly 8 MiB and rejects any byte above the common limit', () => {
  assert.equal(assertPdfSize(Buffer.alloc(MAX_PDF_BYTES)), MAX_PDF_BYTES);
  assert.throws(
    () => assertPdfSize(Buffer.alloc(MAX_PDF_BYTES + 1)),
    error => error.code === 'ARTIFACT_TOO_LARGE',
  );
});

test('renderer has no remote loading dependency', () => {
  const rendererSource = fs.readFileSync(repositoryPath(__dirname, '..', 'src', 'afc', 'afc-approved-artifact-renderer.js'), 'utf8');
  assert.doesNotMatch(rendererSource, /\bfetch\s*\(|https?:\/\//i);
});
