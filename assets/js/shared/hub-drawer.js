/**
 * Shared slide-in drawer shell for Career Hub panels.
 */
(function () {
  'use strict';

  window.FWHubDrawer = {
    PANEL_CLASS: 'hub-drawer-panel',
    PANEL_WIDTH: 'min(380px, 100%)',
    open: function (el) {
      if (el) el.classList.add('open');
    },
    close: function (el) {
      if (el) el.classList.remove('open');
    },
  };
})();
