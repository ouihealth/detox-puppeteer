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
      port.postMessage(event.data);
    }
    if (event.data.downloadComplete) {
      document.querySelector('html').classList.add('downloadComplete');
    }
  });

  document.title = 'puppetcam';
  // window.postMessage({ type: 'REC_START' }, '*')
};
