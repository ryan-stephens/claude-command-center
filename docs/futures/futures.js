// cc-control futures: shared behaviour for the mock pages.
// - scales every .frame[data-w][data-h] to its width
// - routes keys to the page's mock (unless focus is in a form field)
// - flashes the matching keycaps, shows toasts, toggles the ? overlay
(function () {
  function scale() {
    document.querySelectorAll('.frame[data-w]').forEach(function (f) {
      var w = +f.dataset.w, h = +f.dataset.h, s = f.clientWidth / w;
      f.style.height = Math.round(h * s) + 'px';
      f.firstElementChild.style.transform = 'scale(' + s + ')';
    });
  }
  window.addEventListener('resize', scale);
  document.addEventListener('DOMContentLoaded', scale);
  if (document.readyState !== 'loading') scale();

  // Normalised key name: "Enter", "Esc", "Space", "Tab", "Shift+Tab", "Ctrl+K", "a", "A", "?", "1", "ArrowUp" ...
  function keyName(e) {
    var k = e.key;
    if (k === 'Escape') k = 'Esc';
    if (k === ' ') k = 'Space';
    var mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey && (k.length > 1)) mods.push('Shift');
    if (k.length === 1 && (e.ctrlKey || e.altKey)) k = k.toUpperCase();
    return mods.concat([k]).join('+');
  }

  var toastTimer;
  var F = window.Futures = {
    scale: scale,
    // Flash every keycap in the mock whose data-k matches (e.g. <span class="kc" data-k="Enter">Enter</span>).
    flash: function (root, name) {
      root.querySelectorAll('.kc').forEach(function (kc) {
        var want = kc.dataset.k || kc.textContent.trim();
        if (want === name) { kc.classList.add('pressed'); setTimeout(function () { kc.classList.remove('pressed'); }, 140); }
      });
    },
    toast: function (root, text) {
      var t = root.querySelector('.toast');
      if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); root.appendChild(t); }
      t.textContent = text; t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
    },
    // handler(name, event) returns true when it used the key.
    keys: function (root, handler) {
      document.addEventListener('keydown', function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag) && e.key !== 'Escape') return;
        var name = keyName(e);
        if (handler(name, e)) { e.preventDefault(); F.flash(root, name); }
      });
    }
  };
})();
