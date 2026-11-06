(() => {
  let theme = 'light';

  try {
    const savedTheme = globalThis.localStorage.getItem('xmsgi-color-theme-v1');
    theme = savedTheme === 'dark' || savedTheme === 'charcoal' ? 'dark' : 'light';
  } catch {
    // Keep the default light theme when browser storage is unavailable.
  }

  const root = globalThis.document.documentElement;
  root.dataset.theme = theme;
  delete root.dataset.themeVariant;
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#0d1115' : '#f7f8fa';
})();
