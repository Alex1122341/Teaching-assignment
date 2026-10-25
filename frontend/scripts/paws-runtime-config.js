(function (root, factory) {
  'use strict';
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  if (root) root.PAWS_RUNTIME_CONFIG = config;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  // Single source of truth for the PAWS browser runtime.
  //
  // Every page used to carry its own copy of the Firebase Web configuration,
  // pointing at `tester-teaching`, plus a temporary Cloudflare Tunnel origin for
  // the API. That made the lab impossible to retarget and guaranteed drift the
  // moment one copy changed. This module replaces all of those copies.
  //
  // The Web API key and app id are public by design and are shipped to browsers.
  // No Admin credential, service account key or refresh token belongs here.

  const FIREBASE = Object.freeze({
    apiKey: 'AIzaSyB52eUdeFDBTfUWgwsHrqI4XPYl9koMKTQ',
    authDomain: 'vista-teaching-lab.firebaseapp.com',
    projectId: 'vista-teaching-lab',
    storageBucket: 'vista-teaching-lab.firebasestorage.app',
    messagingSenderId: '718796027246',
    appId: '1:718796027246:web:94570662a715dde67bfd7f'
  });

  return Object.freeze({
    environment: 'lab',
    projectId: FIREBASE.projectId,
    firebase: FIREBASE,

    // The lab authenticates synthetic accounts, so the sign-in pre-check must
    // accept the reserved test domain. `ucalgary.ca` here would reject every
    // synthetic identity, which is what previously made lab sign-in impossible.
    // This is a local convenience check only: server authorization still decides
    // what the account may actually read or write.
    allowedEmailDomain: 'example.test',

    // Empty means same-origin: the browser calls `/api/v1/*` on the host that
    // served the page. Set this only when the API genuinely lives elsewhere.
    // A temporary tunnel URL must never be committed here.
    apiOrigin: '',

    // Which backend the API is expected to use. The API reports its own state;
    // this only labels the environment in the UI.
    dataBackend: 'firestore'
  });
});
