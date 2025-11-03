(() => {
  const input = document.getElementById('searchInput');
  const suggestionsEl = document.getElementById('searchSuggestions');
  if (!input || !suggestionsEl) return;

  const getDefaultSearchApi = () => {
    if (typeof window === 'undefined' || !window.location) return '/search';
    const { protocol, hostname, origin } = window.location;
    if (protocol === 'file:') {
      return 'http://localhost:3001/search';
    }
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocalhost) {
      return 'http://localhost:3001/search';
    }
    return `${origin.replace(/\/$/, '')}/search`;
  };

  const API_URL =
    (typeof window !== 'undefined' && window.SEARCH_API_URL) || getDefaultSearchApi();
  const DEBOUNCE_MS = 150;

  let debounceTimer;
  let activeIndex = -1;
  let currentSuggestions = [];
  let requestId = 0;

  const clearSuggestions = () => {
    currentSuggestions = [];
    activeIndex = -1;
    suggestionsEl.innerHTML = '';
    suggestionsEl.classList.remove('visible');
  };

  const applyActiveState = () => {
    const children = suggestionsEl.querySelectorAll('.suggestion');
    children.forEach((node, index) => {
      node.classList.toggle('active', index === activeIndex);
    });
  };

  const notifySelection = (value) => {
    const sanitized = value?.trim();
    if (!sanitized) return;
    const symbol = sanitized.toUpperCase();
    if (typeof window.displayCompanyFromSearch === 'function') {
      window.displayCompanyFromSearch(symbol);
    }
  };

  const selectSuggestion = (index) => {
    const item = currentSuggestions[index];
    if (!item) return;
    const value = item.ticker || item.name || '';
    input.value = value;
    notifySelection(value);
    clearSuggestions();
  };

  const renderSuggestions = () => {
    if (!currentSuggestions.length) {
      clearSuggestions();
      return;
    }

    suggestionsEl.innerHTML = currentSuggestions
      .map(
        ({ name, ticker }) =>
          `<div class="suggestion" data-ticker="${ticker ?? ''}">
            <span>${name ?? ''}</span>
            <span>${ticker ?? ''}</span>
          </div>`
      )
      .join('');

    suggestionsEl.classList.add('visible');
    applyActiveState();
  };

  const fetchSuggestions = async (value) => {
    const query = value.trim();
    if (!query) {
      clearSuggestions();
      return;
    }

    const id = ++requestId;

    try {
      const response = await fetch(`${API_URL}?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      if (id !== requestId) return;

      currentSuggestions = Array.isArray(data.results) ? data.results.slice(0, 5) : [];
      activeIndex = currentSuggestions.length ? 0 : -1;
      renderSuggestions();
    } catch (error) {
      if (id === requestId) clearSuggestions();
    }
  };

  input.addEventListener('input', (event) => {
    const { value } = event.target;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSuggestions(value), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && currentSuggestions.length) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % currentSuggestions.length;
      applyActiveState();
    } else if (event.key === 'ArrowUp' && currentSuggestions.length) {
      event.preventDefault();
      activeIndex =
        activeIndex <= 0 ? currentSuggestions.length - 1 : activeIndex - 1;
      applyActiveState();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (currentSuggestions.length && activeIndex >= 0) {
        selectSuggestion(activeIndex);
      } else {
        notifySelection(input.value);
        clearSuggestions();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clearSuggestions();
    }
  });

  suggestionsEl.addEventListener('mousedown', (event) => {
    const target = event.target.closest('.suggestion');
    if (!target) return;
    event.preventDefault();
    const { ticker } = target.dataset;
    const value = ticker || target.querySelector('span')?.textContent || '';
    if (value) {
      input.value = value;
      notifySelection(value);
    }
    clearSuggestions();
  });

  document.addEventListener('click', (event) => {
    if (
      event.target === input ||
      suggestionsEl.contains(event.target)
    ) {
      return;
    }
    clearSuggestions();
  });
})();
