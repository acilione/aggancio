(() => {
  const token = __COMMONS_TOKEN__;
  const attach = () => {
    const footer = document.querySelector('.main-footer');
    if (!footer) return false;
    const button = document.createElement('button');
    button.className = 'text-button';
    button.textContent = 'Quit local app';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await fetch('/_commons/quit', { method: 'POST', headers: { 'X-Commons-Token': token } });
        if (!response.ok) throw new Error('Server could not stop');
        document.body.replaceChildren();
        const message = document.createElement('main');
        message.style.cssText = 'max-width:640px;margin:15vh auto;padding:24px;font:18px system-ui';
        const heading = document.createElement('h1');
        heading.textContent = 'Commons is closed';
        const detail = document.createElement('p');
        detail.textContent = 'Your drafts remain in this browser. You can close this tab. Open the Commons application again to return.';
        message.append(heading, detail); document.body.append(message);
      } catch {
        button.disabled = false; button.textContent = 'Could not stop — retry';
      }
    });
    footer.append(button);
    return true;
  };
  if (!attach()) {
    const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
