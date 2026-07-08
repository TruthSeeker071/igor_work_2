/* Browser-safe Node-style global for legacy scripts (Safari has no `global`). */
(function (root) {
  if (root && typeof root.global === 'undefined') {
    root.global = root;
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof window !== 'undefined' ? window : self);
