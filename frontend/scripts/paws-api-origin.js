(function (root, factory) {
  'use strict';
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  if (root) root.PAWS_API_ORIGIN_CONFIG = config;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  return Object.freeze({
    // TEMPORARY BETA INGRESS. Replace this single origin when institutional ingress is approved.
    apiOrigin: 'https://gibson-strand-telecharger-governor.trycloudflare.com',
    releaseLabel: 'TEMPORARY BETA INGRESS'
  });
});
