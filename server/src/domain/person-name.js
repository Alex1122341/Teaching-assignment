'use strict';

// Canonical `Last name, First name` display formatting.
//
// Scope discipline: this module only ever formats a *label for display*. It
// must never be used to rewrite a stored identity field, a historic signed
// artifact, or a raw import payload. Stored names stay exactly as received.
//
// The UMD wrapper is kept from the Beta source so the frontend phase can load
// the same file in the browser without a rewrite. Today only `server/` requires
// it; when the browser adopts it, it must be registered in
// `tools/static-assets.json` rather than copied into a second file.

(function (root, factory) {
  const names = factory();
  if (typeof module === 'object' && module.exports) module.exports = names;
  if (root) root.PAWS_FACULTY_NAME = names;
})(typeof window === 'undefined' ? null : window, function () {
  const text = value => value == null ? '' : String(value).trim();
  const spaces = value => text(value).replace(/\s+/g, ' ');

  // Retain the old export for compatibility; rendered names now use format().
  const removeCommas = value => spaces(value).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  // Values that are placeholders rather than names. Reversing these would turn
  // "Unknown faculty" into "faculty, Unknown".
  const unchanged = /^(?:Locum|TBD(?:\s*[-–:].*)?|Unassigned|Other\s*\/\s*Unassigned|Name unavailable|Not provided|Not recorded|Unknown faculty|Unknown|No instructor assigned|Instructor not provided|Faculty not provided|Faculty name not recorded|Not assigned|No faculty|Faculty \d+|UCVM User|PAWS user|UCVM Scheduling|Signed-in account|Selected account|N\/A)$/i;

  function formatText(value) {
    const name = spaces(value);
    if (!name || unchanged.test(name)) return name;
    // Never "reverse" an email address or a UID.
    if (/^[^\s@]+@[^\s@]+$/.test(name)) return name;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}$/i.test(name)) return name;
    // Already "Last, First": normalize spacing and do not reverse twice.
    if (name.includes(',')) return name.replace(/\s*,\s*/g, ', ');
    const suffix = name.match(/^(.*?)(\s+\([^()]{1,40}\))$/);
    const stem = suffix ? suffix[1] : name;
    const parts = stem.split(/\s+/);
    if (parts.length < 2) return name;
    return parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ') + (suffix ? suffix[2] : '');
  }

  function format(record, fallback = '') {
    if (!record || typeof record !== 'object') return formatText(record) || formatText(fallback);
    const first = [record.preferredFirstName, record.PreferredFirstName, record.firstName, record.FirstName].map(spaces).find(Boolean) || '';
    const last = [record.preferredLastName, record.PreferredLastName, record.lastName, record.LastName].map(spaces).find(Boolean) || '';
    if (first && last) return last + ', ' + first;
    if (last || first) return last || first;
    const label = [record.preferredFullName, record.PreferredFullName, record.displayName, record.DisplayName, record.name, record.facultyName].map(spaces).find(Boolean);
    return formatText(label) || formatText(fallback);
  }

  function formatList(value) {
    // Instructor lists are semicolon/newline-delimited. Commas belong within names.
    return String(value ?? '')
      .split(/([;\n]+)/)
      .map(part => /^[;\n]+$/.test(part)
        ? part
        : part.replace(/^([ \t]*)(.*?)([ \t]*)$/, (_all, leading, name, trailing) => leading + formatText(name) + trailing))
      .join('')
      .trim();
  }

  return Object.freeze({ format, formatList, removeCommas });
});
