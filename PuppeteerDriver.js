const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const log = require('../../utils/logger').child({ __filename });
const DeviceDriverBase = require('./DeviceDriverBase');
const InvocationManager = require('../../invoke').InvocationManager;
const invoke = require('../../invoke');

const temporaryPath = require('../../artifacts/utils/temporaryPath');
const SimulatorLogPlugin = require('../../artifacts/log/ios/SimulatorLogPlugin');
const PuppeteerScreenshotPlugin = require('../../artifacts/screenshot/PuppeteerScreenshotPlugin');
const PuppeteerRecordVideoPlugin = require('../../artifacts/video/PuppeteerRecordVideoPlugin');
const SimulatorInstrumentsPlugin = require('../../artifacts/instruments/ios/SimulatorInstrumentsPlugin');
const WebExpect = require('../../web/expect');

const puppeteer = require('puppeteer');
const Client = require('../../client/Client');
const { LoginTestee } = require('../../client/actions/actions');

function sleep(ms) {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}

function debug(label, ...args) {
  return;
  log.info(`PuppeteerDriver.${label}`, ...args);
}
function debugTestee(label, ...args) {
  return;
  log.info(`PuppeteerTestee.${label}`, ...args);
}

let enableSynchronization = true;
let browser, page;
let urlBlacklist = [];
class PuppeteerTestee {
  constructor(config) {
    debugTestee('PuppeteerTestee.constructor', config);
    this.configuration = config.client.configuration;
    this.client = new Client(this.configuration);
    this.inflightRequests = {};
    this.inflightRequestsSettledCallback = null;
    this.onRequest = this.onRequest.bind(this);
    this.removeInflightRequest = this.removeInflightRequest.bind(this);
  }

  async selectElementWithMatcher(...args) {
    debugTestee('selectElementWithMatcher', JSON.stringify(args, null, 2));
    const selectorArg = args.find((a) => a.method === 'selector');
    const timeoutArg = args.find((a) => a.method === 'option' && typeof a.args[0].timeout === 'number');
    const visibleArg = args.find((a) => a.method === 'option' && typeof a.args[0].visible === 'boolean');
    const indexArg = args.find((a) => a.method === 'index');
    let result = null;
    try {
      // This is a dummy waitFor because sometimes the JS thread is (apparently)
      // blocked and doesn't execute our element finding function a single time
      // before being able to run again.
      await page.waitFor(() => {
        return true;
      });
      result = await page.waitFor(
        ({ selectorArg, indexArg, visibleArg }) => {
          const xpath = selectorArg.args[0];
          const isContainMatcher = xpath.includes('contains(');
          // return document.querySelector(selectorArg ? selectorArg.args.join('') : 'body');
          // let candidates = Array.prototype.slice.apply(document.querySelectorAll(selectorArg ? selectorArg.args.join('') : 'body'), [0]);
          const iterator = document.evaluate(`//*${xpath}`, document.body);
          const elements = [];
          let maybeElement, lastMatch;
          while ((maybeElement = iterator.iterateNext())) {
            lastMatch = maybeElement;
            // xpaths matching on text match every parent in addition to the
            // element we actually care about so only take the element if it
            // is a leaf
            if (!isContainMatcher || maybeElement.children.length === 0) {
              elements.push(maybeElement);
            }
          }

          // do a reverse search to match iOS indexes
          const element = elements[indexArg ? elements.length - 1 - indexArg.args[0] : 0];
          if (visibleArg && visibleArg.args[0].visible === false && !element) {
            return true;
          }

          return element;
        },
        { timeout: timeoutArg ? timeoutArg.args[0].timeout : 200 },
        { visibleArg, selectorArg, indexArg }
      );
      if (visibleArg && visibleArg.args[0].visible === false) {
        const isVisible = await result.isIntersectingViewport();
        if (isVisible) throw new Error(`Element should not be visible: ${selectorArg.args[0]}`);
      }
    } catch (e) {
      if (visibleArg) {
        const shouldBeVisible = visibleArg.args[0].visible === true;
        if (shouldBeVisible) throw new Error(e.toString() + selectorArg.args[0]);
      }
      // console.warn(e);
    }

    return result;
  }

  async performAction(element, action) {
    debugTestee('performAction', action);
    if (action.method === 'replaceText') {
      await element.click();
      await page.keyboard.type(action.args[0]);
      return true;
    } else if (action.method === 'typeText') {
      await element.click();
      await page.keyboard.type(action.args[0]);
      return true;
    } else if (action.method === 'keyboardPress') {
      await element.click();
      await page.keyboard.press(action.args[0]);
      return true;
    } else if (action.method === 'clearText') {
      const elementValue = await element.evaluate((el) => el.value);
      await element.click();
      for (let i = 0; i < elementValue.length; i++) {
        await page.keyboard.press('Backspace');
      }
      return true;
    } else if (action.method === 'tap') {
      await element.tap();
      return true;
    } else if (action.method === 'tapAtPoint') {
      const box = await element.boundingBox();
      const x = box.x + action.args[0].x;
      const y = box.y + action.args[0].y;
      await page.touchscreen.tap(x, y);
      return true;
    } else if (action.method === 'longPress') {
      await element.evaluate(
        (el, { duration }) => {
          return new Promise((resolve) => {
            const boundingBox = el.getBoundingClientRect();
            const pageX = boundingBox.x + boundingBox.width / 2;
            const pageY = boundingBox.y + boundingBox.height / 2;
            const touch = new Touch({
              identifier: Date.now(),
              target: document,
              pageX: 600,
              pageY: 85
            });
            const start = new TouchEvent('touchstart', {
              cancelable: true,
              bubbles: true,
              touches: [touch],
              targetTouches: [],
              changedTouches: [touch]
            });
            const end = new TouchEvent('touchend', {
              cancelable: true,
              bubbles: true,
              touches: [touch],
              targetTouches: [],
              changedTouches: [touch]
            });

            el.dispatchEvent(start);

            setTimeout(() => {
              el.dispatchEvent(end);
              resolve();
            }, duration);
          });
        },
        { duration: action.args[0] }
      );
      return true;
    } else if (action.method === 'multiTap') {
      for (let i = 0; i < action.args[0]; i++) {
        await element.tap();
      }
      return true;
    } else if (action.method === 'scroll') {
      const direction = action.args[0];
      const pixels = action.args[1];

      // TODO handle all options
      let top = 0;
      let left = 0;
      if (direction === 'down') {
        top = pixels;
      } else if (direction === 'up') {
        top = -pixels;
      } else if (direction === 'right') {
        left = pixels;
      } else if (direction === 'left') {
        left = -pixels;
      }

      await element.evaluate(
        (el, scrollOptions) => {
          el.scrollBy(scrollOptions);
        },
        { top, left }
      );
      return true;
    } else if (action.method === 'scrollTo') {
      const edge = action.args[0];

      let top = 0;
      let left = 0;
      if (edge === 'bottom') {
        top = 10000;
      } else if (edge === 'top') {
        top = -10000;
      } else if (edge === 'left') {
        left = -10000;
      } else if (edge === 'right') {
        left = 10000;
      }

      await element.evaluate(
        (el, scrollOptions) => {
          el.scrollBy(scrollOptions);
        },
        { top, left }
      );
      return true;
    } else if (action.method === 'swipe') {
      const direction = action.args[0];
      const speed = action.args[1];
      const percentage = action.args[2];

      // TODO handle all options
      let top = 0;
      let left = 0;
      if (direction === 'up') {
        top = 10000;
      } else if (direction === 'down') {
        top = -10000;
      } else if (direction === 'left') {
        left = 10000;
      } else if (direction === 'right') {
        left = -10000;
      }

      await element.evaluate(
        (el, scrollOptions) => {
          el.scrollBy(scrollOptions);
        },
        { top, left }
      );
      return true;
    }

    // await element.evaluate((el, action) => {
    //   console.log(el, action);
    // });

    throw new Error('action not performed: ' + JSON.stringify(action));
  }

  async assertWithMatcher(element, matcher) {
    debugTestee('assertWithMatcher', matcher);
    const isExists = !!element;
    const isVisibleMatcher = matcher.method === 'option' && matcher.args[0].visible === true;
    const isNotVisibleMatcher = matcher.method === 'option' && matcher.args[0].visible === false;
    const isExistsMatcher = matcher.method === 'option' && matcher.args[0].exists === true;
    const isNotExistsMatcher = matcher.method === 'option' && matcher.args[0].exists === false;
    debugTestee('assertWithMatcher', { isExists, isVisibleMatcher, isNotVisibleMatcher, isExistsMatcher, isNotExistsMatcher });

    let result = true;
    if (isVisibleMatcher || isNotVisibleMatcher) {
      const isVisible = isExists ? await element.isIntersectingViewport() : false;
      if (isVisibleMatcher && !isVisible) {
        result = false;
      }
      if (isNotVisibleMatcher && isVisible) {
        result = false;
      }
    }
    if (isExistsMatcher || isNotExistsMatcher) {
      if (isExistsMatcher && !isExists) {
        result = false;
      }
      if (isNotExistsMatcher && isExists) {
        result = false;
      }
    }

    if (matcher.method === 'selector') {
      result = await element.evaluate((el, selector) => {
        const iterator = document.evaluate(`//*${selector}`, el);
        return !!iterator.iterateNext();
      }, matcher.args[0]);
    }

    debugTestee('/assertWithMatcher', { result });

    if (!result) throw new Error('assertion failed');
    return result;
  }

  async invoke(params) {
    debugTestee('invoke', JSON.stringify(params, null, 2));
    const promises = params.args.map((arg) => {
      // debugTestee('arg', arg);
      if (arg.type === 'Invocation') {
        return this.invoke(arg.value);
      }
      return arg;
    });

    const args = await Promise.all(promises)
    if (params.target === 'this' || params.target.type === 'this') {
      const result = await this[params.method](...args);
      debugTestee('result?', params.method, !!result);
      return result;
    }

    return params;
  }

  async setupNetworkSynchronization() {
    page.on('request', this.onRequest);
    page.on('requestfinished', this.removeInflightRequest);
    page.on('requestfailed', this.removeInflightRequest);
  }

  async teardownNetworkSynchronization() {
    page.removeListener('request', this.onRequest);
    page.removeListener('requestfinished', this.removeInflightRequest);
    page.removeListener('requestfailed', this.removeInflightRequest);
  }

  async synchronizeNetwork() {
    return new Promise(resolve => {
      if (Object.keys(this.inflightRequests).length === 0) {
        resolve();
        return;
      }
      // We use debounce because some new requests may fire immediately after
      // the last one outstanding resolves. We prefer to let the requests settle
      // before considering the network "synchronized"
      this.inflightRequestsSettledCallback = _.debounce(() => {
        this.inflightRequestsSettledCallback = null;
        this.synchronizeNetwork().then(resolve);
      }, 200);
    });
  }

  removeInflightRequest(request) {
    // debugTestee('offRequest', request.uid);
    delete this.inflightRequests[request.uid];
    if (Object.keys(this.inflightRequests).length === 0) {
      if (this.inflightRequestsSettledCallback) this.inflightRequestsSettledCallback();
    }
  }

  onRequest(request) {
    request.uid = Math.random();
    const url = request.url();
    // debugTestee('onRequest', request.uid, url, request.postData());
    const isIgnored = urlBlacklist.some((candidate) => {
      return url.match(new RegExp(candidate));
    });
    if (!isIgnored) {
      this.inflightRequests[request.uid] = true;
    }
  };

  async connect() {
    // this.client.ws.on('error', (e) => {
    //   console.error(e);
    // });

    // this.client.ws.on('close', () => {
    //   console.log('close');
    // });

    const client = await page.target().createCDPSession();
    await client.send('Animation.enable');

    /* animation synchronization */
    let animationTimeById = {};
    client.on('Animation.animationStarted', ({ animation }) => {
      // console.log('Animation started id=', animation.id)
      // console.log(animation)
      animationTimeById[animation.id] = animation.source.duration;
    });
    client.on('Animation.animationCancelled', ({ id }) => {
      // console.log('animationCancelled', id);
      delete animationTimeById[id];
    });
    /* end animation synchronization */

    await this.client.ws.open();
    this.client.ws.ws.on('message', async (str) => {
      // https://github.com/wix/Detox/blob/ca620e760747ade9cb673c28262200b02e8e8a5d/docs/Troubleshooting.Synchronization.md#settimeout-and-setinterval
      async function setupDetoxTimeouts() {
        await page.evaluate(() => {
          if (!window._detoxOriginalSetTimeout) window._detoxOriginalSetTimeout = window.setTimeout;
          if (!window._detoxOriginalClearTimeout) window._detoxOriginalClearTimeout = window.clearTimeout;
          if (!window._detoxTimeouts) window._detoxTimeouts = {};
          window.setTimeout = (callback, ms) => {
            const stack = new Error().stack;
            const isPuppeteerTimeout = stack.includes("waitForPredicatePageFunction");
            if (isPuppeteerTimeout) {
              window._detoxOriginalSetTimeout(callback, ms);
              return;
            }

            const timeout = window._detoxOriginalSetTimeout(() => {
              delete window._detoxTimeouts[timeout];
              callback();
            }, ms);
            window._detoxTimeouts[timeout] = true;
          };
          window.clearTimeout = (timeout) => {
            delete window._detoxTimeouts[timeout];
            window._detoxOriginalClearTimeout(timeout);
          };
        });
      }

      try {
        // TODO figure out why we need a try catch here. Sometimes it errors as "Target closed"
        // Also firebase uses a setTimeout on repeat which doesn't seem compatible with timeout logic
        // https://github.com/firebase/firebase-js-sdk/blob/6b53e0058483c9002d2fe56119f86fc9fb96b56c/packages/auth/src/storage/indexeddb.js#L644
        // setupDetoxTimeouts();
      }
      catch (e) {
        // console.warn(e);
      }

      // Always teardown + setup in case we created a new page object since
      // the last action
      await this.teardownNetworkSynchronization();
      await this.setupNetworkSynchronization();

      const sendResponse = async (response, options = {}) => {
        debugTestee('sendResponse', response);
        const performSynchronization = enableSynchronization && !options.skipSynchronization;
        const sendResponsePromise = performSynchronization
          ? this.synchronizeNetwork()
          : Promise.resolve();

        const animationsSettledPromise = performSynchronization ? new Promise(resolve => {
          const interval = setInterval(() => {
            Object.entries(animationTimeById).forEach(async ([id, duration]) => {
              let result = { currentTime: null };
              try {
                result = await client.send('Animation.getCurrentTime', {
                  'id': id,
                });
                // if this call errors out, just assume the animation is done
              } catch (e) {}
              if (result.currentTime === null || result.currentTime > duration) {
                delete animationTimeById[id];
              }
            });
            if (Object.keys(animationTimeById).length === 0) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        }) : Promise.resolve();

        return sendResponsePromise
          .then(() => animationsSettledPromise)
          .then(() => {
            if (!performSynchronization) return;
            return page.waitFor(() => {
              return Object.keys(window._detoxTimeouts || {}).length === 0;
            });
          })
          .then(() => this.client.ws.ws.send(JSON.stringify(response)));
      };

      let messageId;
      try {
        const action = JSON.parse(str);
        messageId = action.messageId;
        debugTestee('PuppeteerTestee.message', JSON.stringify(action, null, 2));
        if (!action.type) {
          return;
        }
        if (action.type === 'loginSuccess') {
          return;
        } else if (action.type === 'deliverPayload') {
          if (action.params && action.params.url) {
            await page.goto(action.params.url, { waitUntil: 'networkidle2' });
            // await setupDetoxTimeouts();
          }
          await sendResponse({ type: 'deliverPayloadDone', messageId: action.messageId });
        } else if (action.type === 'currentStatus') {
          await sendResponse({ type: 'currentStatusResult', params: { resources: [] } }, { skipSynchronization: true });
        } else {
          try {
            if (enableSynchronization) {
              await this.synchronizeNetwork();
            }
            const result = await this.invoke(action.params);
            if (result === false || result === null) throw new Error('invalid result');
            await sendResponse({ type: 'invokeResult', messageId: action.messageId });
          } catch (error) {
            this.client.ws.ws.send(JSON.stringify({ type: 'testFailed', messageId, params: { details: str + '\n' + error.message } }))
          }
        }
      } catch (error) {
        console.error(error);
        await sendResponse({ type: 'error', messageId: messageId, params: { error } });
        await browser.close();
        browser = null;
      }
    });

    await this.client.sendAction(new LoginTestee(this.configuration.sessionId));
  }
}

class PuppeteerDriver extends DeviceDriverBase {
  constructor(config) {
    super(config);
    debug('constructor', config);

    this.matchers = new WebExpect(new InvocationManager(this.client));
    this.testee = new PuppeteerTestee(config);
  }

  declareArtifactPlugins() {
    debug('declareArtifactPlugins');
    return {
      // instruments: (api) => new SimulatorInstrumentsPlugin({ api, client }),
      // log: (api) => new SimulatorLogPlugin({ api, appleSimUtils }),
      screenshot: (api) => new PuppeteerScreenshotPlugin({ api, driver: this }),
      video: (api) => new PuppeteerRecordVideoPlugin({ api, driver: this })
    };
  }

  createPayloadFile(notification) {
    const notificationFilePath = path.join(this.createRandomDirectory(), `payload.json`);
    fs.writeFileSync(notificationFilePath, JSON.stringify(notification, null, 2));
    return notificationFilePath;
  }

  async setURLBlacklist(urlList) {
    debug('TODO setURLBlacklist should go through client', urlList);
    urlBlacklist = urlList;
  }

  async enableSynchronization() {
    debug('TODO enableSynchronization should go through client');
    enableSynchronization = true;
  }

  async disableSynchronization() {
    debug('TODO disableSynchronization should go through client');
    enableSynchronization = false;
  }

  async shake(deviceId) {
    return await this.client.shake();
  }

  async setOrientation(deviceId, orientation) {
    const viewport = await page.viewport();
    const isLandscape = orientation === 'landscape';
    const largerDimension = Math.max(viewport.width, viewport.height);
    const smallerDimension = Math.min(viewport.width, viewport.height);
    await page.setViewport({
      ...viewport,
      isLandscape,
      width: isLandscape ? largerDimension : smallerDimension,
      height: isLandscape ? smallerDimension : largerDimension,
    });
  }

  getPlatform() {
    return 'web';
  }

  async prepare() {
    // const detoxFrameworkPath = await environment.getFrameworkPath();
    // if (!fs.existsSync(detoxFrameworkPath)) {
    //   throw new Error(`${detoxFrameworkPath} could not be found, this means either you changed a version of Xcode or Detox postinstall script was unsuccessful.
    //   To attempt a fix try running 'detox clean-framework-cache && detox build-framework-cache'`);
    // }
  }

  async recordVideo(deviceId) {
    await page.evaluate(filename=>{
      window.postMessage({ type: 'REC_START' }, '*')
    })
  }

  async stopVideo(deviceId) {
    const exportname = `puppet${Math.random()}.webm`
    await page.evaluate(filename=>{
      window.postMessage({type: 'SET_EXPORT_PATH', filename: filename}, '*')
      window.postMessage({type: 'REC_STOP'}, '*')
    }, exportname)
    // try{
    // console.log("waitForSelector");
      await page.waitForSelector('html.downloadComplete', { timeout: 5000 });
    // } catch (e) {
      // noop. This waitFor could fail if the page navigates away before
      // detecting the download
    // }
    // console.log("after DL");
    // TODO use generic chrome downloads path
    return path.join('/Users/awinograd/Downloads', exportname);
  }

  async cleanup(deviceId, bundleId) {
    debug('TODO cleanup', { deviceId, bundleId, browser: !!browser });
    // await sleep(100000);

    if (browser) {
      await browser.close();
      browser = null;
    }
    // await this.deviceRegistry.disposeDevice(deviceId);
    await super.cleanup(deviceId, bundleId);
  }

  async acquireFreeDevice(deviceQuery) {
    debug('PuppeteerDriver.acquireFreeDevice', deviceQuery);
    return '';
    // const udid = await this.deviceRegistry.allocateDevice(async () => {
    //   return await this._findOrCreateDevice(deviceQuery);
    // });

    // const deviceComment = this._commentDevice(deviceQuery);
    // if (!udid) {
    //   throw new Error(`Failed to find device matching ${deviceComment}`);
    // }

    // await this._boot(udid);
    // this._name = `${udid} ${deviceComment}`;
    // return udid;
  }

  async getBundleIdFromBinary(appPath) {
    debug('PuppeteerDriver.getBundleIdFromBinary', appPath);
    return '';
    // try {
    //   const result = await exec(`/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "${path.join(appPath, 'Info.plist')}"`);
    //   const bundleId = _.trim(result.stdout);
    //   if (_.isEmpty(bundleId)) {
    //     throw new Error();
    //   }
    //   return bundleId;
    // } catch (ex) {
    //   throw new Error(`field CFBundleIdentifier not found inside Info.plist of app binary at ${appPath}`);
    // }
  }

  async _boot(deviceId) {
    debug('PuppeteerDriver.boot', { deviceId, bundleId });
    const deviceLaunchArgs = argparse.getArgValue('deviceLaunchArgs');
    const coldBoot = await this.applesimutils.boot(deviceId, deviceLaunchArgs);
    await this.emitter.emit('bootDevice', { coldBoot, deviceId });
  }

  async installApp(deviceId, binaryPath) {
    debug('installApp', { deviceId, binaryPath });
    // await this.applesimutils.install(deviceId, binaryPath);
  }

  async uninstallApp(deviceId, bundleId) {
    debug('uninstallApp', { deviceId, bundleId });
    await this.emitter.emit('beforeUninstallApp', { deviceId, bundleId });
    if (browser) {
      await browser.close();
      browser = null;
    }
  }

  async launchApp(deviceId, bundleId, launchArgs, languageAndLocale) {
    debug('launchApp', { browser: !!browser, deviceId, bundleId, launchArgs, languageAndLocale });
    await this.emitter.emit('beforeLaunchApp', { bundleId, deviceId, launchArgs });

    const extensionDirectory = "/Users/awinograd/programming/puppetcam";
    browser = browser || await puppeteer.launch({
      devtools: false,
      headless: true,
      defaultViewport:  launchArgs.viewport || this._getDefaultViewport(),
      // ignoreDefaultArgs: ['--enable-automation'], // works, but shows "not your default browser toolbar"
      args: [
        '--no-sandbox',
        '--enable-usermedia-screen-capturing',
        '--allow-http-screen-capture',
        '--allow-file-access-from-files',
        '--auto-select-desktop-capture-source=puppetcam',
        '--load-extension=' + extensionDirectory,
        '--disable-extensions-except=' + extensionDirectory,
      ]
    });
    this._applyPermissions();

    const url = launchArgs.detoxURLOverride || this.deviceConfig.binaryPath.slice(1);
    if (url) {
      page = (await browser.pages())[0];
      await page.goto(url, { waitUntil: 'networkidle2' });
    }
    // const pid = await this.applesimutils.launch(deviceId, bundleId, launchArgs, languageAndLocale);
    const pid = 'PID';
    await this.emitter.emit('launchApp', { bundleId, deviceId, launchArgs, pid });

    return pid;
  }

  _getDefaultViewport() {
    return this.deviceConfig && this.deviceConfig.defaultViewport
      ? this.deviceConfig.defaultViewport
      : { width: 1280, height: 720 };
  }

  async terminate(deviceId, bundleId) {
    debug('terminate', { deviceId, bundleId });
    await this.emitter.emit('beforeTerminateApp', { deviceId, bundleId });
    if (browser) {
      await browser.close();
      browser = null;
    }
    // await this.applesimutils.terminate(deviceId, bundleId);
    await this.emitter.emit('terminateApp', { deviceId, bundleId });
  }

  async sendToHome(deviceId) {
    await page.goto('https://google.com')
  }

  async shutdown(deviceId) {
    await this.emitter.emit('beforeShutdownDevice', { deviceId });
    await this.applesimutils.shutdown(deviceId);
    await this.emitter.emit('shutdownDevice', { deviceId });
  }

  async setLocation(deviceId, latitude, longitude) {
    await page.setGeolocation({
      latitude: Number.parseFloat(latitude),
      longitude: Number.parseFloat(longitude),
    });
  }

  async setPermissions(deviceId, bundleId, permissions) {
    debug('setPermissions', { deviceId, bundleId, permissions });
    const PERMISSIONS_LOOKUP = {
      // calendar: '',
      camera: 'camera',
      // contacts: '',
      // faceid: '',
      // health: '',
      // homekit: '',
      location: 'geolocation',
      // medialibrary: '',
      microphone: 'microphone',
      // motion: '',
      notifications: 'notifications',
      // photos: '',
      // reminders: '',
      // siri: '',
      // speech: '',
    }
    this.requestedPermissions = [];
    const requestedPermissions = Object.entries(permissions).filter(([key, value]) => {
      return !['NO', 'unset', 'never', ''].includes(value || '');
    })
      .map(([key]) => PERMISSIONS_LOOKUP[key])
      .filter(equivalentPermission => !!equivalentPermission);
    this.requestedPermissions = requestedPermissions;
  }

  async _applyPermissions(deviceId, bundleId) {
    if (browser && this.requestedPermissions) {
      const context = browser.defaultBrowserContext();
      await context.clearPermissionOverrides();
      const url = await page.url();
      await context.overridePermissions(new URL(url).origin, this.requestedPermissions)
    }
  }

  async clearKeychain(deviceId) {
    await this.applesimutils.clearKeychain(deviceId);
  }

  async resetContentAndSettings(deviceId) {
    await this.shutdown(deviceId);
    await this.applesimutils.resetContentAndSettings(deviceId);
    await this._boot(deviceId);
  }

  validateDeviceConfig(deviceConfig) {
    this.deviceConfig = deviceConfig;
    debug('validateDeviceConfig', deviceConfig);
    if (!deviceConfig.binaryPath) {
      console.error('PuppeteerDriver requires binaryPath to be set in detox config in the format `/${URL}`');
      configuration.throwOnEmptyBinaryPath();
    }
  }

  getLogsPaths(deviceId) {
    return this.applesimutils.getLogsPaths(deviceId);
  }

  async waitForBackground() {
    debug('TODO waitForBackground');
    // return await this.client.waitForBackground();
    return Promise.resolve('');
  }

  async takeScreenshot(udid, screenshotName) {
    const tempPath = await temporaryPath.for.png();
    await page.screenshot({ path: tempPath });

    await this.emitter.emit('createExternalArtifact', {
      pluginId: 'screenshot',
      artifactName: screenshotName,
      artifactPath: tempPath
    });

    return tempPath;
  }

  async setStatusBar(deviceId, flags) {
    // await this.applesimutils.statusBarOverride(deviceId, flags);
  }

  async resetStatusBar(deviceId) {
    // await this.applesimutils.statusBarReset(deviceId);
  }

  async waitUntilReady() {
    await this.testee.connect();
  }

  async reloadReactNative() {
    const url = this.deviceConfig.binaryPath.slice(1);
    if (url) {
      page = (await browser.pages())[0];
      await page.goto(url, { waitUntil: 'networkidle2' });
    }
  }
}

module.exports = PuppeteerDriver;
