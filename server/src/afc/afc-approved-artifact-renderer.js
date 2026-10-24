'use strict';
const names = require('../domain/person-name');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  PDFDocument,
  StandardFonts,
  rgb,
} = require('pdf-lib');

const MAX_PDF_BYTES = 8_388_608;
const MAX_SIGNATURE_DATA_URL_CHARS = 1_000_000;
const RENDERER_VERSION = '1.1.0';
const TEMPLATE_SHA256_HEX = '481677829217736B15CB3CBB010F49CB553A8664FE53F8604782093E99896547';
const TEMPLATE_SHA256 = Buffer.from(TEMPLATE_SHA256_HEX, 'hex');
const TEMPLATE_PATH = path.join(__dirname, 'assets', 'absence-from-campus-app.pdf');
const PRIMARY_DEPARTMENT = '30060 - Faculty of Veterinary Medicine';
const RANK_OPTIONS = new Map([
  ['assistant professor', 'Assistant Professor - AC0003'],
  ['assistant professor (teaching)', 'Assistant Professor (Teaching) - AC0004'],
  ['associate professor', 'Associate Professor - AC0002'],
  ['associate professor (teaching)', 'Associate Professor (Teaching) - AC0007'],
  ['professor', 'Professor - AC0001'],
  ['professor (teaching)', 'Professor (Teaching) - AC0008'],
]);
const SIGNATURE_FIELDS = [
  ['Signature', 'applicant'],
  ['Signature_2', 'reportTo'],
  ['Signature_3', 'admin'],
  ['Signature_4', null],
];

class AfcArtifactRendererError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AfcArtifactRendererError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new AfcArtifactRendererError(status, code, message);
}

function text(value, field, maxLength, { required = false } = {}) {
  if (value == null) {
    if (required) fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is incomplete.');
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  const result = String(value).trim();
  if ((required && !result) || result.length > maxLength) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  return result;
}

function dateOnly(value, { required = false } = {}) {
  const raw = text(value, 'date', 64, { required });
  if (!raw) return '';
  const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(raw);
  if (!match || Number.isNaN(Date.parse(match[1] + 'T00:00:00.000Z'))) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  return match[1];
}

function utcInstant(value) {
  const raw = text(value, 'approval timestamp', 64, { required: true });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})?$/i.test(raw)) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const instant = new Date(hasZone ? raw : `${raw}Z`);
  if (Number.isNaN(instant.getTime())) fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  return instant;
}

function decodeSignatureImage(dataUrl, mode) {
  const value = text(dataUrl, 'signature image', MAX_SIGNATURE_DATA_URL_CHARS);
  if (!value) {
    if (mode === 'typed') return null;
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'An approved image signature is missing or invalid.');
  }
  if (mode === 'typed') fail(422, 'ARTIFACT_SOURCE_INVALID', 'A typed signature cannot contain image data.');

  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) fail(422, 'ARTIFACT_SOURCE_INVALID', 'An approved image signature is malformed.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2]) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'An approved image signature is malformed.');
  }
  const mime = match[1].toLowerCase();
  const isPng = mime === 'png'
    && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = mime === 'jpeg'
    && bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) fail(422, 'ARTIFACT_SOURCE_INVALID', 'An approved image signature is malformed.');
  return { mime, bytes };
}

function mapSignature({ mode, name, uid, signedAtUtc, fingerprint, imageDataUrl }, { expectedUid } = {}) {
  const normalizedMode = text(mode, 'signature mode', 32, { required: true }).toLowerCase();
  const signerName = text(name, 'signature name', 260, { required: true });
  const signerUid = text(uid, 'signature UID', 128, { required: true });
  const date = dateOnly(signedAtUtc, { required: true });
  const signatureFingerprint = text(fingerprint, 'signature fingerprint', 64, { required: true });
  if (!['typed', 'drawn', 'uploaded'].includes(normalizedMode)
      || !/^[0-9a-f]{64}$/i.test(signatureFingerprint)
      || (expectedUid && signerUid !== expectedUid)) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC signature evidence is invalid.');
  }
  const decodedImage = decodeSignatureImage(imageDataUrl, normalizedMode);
  return {
    mode: normalizedMode,
    displayName: signerName,
    uid: signerUid,
    date,
    fingerprint: signatureFingerprint.toLowerCase(),
    imageDataUrl: decodedImage ? imageDataUrl : null,
    image: decodedImage,
  };
}

function rankOption(value) {
  const normalized = text(value, 'faculty rank', 128).replace(/[‐‑‒–—]/g, '-');
  if (!normalized) return ' ';
  if ([...RANK_OPTIONS.values()].includes(normalized)) return normalized;
  return RANK_OPTIONS.get(normalized.toLowerCase()) || ' ';
}

function mapAfcSourceToPdfFields(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }

  const requestId = text(source.afcRequestId, 'request identifier', 36, { required: true });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  const facultyName = text(source.facultyName, 'faculty name', 520, { required: true });
  const requesterUid = text(source.requesterFirebaseUid, 'requester UID', 128, { required: true });
  const approvedDate = dateOnly(source.approvedAtUtc, { required: true });
  const startDate = dateOnly(source.startDate, { required: true });
  const endDate = dateOnly(source.endDate, { required: true });
  const workDays = Number(source.workDays);
  if (!Number.isInteger(workDays) || workDays < 1 || workDays > 267 || endDate < startDate) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }

  const reason = text(source.reason, 'reason', 32, { required: true });
  if (!['vacation', 'business_other'].includes(reason)) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  const purpose = text(source.purposeDestination, 'purpose and destination', 1000);
  if (reason === 'business_other' && !purpose) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  const contactAddress = text(source.contactAddress, 'contact address', 500, { required: true });
  const contactPhone = text(source.contactPhone, 'contact phone', 50, { required: true });
  const coverage = text(source.coverage, 'coverage arrangements', 2000);
  const teachingSessions = source.teachingSessions == null ? [] : source.teachingSessions;
  if (!Array.isArray(teachingSessions)) fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  if (!coverage && teachingSessions.length > 0) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is incomplete.');
  }

  const applicant = mapSignature({
    mode: source.applicantSignatureMode,
    name: source.applicantSignatureName,
    uid: source.applicantSignatureUid,
    signedAtUtc: source.applicantSignatureSignedAtUtc,
    fingerprint: source.applicantSignatureFingerprint,
    imageDataUrl: source.applicantSignatureImageDataUrl,
  }, { expectedUid: requesterUid });

  if (!Array.isArray(source.approvals)) fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  const approvals = new Map();
  for (const approval of source.approvals) {
    if (!approval || !['report_to', 'admin'].includes(approval.stage) || approvals.has(approval.stage)) {
      fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC approval evidence is invalid.');
    }
    approvals.set(approval.stage, mapSignature({
      mode: approval.signatureMode,
      name: approval.signatureName,
      uid: approval.approverFirebaseUid,
      signedAtUtc: approval.signatureSignedAtUtc,
      fingerprint: approval.signatureFingerprint,
      imageDataUrl: approval.signatureImageDataUrl,
    }));
  }
  const admin = approvals.get('admin');
  const reportTo = approvals.get('report_to') || null;
  if (!admin || (source.reportToFirebaseUid && !reportTo)) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Required final AFC approval evidence is missing.');
  }

  const selectedRank = rankOption(source.rank);
  return {
    afcRequestId: requestId,
    approvedDate,
    fields: {
      'Employee ID': text(source.employeeId, 'employee identifier', 64),
      'First Name': text(source.preferredFirstName, 'preferred first name', 128),
      'Last Name': text(source.preferredLastName, 'preferred last name', 128),
      'Number of Work Days': String(workDays),
      'Please provide the purpose and destination business onlyRow1': reason === 'business_other' ? purpose : '',
      'Please provide details of arrangements to cover absenceRow1': coverage || 'No teaching assignments during this period.',
      AddressRow1: contactAddress,
      PhoneRow1: contactPhone,
      AddressRow2: '',
      PhoneRow2: '',
      'Staff Member Name': names.format({firstName:source.preferredFirstName,lastName:source.preferredLastName,displayName:facultyName}),
      Date: applicant.date,
      Name: reportTo ? names.format(reportTo.displayName) : '',
      Date_2: reportTo ? reportTo.date : '',
      Name_2: names.format(admin.displayName),
      Date_3: admin.date,
      Date_4: '',
      'Appt Type': ' ',
      'Expiry Date': '',
      Rank: selectedRank,
      'Primary Department': PRIMARY_DEPARTMENT,
      'Start Date': startDate,
      'End Date': endDate,
    },
    checkboxes: {
      'Select reason': reason === 'vacation',
      Vacation: reason === 'business_other',
    },
    signatures: { applicant, reportTo, admin },
  };
}

function verifyTemplateBytes(templateBytes) {
  if (!Buffer.isBuffer(templateBytes) && !(templateBytes instanceof Uint8Array)) {
    fail(500, 'ARTIFACT_TEMPLATE_MISMATCH', 'The reviewed AFC template failed its integrity check.');
  }
  const actualHash = crypto.createHash('sha256').update(templateBytes).digest();
  if (!crypto.timingSafeEqual(actualHash, TEMPLATE_SHA256)) {
    fail(500, 'ARTIFACT_TEMPLATE_MISMATCH', 'The reviewed AFC template failed its integrity check.');
  }
  return Buffer.from(actualHash);
}

function assertPdfSize(pdfBytes) {
  if (!Buffer.isBuffer(pdfBytes) && !(pdfBytes instanceof Uint8Array)) {
    fail(500, 'ARTIFACT_RENDER_FAILED', 'The approved AFC PDF could not be rendered.');
  }
  if (pdfBytes.length > MAX_PDF_BYTES) {
    fail(413, 'ARTIFACT_TOO_LARGE', 'The approved AFC PDF exceeds the allowed size.');
  }
  return pdfBytes.length;
}

function parseSourceSnapshot(sourceSnapshotJson) {
  if (typeof sourceSnapshotJson !== 'string' || !sourceSnapshotJson) {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
  try {
    return JSON.parse(sourceSnapshotJson);
  } catch {
    fail(422, 'ARTIFACT_SOURCE_INVALID', 'Approved AFC source data is invalid.');
  }
}

function signaturePage(document, fieldName, pages) {
  let field;
  try {
    field = document.getForm().getSignature(fieldName);
  } catch {
    fail(500, 'ARTIFACT_TEMPLATE_MISMATCH', 'The reviewed AFC template failed its integrity check.');
  }
  const widgets = field.acroField.getWidgets();
  if (!widgets.length) fail(500, 'ARTIFACT_TEMPLATE_MISMATCH', 'The reviewed AFC template failed its integrity check.');
  const widget = widgets[0];
  const pageRef = String(widget.P());
  const page = pages.find(candidate => String(candidate.ref) === pageRef);
  if (!page) fail(500, 'ARTIFACT_TEMPLATE_MISMATCH', 'The reviewed AFC template failed its integrity check.');
  return { field, page, rectangle: widget.getRectangle() };
}

async function drawSignature(document, pages, fieldName, signature, font) {
  const { page, rectangle } = signaturePage(document, fieldName, pages);
  const inset = 1;
  if (!signature) return;

  if (signature.image) {
    // pdf-lib reads JPEG data through DataView(imageData.buffer), so copy to a
    // zero-offset Uint8Array to avoid Buffer slab offsets changing the header.
    const imageBytes = Uint8Array.from(signature.image.bytes);
    const image = signature.image.mime === 'png'
      ? await document.embedPng(imageBytes)
      : await document.embedJpg(imageBytes);
    const maxWidth = Math.max(1, rectangle.width - inset * 2);
    const maxHeight = Math.max(1, rectangle.height - inset * 2);
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: rectangle.x + (rectangle.width - width) / 2,
      y: rectangle.y + (rectangle.height - height) / 2,
      width,
      height,
    });
  } else {
    const size = Math.max(6, Math.min(9, rectangle.height - 3));
    page.drawText(`/s/ ${names.format(signature.displayName)}`, {
      x: rectangle.x + inset,
      y: rectangle.y + Math.max(1, (rectangle.height - size) / 2),
      size,
      font,
      color: rgb(0.05, 0.12, 0.25),
      maxWidth: Math.max(1, rectangle.width - inset * 2),
    });
  }
}

function fillForm(form, fieldValues, checkboxes) {
  const dropdownValues = {
    'Appt Type': ' ',
    Rank: fieldValues.Rank,
    'Primary Department': PRIMARY_DEPARTMENT,
  };
  const dropdownNames = new Set(Object.keys(dropdownValues));
  for (const [name, value] of Object.entries(fieldValues)) {
    if (!dropdownNames.has(name)) form.getTextField(name).setText(value);
  }
  for (const [name, checked] of Object.entries(checkboxes)) {
    const checkbox = form.getCheckBox(name);
    if (checked) checkbox.check();
    else checkbox.uncheck();
  }
  for (const [name, value] of Object.entries(dropdownValues)) {
    form.getDropdown(name).select(value);
  }
}

async function renderApprovedAfcArtifact(sourceSnapshotJson) {
  try {
    const source = parseSourceSnapshot(sourceSnapshotJson);
    const mapped = mapAfcSourceToPdfFields(source);
    const templateBytes = fs.readFileSync(TEMPLATE_PATH);
    const templateSha256 = verifyTemplateBytes(templateBytes);
    const document = await PDFDocument.load(templateBytes, { updateMetadata: false });
    const pages = document.getPages();
    if (pages.length < 2) fail(500, 'ARTIFACT_TEMPLATE_MISMATCH', 'The reviewed AFC template failed its integrity check.');

    const italicFont = await document.embedFont(StandardFonts.HelveticaOblique);
    for (const [fieldName, signatureName] of SIGNATURE_FIELDS) {
      const signature = signatureName ? mapped.signatures[signatureName] : null;
      const { field } = signaturePage(document, fieldName, pages);
      await drawSignature(document, pages, fieldName, signature, italicFont);
      document.getForm().removeField(field);
    }

    fillForm(document.getForm(), mapped.fields, mapped.checkboxes);
    document.getForm().flatten();

    const approvedInstant = utcInstant(source.approvedAtUtc);
    document.setCreationDate(approvedInstant);
    document.setModificationDate(approvedInstant);
    document.setCreator('PAWS');
    document.setProducer(`PAWS approved AFC PDF renderer ${RENDERER_VERSION}`);
    document.setTitle('Approved Absence from Campus Request');
    document.setSubject('Approved Absence from Campus request');

    const pdfBytes = Buffer.from(await document.save({ useObjectStreams: false }));
    const byteLength = assertPdfSize(pdfBytes);
    const pdfSha256 = crypto.createHash('sha256').update(pdfBytes).digest();
    return { pdfBytes, pdfSha256, byteLength, rendererVersion: RENDERER_VERSION, templateSha256 };
  } catch (caught) {
    if (caught instanceof AfcArtifactRendererError) throw caught;
    fail(422, 'ARTIFACT_RENDER_FAILED', 'The approved AFC PDF could not be rendered from its SQL source.');
  }
}

module.exports = {
  renderApprovedAfcArtifact,
  mapAfcSourceToPdfFields,
  verifyTemplateBytes,
  assertPdfSize,
  AfcArtifactRendererError,
  MAX_PDF_BYTES,
  RENDERER_VERSION,
  TEMPLATE_SHA256_HEX,
};
