'use strict';
// Builds the GitHub Pages testing site from the PAWS pages in frontend/.
//
//   1. Copies every published PAWS asset (tools/static-assets.paws.json) into
//      .deploy-static, flat, exactly as Beta does.
//   2. Bundles the Frontend Demo PAWS API (tools/pages-demo-api) so the pages
//      run against synthetic, browser-local data with no server.
//
// tools/stage-github-pages.js --mode paws then injects the demo runtime, the
// demo API and the TEST SITE banner into every page.
//
// The legacy web/ application keeps its own build (tools/build-static.js) for
// every other deployment target.
const path = require('node:path');
const { ROOT } = require('./build/frontend-paths');
const { buildStaticBundle } = require('./build/static-bundle');
const { buildDemoApi } = require('./pages-demo-api/build');

async function buildPawsPages({ root = ROOT, minify = true } = {}) {
  const output = path.join(root, '.deploy-static');
  const site = buildStaticBundle({ root, output });
  const api = await buildDemoApi({ outfile: path.join(output, 'pages-demo-api.js'), minify });
  return { ...site, demoApi: path.basename(api.outfile) };
}

module.exports = { buildPawsPages };
if (require.main === module) {
  buildPawsPages({ minify: !process.argv.includes('--no-minify') })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error); process.exit(1); });
}
