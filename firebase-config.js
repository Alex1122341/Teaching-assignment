'use strict';
// Single source of truth for the Firebase client configuration.
//
// ---------------------------------------------------------------------------
// Why this file exists
// ---------------------------------------------------------------------------
// The Firebase client configuration used to be hard-coded inside faculty-access.js
// and faculty-admin.js, pointing at the shared live project. Because this
// repository is public and every pull request publishes a preview site, that
// meant a public URL talking to live data.
//
// This file is now the only place the client configuration lives, and the
// committed default targets the isolated LAB project, which contains synthetic
// data only. The DOE API endpoint is intentionally blank in the committed
// template so a clone or preview cannot accidentally reach a production API.
//
// ---------------------------------------------------------------------------
// Local development
// ---------------------------------------------------------------------------
// When the page is served from localhost, the SDK is pointed at the Emulator
// Suite instead of any cloud project. A fresh clone therefore runs against the
// seeded local database with no credentials:
//
//   npm run db:seed:emulator     # seed the emulator
//   firebase emulators:start     # serve
//
// ---------------------------------------------------------------------------
// Pointing at a real project
// ---------------------------------------------------------------------------
// Regenerate this file from the Firebase CLI:
//
//   node tools/build-firebase-config.js --project vista-teaching-lab
//
// Production configuration and the production DOE API URL are generated at
// build time and are never committed to this public repository. See
// docs/database/CONFIGURATION.md.
// ---------------------------------------------------------------------------

(function (root) {
  if (!root) return;

  // Committed default: the isolated LAB project. Synthetic data only.
  // `apiKey` here is a placeholder; generate the file to talk to a real project.
  const config = {
    apiKey: 'GENERATE_WITH_tools_build-firebase-config.js',
    authDomain: 'vista-teaching-lab.firebaseapp.com',
    projectId: 'vista-teaching-lab',
    storageBucket: 'vista-teaching-lab.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000'
  };

  const host = String((root.location && root.location.hostname) || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '0.0.0.0';

  root.UCVM_FIREBASE_CONFIG = Object.freeze(config);
  root.UCVM_FIREBASE_EMULATOR = isLocal;
  root.UCVM_FIREBASE_PROJECT_ID = config.projectId;
  root.UCVM_DOE_API_BASE_URL = '';
})(typeof window !== 'undefined' ? window : null);
