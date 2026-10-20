// No celular as tabelas viram cartões: cada célula precisa saber o nome da coluna.
// Este observador copia o título de cada coluna para as células (atributo data-label).
function label(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() || '');
  if (!heads.length) return;
  table.querySelectorAll('tbody tr').forEach((tr) => {
    [...tr.children].forEach((td, i) => {
      const l = heads[i] ?? '';
      if (td.getAttribute('data-label') !== l) td.setAttribute('data-label', l);
    });
  });
}

export function startTableLabels() {
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>('table.t').forEach(label);
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(run); }
  }).observe(document.body, { childList: true, subtree: true });
}
