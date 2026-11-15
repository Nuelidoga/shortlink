const form = document.getElementById('shorten-form');
const input = document.getElementById('url-input');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortUrlEl = document.getElementById('short-url');
const copyBtn = document.getElementById('copy-btn');
const linksBody = document.getElementById('links-body');

const shortUrlFor = (code) => `${window.location.origin}/${code}`;

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function cell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text; // textContent avoids HTML injection
  return td;
}

async function loadLinks() {
  try {
    const res = await fetch('/api/links');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const links = await res.json();

    linksBody.replaceChildren();
    if (links.length === 0) {
      const row = document.createElement('tr');
      const td = cell('No links yet. Create the first one above.', 'muted');
      td.colSpan = 3;
      row.append(td);
      linksBody.append(row);
      return;
    }

    for (const link of links) {
      const row = document.createElement('tr');

      const codeTd = document.createElement('td');
      const a = document.createElement('a');
      a.href = shortUrlFor(link.code);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `/${link.code}`;
      codeTd.append(a);

      const urlTd = cell(link.originalUrl, 'url');
      urlTd.title = link.originalUrl;

      row.append(codeTd, urlTd, cell(String(link.clicks), 'num'));
      linksBody.append(row);
    }
  } catch (err) {
    linksBody.replaceChildren();
    const row = document.createElement('tr');
    const td = cell('Could not load links. Is the API running?', 'muted');
    td.colSpan = 3;
    row.append(td);
    linksBody.append(row);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  resultEl.hidden = true;

  try {
    const res = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Something went wrong.');
      return;
    }

    const shortUrl = shortUrlFor(data.code);
    shortUrlEl.href = shortUrl;
    shortUrlEl.textContent = shortUrl;
    resultEl.hidden = false;
    input.value = '';
    loadLinks();
  } catch {
    showError('Could not reach the server. Please try again.');
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shortUrlEl.textContent);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
});

loadLinks();
