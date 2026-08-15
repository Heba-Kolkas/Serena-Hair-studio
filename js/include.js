// Loads shared nav/footer partials into any page with [data-include], then
// fires "partials:loaded" once every include on the page has resolved so
// nav.js (and anything else depending on nav/footer markup existing) can init.
(function () {
  const includes = Array.from(document.querySelectorAll('[data-include]'));
  if (!includes.length) return;

  Promise.all(
    includes.map((el) =>
      fetch(el.getAttribute('data-include'))
        .then((r) => r.text())
        .then((html) => {
          el.outerHTML = html;
        })
        .catch(() => {
          el.outerHTML = '';
        })
    )
  ).then(() => {
    document.dispatchEvent(new CustomEvent('partials:loaded'));
  });
})();
