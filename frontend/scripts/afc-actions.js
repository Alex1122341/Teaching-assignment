'use strict';
// Legacy browser decision/projection writes are disabled; AFC changes must flow through the PAWS University API.
window.UCVM_AFC_ACTIONS=Object.freeze({decide:async()=>{throw new Error('AFC decisions require the PAWS University API; direct Firestore mutation is disabled.')}});
