(() => {
  const API_ENDPOINT = 'https://hvitsw46i3.execute-api.us-west-2.amazonaws.com/Prod/finance-qa';
  const resolveApiUrl = (path) => {
    if (typeof window === 'undefined' || !window.location) return `/${path}`;
    const { protocol, hostname, origin } = window.location;
    if (protocol === 'file:') {
      return `http://localhost:3001/${path}`;
    }
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocalhost) {
      return `http://localhost:3001/${path}`;
    }
    return `${origin.replace(/\/$/, '')}/${path}`;
  };
  const COMPANY_API_URL =
    (typeof window !== 'undefined' && window.COMPANY_API_URL) || resolveApiUrl('api/company');
  const QUOTES_API_URL =
    (typeof window !== 'undefined' && window.QUOTES_API_URL) || resolveApiUrl('api/quotes');

  const stripJsonFences = (input) => {
    if (typeof input !== 'string') return input;
    const fencePattern = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
    const match = input.trim().match(fencePattern);
    return match ? match[1] : input.trim();
  };

  const parseResponsePayload = (payload) => {
    if (payload == null) return null;
    if (typeof payload === 'object' && !Array.isArray(payload)) return payload;
    const text = stripJsonFences(String(payload));
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
    } catch {
      return { message: text };
    }
  };

  const setLoadingState = (button, isLoading) => {
    if (!button) return;
    button.disabled = isLoading;
    button.dataset.loading = isLoading ? 'true' : 'false';
  };

  const renderResult = (container, payload) => {
    if (!container) return;
    const data = parseResponsePayload(payload);

    // If Lambda returns the strict JSON {law_title, impact_short_term, confidence}
    if (data && typeof data === 'object' && 'law_title' in data && 'impact_short_term' in data && 'confidence' in data) {
      container.innerHTML = `
        <div class="result-card">
          <div><strong>Law:</strong> ${data.law_title}</div>
          <div><strong>Impact (short-term):</strong> ${data.impact_short_term}</div>
          <div><strong>Confidence:</strong> ${data.confidence}</div>
        </div>
      `;
      return;
    }

    // Otherwise, show raw JSON
    if (data == null) {
      container.textContent = 'Aucune donnée reçue.';
    } else if (typeof data === 'string') {
      container.textContent = data;
    } else {
      container.textContent = JSON.stringify(data, null, 2);
    }
  };

  const sendQuestionRaw = async (question) => {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`La requête a échoué (${response.status}). ${errorBody || 'Aucun détail fourni.'}`);
    }

    // Lambda may return strict JSON or a string with fences
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return await response.json();
    } else {
      const raw = await response.text();
      const cleaned = stripJsonFences(raw);
      return parseResponsePayload(cleaned);
    }
  };

  const setupMainQuestionForm = () => {
    const questionInput =
      document.getElementById('questionInput') ||
      document.querySelector('[data-role="question-input"]');
    const submitButton =
      document.getElementById('askButton') ||
      document.querySelector('[data-role="question-submit"]');
    const resultContainer = document.getElementById('result');

    if (!questionInput || !submitButton || !resultContainer) return;

    const handleSubmit = async (event) => {
      event.preventDefault();
      const question = questionInput.value.trim();
      if (!question) {
        renderResult(resultContainer, 'Veuillez saisir une question.');
        return;
      }

      setLoadingState(submitButton, true);
      renderResult(resultContainer, 'Envoi en cours…');

      try {
        const data = await sendQuestionRaw(question);
        renderResult(resultContainer, data);
      } catch (error) {
        console.error('Erreur lors de l’appel API:', error);
        renderResult(resultContainer, {
          error: 'Une erreur est survenue lors de la récupération de la réponse.',
          details: error.message,
        });
      } finally {
        setLoadingState(submitButton, false);
      }
    };

    submitButton.addEventListener('click', handleSubmit);
    questionInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handleSubmit(event);
    });
  };

  const appendChatMessage = (container, role, text) => {
    if (!container) return;
    const message = document.createElement('div');
    message.className = `msg ${role}`;
    message.textContent = text;
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
  };

  const setupChatbot = () => {
    const chatInput = document.getElementById('chatInput');
    const chatSend = document.getElementById('chatSend');
    const chatLog = document.getElementById('chatLog');
    const chatFileInput = document.getElementById('chatFile');
    const chatAttachButton = document.getElementById('chatAttach');
    const attachmentView = document.getElementById('chatAttachmentView');
    const attachmentName = document.getElementById('attachmentName');
    const attachmentClear = document.getElementById('attachmentClear');
    if (!chatInput || !chatSend || !chatLog) return;

    let isSending = false;
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    let attachment = null;

    const textExtensions = new Set([
      'txt',
      'md',
      'markdown',
      'json',
      'csv',
      'tsv',
      'log',
      'yaml',
      'yml',
      'xml',
      'html',
      'htm',
      'ini',
      'cfg',
      'env',
      'py',
      'js',
      'ts',
      'tsx',
      'jsx',
      'java',
      'cs',
      'cpp',
      'c',
      'cc',
      'h',
      'hpp',
      'swift',
      'go',
      'rs',
      'rb',
      'php',
      'sql',
      'tex',
      'rtf',
      'sh',
      'bash',
      'zsh',
      'ps1',
      'ipynb',
    ]);

    const formatBytes = (bytes) => {
      if (!Number.isFinite(bytes)) return 'taille inconnue';
      if (bytes < 1024) return `${bytes} o`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
    };

    const updateAttachmentBadge = () => {
      if (!attachmentView || !attachmentName) return;
      if (attachment) {
        attachmentView.classList.remove('is-hidden');
        attachmentName.textContent = `${attachment.name} · ${formatBytes(attachment.size)}`;
      } else {
        attachmentView.classList.add('is-hidden');
        attachmentName.textContent = 'Aucune pièce jointe';
      }
    };

    const clearAttachment = () => {
      attachment = null;
      if (chatFileInput) chatFileInput.value = '';
      updateAttachmentBadge();
    };

    const getExtension = (filename) => {
      const lastDot = filename.lastIndexOf('.');
      return lastDot >= 0 ? filename.slice(lastDot + 1).toLowerCase() : '';
    };

    const shouldReadAsText = (file) => {
      if (!file) return false;
      if (file.type && file.type.startsWith('text/')) return true;
      const ext = getExtension(file.name);
      return textExtensions.has(ext);
    };

    const readFileContent = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => {
          reader.abort();
          reject(new Error('Lecture du fichier impossible.'));
        };
        reader.onload = () => resolve(reader.result);

        if (shouldReadAsText(file)) {
          reader.readAsText(file);
        } else {
          reader.readAsDataURL(file);
        }
      });

    const handleFileSelection = async (file) => {
      if (!file) return;
      if (file.size > MAX_FILE_SIZE) {
        appendChatMessage(
          chatLog,
          'bot',
          `Le fichier "${file.name}" dépasse la taille maximale autorisée (${formatBytes(MAX_FILE_SIZE)}).`
        );
        if (chatFileInput) chatFileInput.value = '';
        return;
      }

      try {
        const rawContent = await readFileContent(file);
        let encoding = 'text';
        let content = rawContent;
        if (!shouldReadAsText(file)) {
          const base64 = typeof rawContent === 'string' ? rawContent.split(',').pop() : null;
          if (!base64) throw new Error('Impossible de traiter ce format de fichier.');
          encoding = 'base64';
          content = base64;
        }

        attachment = {
          name: file.name,
          size: file.size,
          type: file.type || getExtension(file.name) || 'inconnu',
          encoding,
          content,
        };
        updateAttachmentBadge();
        appendChatMessage(
          chatLog,
          'bot',
          `Pièce jointe prête: ${attachment.name} (${formatBytes(attachment.size)}).`
        );
      } catch (error) {
        appendChatMessage(chatLog, 'bot', `Erreur de lecture du fichier: ${error.message}`);
        clearAttachment();
      }
    };

    if (chatAttachButton && chatFileInput) {
      chatAttachButton.addEventListener('click', (event) => {
        event.preventDefault();
        chatFileInput.click();
      });
    }

    if (chatFileInput) {
      chatFileInput.addEventListener('change', () => {
        const file = chatFileInput.files?.[0];
        if (!file) {
          clearAttachment();
          return;
        }
        handleFileSelection(file);
      });
    }

    if (attachmentClear) {
      attachmentClear.addEventListener('click', (event) => {
        event.preventDefault();
        clearAttachment();
      });
    }

    updateAttachmentBadge();

    const sendChatMessage = async () => {
      const question = chatInput.value.trim();
      if (!question && !attachment) return;
      if (isSending) return;

      const attachmentSnapshot = attachment
        ? { ...attachment }
        : null;
      const userDisplayMessage = attachmentSnapshot
        ? (question
            ? `${question}\n\n[Pièce jointe: ${attachmentSnapshot.name} · ${formatBytes(
                attachmentSnapshot.size
              )}]`
            : `[Pièce jointe: ${attachmentSnapshot.name} · ${formatBytes(attachmentSnapshot.size)}]`)
        : question;

      appendChatMessage(chatLog, 'user', userDisplayMessage || 'Pièce jointe envoyée.');
      chatInput.value = '';
      const placeholder = appendChatMessage(chatLog, 'bot', 'Analyse en cours…');

      isSending = true;
      chatSend.disabled = true;

      try {
        const combinedQuestion = (() => {
          if (!attachmentSnapshot) return question;
          const header = `[Pièce jointe: ${attachmentSnapshot.name} | Taille: ${formatBytes(
            attachmentSnapshot.size
          )} | Type: ${attachmentSnapshot.type} | Encodage: ${attachmentSnapshot.encoding}]`;
          const payloadContent =
            attachmentSnapshot.encoding === 'base64'
              ? attachmentSnapshot.content
              : attachmentSnapshot.content;
          const attachmentBlock = `${header}\n${payloadContent}`;
          if (question) {
            return `${question}\n\n${attachmentBlock}`;
          }
          return `Analyse la pièce jointe suivante et fournis un résumé:\n\n${attachmentBlock}`;
        })();

        const data = await sendQuestionRaw(combinedQuestion);
        if (data && typeof data === 'object' && 'law_title' in data) {
          placeholder.textContent = `Law: ${data.law_title}\nImpact (short-term): ${data.impact_short_term}\nConfidence: ${data.confidence}`;
        } else if (data == null) {
          placeholder.textContent = 'Je n’ai pas de réponse pour le moment.';
        } else if (typeof data === 'string') {
          placeholder.textContent = data;
        } else {
          placeholder.textContent = JSON.stringify(data, null, 2);
        }
        if (attachmentSnapshot) {
          clearAttachment();
        }
      } catch (error) {
        console.error('Erreur chatbot:', error);
        placeholder.textContent = `Erreur: ${error.message}`;
      } finally {
        isSending = false;
        chatSend.disabled = false;
        chatInput.focus();
      }
    };

    chatSend.addEventListener('click', (e) => {
      e.preventDefault();
      sendChatMessage();
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
      } else if (e.key === 'Escape') {
        chatInput.blur();
      }
    });
  };

  const sanitizeName = (name) => {
    if (typeof name !== 'string') return '';
    return name.replace(/,\s*$/, '').trim();
  };

  const sanitizeTicker = (ticker) => {
    if (typeof ticker !== 'string') return '';
    return ticker.replace(/,/g, '.').trim();
  };

  const formatPopularity = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString('fr-FR') : '';
  };

  const loadTopCompanies = async () => {
    const list = document.getElementById('top5');
    if (!list) return;

    const fallback = [
      { name: 'Nvidia', ticker: 'NVDA', popularity: 765 },
      { name: 'Microsoft', ticker: 'MSFT', popularity: 667 },
      { name: 'Apple Inc,', ticker: 'AAPL', popularity: 597 },
      { name: 'Amazon', ticker: 'AMZN', popularity: 427 },
      { name: 'Meta Platforms', ticker: 'META', popularity: 339 },
    ];

    const formatQuotePrice = (price, currency) => {
      if (!Number.isFinite(price)) return null;
      const code = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'USD';
      try {
        return new Intl.NumberFormat('fr-FR', {
          style: 'currency',
          currency: code,
          maximumFractionDigits: price >= 100 ? 2 : 4,
        }).format(price);
      } catch {
        return `${price.toFixed(2)} ${code}`;
      }
    };

    const formatChangeLabel = (value) => {
      if (!Number.isFinite(value)) return null;
      const sign = value >= 0 ? '+' : '-';
      return `${sign}${Math.abs(value).toFixed(2)}%`;
    };

    const renderList = (items, quotesMap = new Map()) => {
      list.innerHTML = (items || [])
        .map((company, index) => {
          const name = sanitizeName(company?.name);
          const rawTicker = sanitizeTicker(company?.ticker);
          const ticker = rawTicker?.toUpperCase() || '';
          const popularity = formatPopularity(company?.popularity);
          const quote = quotesMap.get(ticker) || null;
          const priceLabel = quote ? formatQuotePrice(quote.price, quote.currency) : null;
          const changeLabel = quote ? formatChangeLabel(quote.changePercent) : null;
          const changeClass = !quote || !Number.isFinite(quote.changePercent)
            ? 'neutral'
            : quote.changePercent > 0
              ? 'up'
              : quote.changePercent < 0
                ? 'down'
                : 'neutral';

          return `
            <button class="row top-company" data-ticker="${ticker}">
              <div class="info">
                <div class="badge">${index + 1}</div>
                <div>
                  <div class="name">${name || '—'}</div>
                  <div class="ticker">${ticker || ''}</div>
                </div>
              </div>
              <div class="top-quote">
                <div class="quote-price">${priceLabel ?? popularity ?? '—'}</div>
                <div class="quote-change ${changeClass}">
                  ${priceLabel ? (changeLabel ?? '—') : 'Popularité'}
                </div>
              </div>
            </button>
          `;
        })
        .join('');

      const buttons = list.querySelectorAll('.top-company');
      buttons.forEach((button) => {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          const symbol = button.dataset.ticker;
          if (symbol) {
            displayCompanyFromSearch(symbol);
          }
        });
      });
    };

    renderList(fallback, new Map());

    try {
      const response = await fetch('companies.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const topFive = Array.isArray(data)
        ? data
            .filter((item) => item && typeof item.popularity !== 'undefined')
            .sort((a, b) => Number(b.popularity) - Number(a.popularity))
            .slice(0, 5)
        : [];

      if (!topFive.length) {
        renderList(fallback, new Map());
        return;
      }

      const tickers = topFive
        .map((item) => sanitizeTicker(item?.ticker)?.toUpperCase())
        .filter(Boolean);

      let quotesMap = new Map();
      if (tickers.length) {
        try {
          const quoteResponse = await fetch(`${QUOTES_API_URL}?symbols=${encodeURIComponent(tickers.join(','))}`, {
            cache: 'no-store',
          });
          if (quoteResponse.ok) {
            const quoteData = await quoteResponse.json();
            if (quoteData && Array.isArray(quoteData.quotes)) {
              quotesMap = new Map(
                quoteData.quotes
                  .filter((quote) => quote && typeof quote.symbol === 'string')
                  .map((quote) => [quote.symbol.toUpperCase(), quote])
              );
            }
          }
        } catch (error) {
          console.error('Erreur lors de la récupération des cotations Top 5:', error);
        }
      }

      renderList(topFive, quotesMap);
    } catch (error) {
      console.error('Erreur lors du chargement des compagnies:', error);
      renderList(fallback, new Map());
    }
  };

  const viewLayouts = {
    chat: null,
    company: null,
    backButton: null,
  };

  const companyElements = {
    container: null,
    name: null,
    symbol: null,
    exchange: null,
    price: null,
    change: null,
    marketCap: null,
    status: null,
    priceChart: null,
    performanceChart: null,
  };

  let companyModuleReady = false;
  let currentHistory = [];
  let activeCompanyController = null;

  function showCompanyView() {
    if (viewLayouts.chat) viewLayouts.chat.classList.add('is-hidden');
    if (viewLayouts.company) {
      viewLayouts.company.classList.remove('is-hidden');
      viewLayouts.company.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function showChatView() {
    if (viewLayouts.company) viewLayouts.company.classList.add('is-hidden');
    if (viewLayouts.chat) {
      viewLayouts.chat.classList.remove('is-hidden');
      viewLayouts.chat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const initCompanyElements = () => {
    companyElements.container = document.getElementById('companyView');
    companyElements.name = document.getElementById('companyName');
    companyElements.symbol = document.getElementById('companySymbol');
    companyElements.exchange = document.getElementById('companyExchange');
    companyElements.price = document.getElementById('companyPrice');
    companyElements.change = document.getElementById('companyChange');
    companyElements.marketCap = document.getElementById('companyMarketCap');
    companyElements.status = document.getElementById('companyStatus');
    companyElements.priceChart = document.getElementById('priceChart');
    companyElements.performanceChart = document.getElementById('performanceChart');
    companyModuleReady = Boolean(
      companyElements.container &&
      companyElements.name &&
        companyElements.symbol &&
        companyElements.exchange &&
        companyElements.price &&
        companyElements.change &&
        companyElements.marketCap &&
        companyElements.status &&
        companyElements.priceChart &&
        companyElements.performanceChart
    );
  };

  const initViewLayouts = () => {
    viewLayouts.chat = document.getElementById('chatLayout');
    viewLayouts.company = document.getElementById('companyView');
    viewLayouts.backButton = document.getElementById('backToChat');
    if (viewLayouts.backButton) {
      viewLayouts.backButton.addEventListener('click', (event) => {
        event.preventDefault();
        showChatView();
      });
    }
  };

  const setCompanyStatus = (message, variant = 'neutral') => {
    if (!companyModuleReady) return;
    const element = companyElements.status;
    element.textContent = message;
    element.classList.remove('neutral', 'loading', 'success', 'error');
    element.classList.add(variant);
  };

  const resetCompanyMeta = () => {
    if (!companyModuleReady) return;
    companyElements.price.textContent = '—';
    companyElements.marketCap.textContent = '—';
    companyElements.change.textContent = '—';
    companyElements.change.classList.remove('up', 'down');
    currentHistory = [];
    renderCharts([]);
  };

  const formatPrice = (price, currency) => {
    if (!Number.isFinite(price)) return '—';
    const code = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'USD';
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: price >= 100 ? 2 : 4,
      }).format(price);
    } catch {
      return `${price.toFixed(2)} ${code}`;
    }
  };

  const formatMarketCap = (value, currency) => {
    if (!Number.isFinite(value)) return '—';
    const code = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : '';
    const units = [
      { value: 1e12, suffix: 'T' },
      { value: 1e9, suffix: 'B' },
      { value: 1e6, suffix: 'M' },
      { value: 1e3, suffix: 'K' },
    ];
    const match = units.find((unit) => value >= unit.value);
    const formattedNumber = match
      ? (value / match.value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
      : value.toLocaleString('fr-FR');
    return `${formattedNumber} ${match ? match.suffix : ''} ${code}`.trim();
  };

  const formatChange = (value) => {
    if (!Number.isFinite(value)) return '—';
    const modifier = Math.abs(value).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const sign = value >= 0 ? '+' : '-';
    return `${sign}${modifier}%`;
  };

  const prepareCanvas = (canvas) => {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  };

  const renderLineChart = (canvas, points) => {
    if (!canvas) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const padding = 24;

    if (!Array.isArray(points) || !points.length) {
      canvas.dataset.empty = 'true';
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    canvas.dataset.empty = 'false';

    const values = points.map((point) => point.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || Math.abs(max || min) * 0.01 || 1;

    const x = (index) => {
      if (points.length === 1) return width / 2;
      return padding + ((width - padding * 2) * index) / (points.length - 1);
    };
    const y = (value) => height - padding - ((height - padding * 2) * (value - min)) / range;

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,62,165,0.85)';
    ctx.beginPath();
    ctx.moveTo(x(0), y(values[0]));
    for (let i = 1; i < values.length; i += 1) {
      ctx.lineTo(x(i), y(values[i]));
    }
    ctx.stroke();

    const gradient = ctx.createLinearGradient(0, padding, 0, height);
    gradient.addColorStop(0, 'rgba(255,62,165,0.25)');
    gradient.addColorStop(1, 'rgba(255,62,165,0)');

    ctx.lineTo(x(values.length - 1), height - padding);
    ctx.lineTo(x(0), height - padding);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  };

  const computeReturns = (history) => {
    if (!Array.isArray(history) || history.length < 2) return [];
    const results = [];
    for (let i = 1; i < history.length; i += 1) {
      const previous = history[i - 1];
      const current = history[i];
      if (!Number.isFinite(previous.close) || !Number.isFinite(current.close) || previous.close === 0) {
        continue;
      }
      const value = ((current.close - previous.close) / previous.close) * 100;
      results.push({
        date: current.date,
        value,
      });
    }
    return results.slice(-20);
  };

  const renderBarChart = (canvas, returns) => {
    if (!canvas) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const padding = 24;

    if (!Array.isArray(returns) || !returns.length) {
      canvas.dataset.empty = 'true';
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    canvas.dataset.empty = 'false';

    const maxMagnitude =
      returns.reduce((acc, item) => Math.max(acc, Math.abs(item.value)), 0) || 1;

    const step = (width - padding * 2) / returns.length;
    const barWidth = Math.max(step * 0.6, 4);
    const offset = (step - barWidth) / 2;
    const baseline = height / 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(padding, baseline);
    ctx.lineTo(width - padding, baseline);
    ctx.stroke();

    returns.forEach((item, index) => {
      const x = padding + index * step + offset;
      const barHeight = ((height / 2 - padding) * Math.abs(item.value)) / maxMagnitude;
      const isUp = item.value >= 0;
      ctx.fillStyle = isUp ? 'rgba(27,209,154,0.75)' : 'rgba(255,107,123,0.75)';
      const topY = isUp ? baseline - barHeight : baseline;
      ctx.fillRect(x, topY, barWidth, barHeight || 2);
    });
  };

  const renderCharts = (history) => {
    renderLineChart(companyElements.priceChart, history);
    renderBarChart(companyElements.performanceChart, computeReturns(history));
  };

  const computePeriodChange = (history) => {
    if (!Array.isArray(history) || history.length < 2) return null;
    const first = history[0].close;
    const last = history[history.length - 1].close;
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
    return ((last - first) / first) * 100;
  };

  const updateCompanyOverview = (data) => {
    if (!companyModuleReady) return;

    const {
      name,
      symbol,
      currency,
      price,
      marketCap,
      changePercent,
      previousClose,
      exchange,
      history,
    } = data;

    companyElements.name.textContent = name || symbol || '—';
    const resolvedCurrency = currency && currency.trim() ? currency.trim().toUpperCase() : 'USD';
    companyElements.symbol.textContent = [symbol || '—', resolvedCurrency].filter(Boolean).join(' · ');
    companyElements.exchange.textContent = exchange || '—';

    const historyPoints = Array.isArray(history)
      ? history.filter((point) => point && Number.isFinite(point.close))
      : [];
    currentHistory = historyPoints;

    companyElements.price.textContent = formatPrice(price, resolvedCurrency);
    companyElements.marketCap.textContent = formatMarketCap(marketCap, resolvedCurrency);

    let changeValue = Number(changePercent);
    if (!Number.isFinite(changeValue) && Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0) {
      changeValue = ((price - previousClose) / previousClose) * 100;
    }

    companyElements.change.textContent = formatChange(changeValue);
    companyElements.change.classList.remove('up', 'down');
    if (Number.isFinite(changeValue)) {
      companyElements.change.classList.add(changeValue >= 0 ? 'up' : 'down');
    }

    renderCharts(historyPoints);

    if (historyPoints.length) {
      const lastPoint = historyPoints[historyPoints.length - 1];
      const statusDate = new Date(lastPoint.date);
      const periodChange = computePeriodChange(historyPoints);
      const changeLabel = Number.isFinite(periodChange) ? formatChange(periodChange) : '—';
      setCompanyStatus(
        `Dernière clôture : ${statusDate.toLocaleDateString('fr-FR')} • Variation sur la période : ${changeLabel}`,
        'success'
      );
    } else {
      setCompanyStatus('Données de prix limitées pour cette compagnie.', 'error');
    }
  };

  const fetchCompanyData = async (symbol, signal) => {
    const url = `${COMPANY_API_URL}?symbol=${encodeURIComponent(symbol)}`;
    const response = await fetch(url, { signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (text) {
        try {
          const data = JSON.parse(text);
          if (data && typeof data === 'object') {
            const message = [data.error, data.details].filter(Boolean).join(' — ');
            if (message) {
              throw new Error(message);
            }
          }
        } catch {
          throw new Error(text);
        }
      }
      throw new Error(`Réponse inattendue (${response.status}).`);
    }
    return response.json();
  };

  const displayCompanyFromSearch = async (value) => {
    if (!value) return;
    if (!companyModuleReady) initCompanyElements();
    if (!viewLayouts.company) initViewLayouts();
    if (!companyModuleReady) return;

    const symbol = value.trim().toUpperCase();
    if (!symbol) return;

    if (activeCompanyController) {
      activeCompanyController.abort();
    }

    const controller = new AbortController();
    activeCompanyController = controller;

    showCompanyView();
    companyElements.name.textContent = symbol;
    companyElements.symbol.textContent = symbol;
    companyElements.exchange.textContent = '—';
    setCompanyStatus(`Chargement des données pour ${symbol}…`, 'loading');
    resetCompanyMeta();

    try {
      const data = await fetchCompanyData(symbol, controller.signal);
      if (controller.signal.aborted) return;
      activeCompanyController = null;
      updateCompanyOverview(data);
    } catch (error) {
      if (controller.signal.aborted) return;
      activeCompanyController = null;
      console.error(`Erreur lors de la récupération des données pour ${symbol}:`, error);
      const detail = error?.message ? ` ${error.message}` : '';
      setCompanyStatus(`Impossible de récupérer les données financières pour ${symbol}.${detail}`, 'error');
    }
  };

  const handleResize = () => {
    if (!companyModuleReady) return;
    renderCharts(currentHistory.length ? currentHistory : []);
  };

  async function askFinanceQuestion() {
    const questionInput =
      document.getElementById('questionInput') ||
      document.querySelector('[data-role="question-input"]');
    const resultContainer = document.getElementById('result');
    if (!resultContainer) return;

    const userInput = questionInput?.value.trim();
    if (!userInput) {
      resultContainer.textContent = 'Veuillez saisir une question.';
      return;
    }

    resultContainer.textContent = 'Analyse de la loi en cours…';

    try {
      const data = await sendQuestionRaw(userInput);
      renderResult(resultContainer, data);
    } catch (error) {
      console.error('Erreur finance QA:', error);
      resultContainer.textContent = `Erreur lors de la récupération des données: ${error.message}`;
    }
  }

  const init = () => {
    setupMainQuestionForm();
    setupChatbot();
    initCompanyElements();
    initViewLayouts();
    showChatView();
    if (companyModuleReady) {
      resetCompanyMeta();
      window.addEventListener('resize', handleResize);
    }
    loadTopCompanies();
  };

  window.displayCompanyFromSearch = displayCompanyFromSearch;
  window.askFinanceQuestion = askFinanceQuestion;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
