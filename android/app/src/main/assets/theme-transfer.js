(function() {
  var allThemes = ['theme-obsidian-emerald','theme-midnight-sapphire','theme-warm-amber','theme-minimalist-chrome','theme-monochrome-ivory','theme-premium-navy'];
  var applied = allThemes.find(function(t) { return document.documentElement.classList.contains(t); });
  if (applied) {
    document.addEventListener('DOMContentLoaded', function() {
      allThemes.forEach(function(t) { document.body.classList.remove(t); });
      document.body.classList.add(applied);
    });
  }
})();
