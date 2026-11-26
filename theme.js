(() => {
    const key = 'portfolio-theme';
    const selector = '.theme-switch input';
    const root = document.documentElement;

    function applyTheme(theme) {
        root.dataset.theme = theme;
        const toggle = document.querySelector(selector);
        if (toggle) {
            toggle.checked = theme === 'dark';
        }
    }

    function restoreTheme() {
        try {
            const theme = localStorage.getItem(key);
            if (theme === 'dark' || theme === 'light') {
                applyTheme(theme);
            }
        } catch {
            // The toggle still works for this page when storage is unavailable.
        }
    }

    restoreTheme();
    document.addEventListener('DOMContentLoaded', restoreTheme, { once: true });
    window.addEventListener('pageshow', restoreTheme);

    document.addEventListener('change', (event) => {
        if (!event.target.matches?.(selector)) {
            return;
        }
        const theme = event.target.checked ? 'dark' : 'light';
        applyTheme(theme);
        try {
            localStorage.setItem(key, theme);
        } catch {
            // A blocked save should not prevent the theme from changing.
        }
    });

    window.addEventListener('storage', (event) => {
        if (event.key === key || event.key === null) {
            applyTheme(event.newValue === 'dark' ? 'dark' : 'light');
        }
    });
})();
