window.onload = () => {
  if (window.recorderInjected) return;
  Object.defineProperty(window, 'recorderInjected', { value: true, writable: false });
  // Setup message passing
  const port = chrome.runtime.connect(chrome.runtime.id);
  port.onMessage.addListener((msg) => window.postMessage(msg, '*'));
  window.addEventListener('message', (event) => {
    if (!event.data) return;
    // Relay client messages
    if (event.source === window && event.data.type) {
      if (event.data.type === 'REC_START') {
        document.querySelector('body').classList.add('detox-puppeteer-recording');
      }
      port.postMessage(event.data);
    }
    if (event.data.downloadComplete) {
      document.querySelector('body').classList.remove('detox-puppeteer-recording');
      document.querySelector('html').classList.add('detox-puppeteer-downloadComplete');
    }
  });

  document.title = 'puppetcam';
  // window.postMessage({ type: 'REC_START' }, '*')
};
