(() => {
  'use strict';

  // All Faculty edits must use the guarded SQL API. Compatibility entry point
  // module. DOE behavior delegates to the authenticated University API editor.
  function mountDoeEditor({ form, faculty, api, academicYear, onSaved, canWrite } = {}) {
    const editor = window.UCVM_FACULTY_DOE_EDIT;
    if (!editor || !form || !faculty || !api) return false;
    editor.create({ api, academicYear, onSaved, canWrite }).mount(form, faculty);
    return true;
  }

  window.UCVM_FACULTY_ADMIN_ENHANCEMENTS = Object.freeze({ mountDoeEditor });
})();
