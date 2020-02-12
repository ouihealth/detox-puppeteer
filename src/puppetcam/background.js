/* global chrome, MediaRecorder, FileReader */

let recorder = null;
let filename = null;

chrome.runtime.onConnect.addListener(port => {
  port.onMessage.addListener(msg => {
    switch (msg.type) {
      case 'SET_EXPORT_PATH':
        filename = msg.filename
        break
      case 'REC_STOP':
        // port.postMessage(`REC_STOP - ${!!recorder}`)
        recorder.stop()    
        recorder = null;    
        break
      case 'REC_START':
        // port.postMessage(`REC_START - ${!!recorder}`)
        navigator.mediaDevices.getDisplayMedia().then(stream => {
          const chunks = [];
          recorder = new MediaRecorder(stream, {
            videoBitsPerSecond: 2500000,
            ignoreMutedMedia: true,
            mimeType: 'video/webm'
          });
          recorder.ondataavailable = function (event) {
            if (event.data.size > 0) {
              chunks.push(event.data);
            }
          };

          recorder.onstop = function () {
            var superBuffer = new Blob(chunks, {
              type: 'video/webm'
            });

            var url = URL.createObjectURL(superBuffer);
            // var a = document.createElement('a');
            // a.href = url;
            // a.download = 'test.webm';
            // document.body.appendChild(a);
            // a.click();
            stream.getTracks().forEach(track => track.stop());

            chrome.downloads.download({
              url: url,
              filename: filename
            }, () => {});
          }

          recorder.start();
        }).catch((e) => {
          port.postMessage('ERROR getDisplayMedia' + e.toString());
        });

        break
      default:
        console.log('Unrecognized message', msg)
    }
  })

  chrome.downloads.onChanged.addListener(function(delta) {
    if (!delta.state ||(delta.state.current != 'complete')) {
      return;
    }
    try{
      port.postMessage({downloadComplete: true})
    }
    catch(e){}
  });

})
