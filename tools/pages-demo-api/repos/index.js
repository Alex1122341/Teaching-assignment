'use strict';
const core = require('./core.js');
const adminWrite = require('./admin-write.js');
// Static map so the browser bundler can see every module.
const MODULES = {
  './afc.js': () => require('./afc.js'),
  './ta.js': () => require('./ta.js'),
  './swap.js': () => require('./swap.js'),
  './calendar.js': () => require('./calendar.js'),
  './history.js': () => require('./history.js'),
  './trainees.js': () => require('./trainees.js'),
  './doe.js': () => require('./doe.js'),
};

// Builds every demo repository. Areas that are not implemented yet fall back to
// `pending(area)` so their API answers 503 instead of failing to load.
function create(store, { pending }) {
  const optional = (file, factory, area) => { try { return MODULES[file]()[factory](store); } catch (error) { if (error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(file.replace('./', ''))) return pending(area); throw error; } };
  return {
    users: core.createUserRepository(store),
    sessions: core.createSessionRepository(store),
    dashboard: core.createDashboardRepository(store),
    facultyAdmin: adminWrite.createFacultyAdminRepository(store),
    afcWrite: adminWrite.createAfcWriteRepository(store),
    optional
  };
}
module.exports = { create };
