(function () {
  try {
    var t = localStorage.getItem('flightway-theme');
    var th = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', th);
    document.documentElement.style.colorScheme = th;
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
  }
})();
