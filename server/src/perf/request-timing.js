'use strict';

const { performance } = require('node:perf_hooks');

// Bounded, allow-listed request timing. Metric names and descriptions are
// enumerated so a caller can never emit an arbitrary string into a response
// header; anything not on the list is dropped rather than escaped.

const METRIC_NAMES = Object.freeze([
  'firebase_verify',
  'sql_connect',
  'sql_user_query',
  'profile_validate',
  'me_total'
]);
const ALLOWED_METRICS = new Set(METRIC_NAMES);
const ALLOWED_DESCRIPTIONS = new Set(['cold', 'warm']);

function formatDuration(value) {
  return String(Number(value.toFixed(3)));
}

function createRequestTiming({ now = () => performance.now() } = {}) {
  const metrics = new Map();
  let eligible = false;

  function record(name, duration, description) {
    if (!ALLOWED_METRICS.has(name) || !Number.isFinite(duration) || duration < 0) return false;
    const entry = { duration };
    if (ALLOWED_DESCRIPTIONS.has(description)) entry.description = description;
    metrics.set(name, entry);
    return true;
  }

  return {
    start(name) {
      return ALLOWED_METRICS.has(name) ? now() : null;
    },
    end(name, startedAt, description) {
      if (!ALLOWED_METRICS.has(name) || !Number.isFinite(startedAt)) return false;
      return record(name, now() - startedAt, description);
    },
    record,
    markEligible() { eligible = true; },
    isEligible() { return eligible; },
    serverTiming() {
      if (!eligible) return '';
      return METRIC_NAMES.flatMap(name => {
        const entry = metrics.get(name);
        if (!entry) return [];
        const desc = entry.description ? `;desc="${entry.description}"` : '';
        return [`${name};dur=${formatDuration(entry.duration)}${desc}`];
      }).join(', ');
    }
  };
}

module.exports = { createRequestTiming, METRIC_NAMES };
