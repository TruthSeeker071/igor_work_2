(function () {
  var params = new URLSearchParams(location.search);
  window.__FW_FLAGS = {
    debugQuiz: params.get('fw_debug_quiz') === '1',
    skipReveal: params.get('fw_skip_reveal') === '1',
    devSkipEmail: params.get('fw_dev_email') === '1',
    debugEvents: params.get('fw_debug_events') === '1',
  };
})();
