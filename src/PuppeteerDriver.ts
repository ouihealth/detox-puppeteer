import * as _ from 'lodash';
const path = require('path');
const fs = require('fs');
const os = require('os');
const Xvfb = require('xvfb');

const log = require('detox/src/utils/logger').child({ __filename });
const DeviceDriverBase = require('detox/src/devices/drivers/DeviceDriverBase');
const temporaryPath = require('detox/src/artifacts/utils/temporaryPath');
const Client = require('detox/src/client/Client');

import * as puppeteer from 'puppeteer';
import WebExpect from './expect';
import PuppeteerScreenshotPlugin from './PuppeteerScreenshotPlugin';
import PuppeteerRecordVideoPlugin from './PuppeteerRecordVideoPlugin';
import LoginTestee from './LoginTesteeAction';

const displayNum = process.env.JEST_WORKER_ID
  ? 100 + Number.parseInt(process.env.JEST_WORKER_ID, 10)
  : undefined;
const xvfb = new Xvfb({ silent: true, displayNum });
const EXTENSION_DIRECTORY = path.join(__dirname, '../puppetcam');
const TOOLBAR_SIZE = 124; // size of automated chrome + recording screen toolbars + url bar
const NETWORKIDLE = 'networkidle0';

// @ts-ignore
function sleep(ms: number) {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}

let rando = Math.random();
function debug(label: string, ...args: any[]) {
  log.debug(`${rando} PuppeteerDriver.${label}`, ...args);
}
function debugTestee(label: string, ...args: any[]) {
  log.debug(`${rando} PuppeteerTestee.${label}`, ...args);
}

let enableSynchronization = true;
let browser: puppeteer.Browser | null;
let page: puppeteer.Page | null;
let urlBlacklist: string[] = [];
let pendingExport: string | null = null;
let isRecording = false;
let disableTouchIndicators = false;
let recordVideo = false;

// https://gist.github.com/aslushnikov/94108a4094532c7752135c42e12a00eb
async function setupTouchIndicators() {
  await page?.evaluate(() => {
    if ((window as any).__detox_puppeteer_mouse_pointer) return;
    (window as any).__detox_puppeteer_mouse_pointer = true;
    const box = document.createElement('puppeteer-mouse-pointer');
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
      puppeteer-mouse-pointer {
        pointer-events: none;
        position: absolute;
        top: 0;
        z-index: 10000;
        left: 0;
        width: 20px;
        height: 20px;
        background: rgba(0,0,0,.4);
        border: 1px solid white;
        border-radius: 10px;
        margin: -10px 0 0 -10px;
        padding: 0;
        transition: background .2s, border-radius .2s, border-color .2s;
      }
      puppeteer-mouse-pointer.button-1 {
        transition: none;
        background: rgba(0,0,0,0.9);
      }
      puppeteer-mouse-pointer.button-2 {
        transition: none;
        border-color: rgba(0,0,255,0.9);
      }
      puppeteer-mouse-pointer.button-3 {
        transition: none;
        border-radius: 4px;
      }
      puppeteer-mouse-pointer.button-4 {
        transition: none;
        border-color: rgba(255,0,0,0.9);
      }
      puppeteer-mouse-pointer.button-5 {
        transition: none;
        border-color: rgba(0,255,0,0.9);
      }
    `;
    document.head.appendChild(styleElement);
    document.body.appendChild(box);
    document.addEventListener(
      'mousemove',
      (event) => {
        box.style.left = event.pageX + 'px';
        box.style.top = event.pageY + 'px';
        updateButtons(event.buttons);
      },
      true,
    );
    document.addEventListener(
      'mousedown',
      (event) => {
        updateButtons(event.buttons);
        box.classList.add('button-' + event.which);
      },
      true,
    );
    document.addEventListener(
      'mouseup',
      (event) => {
        updateButtons(event.buttons);
        box.classList.remove('button-' + event.which);
      },
      true,
    );
    function updateButtons(buttons) {
      for (let i = 0; i < 5; i++) box.classList.toggle('button-' + i, !!(buttons & (1 << i)));
    }
  });
}

class PuppeteerTestee {
  configuration: any;
  client: typeof Client;
  inflightRequests: { [key: string]: boolean };
  inflightRequestsSettledCallback: (() => void) | null;

  constructor(config) {
    debugTestee('PuppeteerTestee.constructor', config);
    this.configuration = config.client.configuration;
    this.client = new Client(this.configuration);
    this.inflightRequests = {};
    this.inflightRequestsSettledCallback = null;
    this.onRequest = this.onRequest.bind(this);
    this.removeInflightRequest = this.removeInflightRequest.bind(this);
    this.clearInflightRequests = this.clearInflightRequests.bind(this);
  }

  async selectElementWithMatcher(...args: any[]) {
    debugTestee('selectElementWithMatcher', JSON.stringify(args, null, 2));
    const selectorArg = args.find((a) => a.method === 'selector');
    const timeoutArg = args.find(
      (a) => a.method === 'option' && typeof a.args[0].timeout === 'number',
    );
    const visibleArg = args.find(
      (a) => a.method === 'option' && typeof a.args[0].visible === 'boolean',
    );
    const indexArg = args.find((a) => a.method === 'index');
    let result: puppeteer.JSHandle | null = null;

    let bodyHTML = await page?.evaluate(() => document.body.innerHTML);
    let availableTestIds = await page?.evaluate(() =>
      Array.prototype.slice
        .call(document.querySelectorAll('[data-testid]'))
        .map((n) => n.attributes['data-testid'].nodeValue),
    );

    try {
      // This is a dummy waitFor because sometimes the JS thread is (apparently)
      // blocked and doesn't execute our element finding function a single time
      // before being able to run again.
      await page!.waitForFunction(() => {
        return true;
      });
      result = await page!.waitForFunction(
        ({ selectorArg, indexArg, visibleArg }) => {
          const xpath = selectorArg.args[0];
          const isContainMatcher = xpath.includes('contains(');
          // return document.querySelector(selectorArg ? selectorArg.args.join('') : 'body');
          // let candidates = Array.prototype.slice.apply(document.querySelectorAll(selectorArg ? selectorArg.args.join('') : 'body'), [0]);
          const iterator = document.evaluate(`//*${xpath}`, document.body);
          const elements = [];
          // @ts-ignore
          let maybeElement, lastMatch;
          while ((maybeElement = iterator.iterateNext())) {
            lastMatch = maybeElement;
            // xpaths matching on text match every parent in addition to the
            // element we actually care about so only take the element if it
            // is a leaf
            if (!isContainMatcher || maybeElement.children.length === 0) {
              // @ts-ignore
              elements.push(maybeElement);
            }
          }
          // Sometimes we use contains in a compound matcher and skip a valid result
          // To recover, we take the last match if we did have a match but nothing was added to elements
          // @ts-ignore
          if (isContainMatcher && elements.length === 0 && lastMatch) elements.push(lastMatch);

          // https://github.com/puppeteer/puppeteer/blob/49f25e2412fbe3ac43ebc6913a582718066486cc/experimental/puppeteer-firefox/lib/JSHandle.js#L190-L204
          function isIntersectingViewport(el) {
            return new Promise<number>((resolve) => {
              const observer = new IntersectionObserver((entries) => {
                resolve(entries[0].intersectionRatio);
                observer.disconnect();
              });
              observer.observe(el);
              // Firefox doesn't call IntersectionObserver callback unless
              // there are rafs.
              requestAnimationFrame(() => {});
            }).then((visibleRatio) => visibleRatio > 0);
          }

          // do a reverse search to match iOS indexes
          const element = elements[indexArg ? elements.length - 1 - indexArg.args[0] : 0];
          if (visibleArg) {
            if (visibleArg.args[0].visible === false) {
              if (element) {
                return !isIntersectingViewport(element);
              } else {
                return true;
              }
            } else if (visibleArg.args[0].visible === true) {
              if (element) {
                return isIntersectingViewport(element) ? element : false;
              }
            }
          }

          return element;
        },
        { timeout: timeoutArg ? timeoutArg.args[0].timeout : 200 },
        { visibleArg, selectorArg, indexArg },
      );

      if (!result) {
        debugTestee('selectElementWithMatcher no result (pre-check)', {
          bodyHTML: bodyHTML,
          availableTestIds: availableTestIds,
        });
        debugTestee(
          'selectElementWithMatcher no result (post-check)',
          await page?.evaluate(() => document.body.innerHTML),
          {
            availableTestIds: await page?.evaluate(() =>
              Array.prototype.slice
                .call(document.querySelectorAll('[data-testid]'))
                .map((n) => n.attributes['data-testid'].nodeValue),
            ),
          },
        );
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

  async performAction(element: puppeteer.ElementHandle | undefined, action: any) {
    debugTestee('performAction', action);

    if (!element) {
      debugTestee('performAction DOM', await page?.evaluate(() => document.body.innerHTML), {
        availableTestIds: await page?.evaluate(() =>
          Array.prototype.slice
            .call(document.querySelectorAll('[data-testid]'))
            .map((n) => n.attributes['data-testid'].nodeValue),
        ),
      });
      throw new Error('performing action on undefined element');
    }

    async function clickIfUnfocused() {
      const isFocused = await element?.evaluate((el) => document.activeElement === el);
      if (!isFocused) {
        await element?.click();
      }
    }

    if (action.method === 'replaceText') {
      await clickIfUnfocused();
      await element.evaluate((el) => (el.value = ''));
      await page!.keyboard.type(action.args[0]);
      return true;
    } else if (action.method === 'typeText') {
      await clickIfUnfocused();
      await page!.keyboard.type(action.args[0]);
      return true;
    } else if (action.method === 'keyboardPress') {
      await clickIfUnfocused();
      await page!.keyboard.press(action.args[0]);
      return true;
    } else if (action.method === 'clearText') {
      const elementValue = await element.evaluate((el) => el.value);
      await clickIfUnfocused();
      for (let i = 0; i < elementValue.length; i++) {
        await page!.keyboard.press('Backspace');
      }
      return true;
    } else if (action.method === 'tap') {
      await element.tap();
      return true;
    } else if (action.method === 'tapAtPoint') {
      const box = (await element.boundingBox())!;
      const x = box.x + action.args[0].x;
      const y = box.y + action.args[0].y;
      await page!.touchscreen.tap(x, y);
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
              pageX,
              pageY,
            });
            const start = new TouchEvent('touchstart', {
              cancelable: true,
              bubbles: true,
              touches: [touch],
              targetTouches: [],
              changedTouches: [touch],
            });
            const end = new TouchEvent('touchend', {
              cancelable: true,
              bubbles: true,
              touches: [touch],
              targetTouches: [],
              changedTouches: [touch],
            });

            el.dispatchEvent(start);

            setTimeout(() => {
              el.dispatchEvent(end);
              // @ts-ignore
              resolve();
            }, duration);
          });
        },
        { duration: action.args[0] },
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
        { top, left },
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
        { top, left },
      );
      return true;
    } else if (action.method === 'swipe') {
      const direction = action.args[0];
      // const speed = action.args[1];
      const percentageOfScreenToSwipe = action.args[2] ?? 0.5;
      const normalizedStartingPointX = action.args[3] ?? 0.5;
      const normalizedStartingPointY = action.args[4] ?? 0.5;

      const { width, height } = page!.viewport()!;
      let top = 0;
      let left = 0;

      if (direction === 'up') {
        top = -height * percentageOfScreenToSwipe;
      } else if (direction === 'down') {
        top = height * percentageOfScreenToSwipe;
      } else if (direction === 'left') {
        left = -width * percentageOfScreenToSwipe;
      } else if (direction === 'right') {
        left = width * percentageOfScreenToSwipe;
      }

      const scrollable = await element.evaluate((el) => {
        return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
      });
      if (scrollable) {
        await element.evaluate(
          (el, scrollOptions) => {
            el.scrollBy(scrollOptions);
          },
          // we want to scroll in the opposite direction of the swipe. If we swipe down, we expect
          // the scroll down, decreasing scrollTop
          { top: top * -1, left: left * -1 },
        );
      } else {
        let result = (await element.boundingBox())!;
        await element.hover();
        await page!.mouse.down();
        await page!.mouse.move(
          result.x + result.width * normalizedStartingPointX + left,
          result.y + result.height * normalizedStartingPointY + top,
          { steps: 100 },
        );
        await page!.mouse.up();
      }
      return true;
    }

    throw new Error('action not performed: ' + JSON.stringify(action));
  }

  async assertWithMatcher(element, matcher) {
    debugTestee('assertWithMatcher', matcher);
    const isExists = !!element;
    const isVisibleMatcher = matcher.method === 'option' && matcher.args[0].visible === true;
    const isNotVisibleMatcher = matcher.method === 'option' && matcher.args[0].visible === false;
    const isExistsMatcher = matcher.method === 'option' && matcher.args[0].exists === true;
    const isNotExistsMatcher = matcher.method === 'option' && matcher.args[0].exists === false;
    debugTestee('assertWithMatcher', {
      isExists,
      isVisibleMatcher,
      isNotVisibleMatcher,
      isExistsMatcher,
      isNotExistsMatcher,
    });

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

    const args = await Promise.all(promises);
    if (params.target === 'this' || params.target.type === 'this') {
      const result = await this[params.method](...args);
      // a small delay between each invocation allows for more stable tests
      await sleep(30);
      debugTestee('result?', params.method, !!result);
      return result;
    }

    return params;
  }

  setupNetworkSynchronization() {
    // teardown before adding listeners to ensure we don't double subscribe to events
    browser!.removeListener('disconnected', this.clearInflightRequests);
    page!.removeListener('close', this.clearInflightRequests);
    page!.removeListener('request', this.onRequest);
    page!.removeListener('requestfinished', this.removeInflightRequest);
    page!.removeListener('requestfailed', this.removeInflightRequest);

    browser!.on('disconnected', this.clearInflightRequests);
    page!.on('close', this.clearInflightRequests);
    page!.on('request', this.onRequest);
    page!.on('requestfinished', this.removeInflightRequest);
    page!.on('requestfailed', this.removeInflightRequest);
  }

  async clearInflightRequests() {
    debugTestee('clearInflightRequests', this.inflightRequests);
    Object.keys(this.inflightRequests).forEach((key) => {
      this.removeInflightRequest({ uid: key });
    });
  }

  async synchronizeNetwork() {
    return new Promise<void>((resolve) => {
      debugTestee('inflightRequests', this.inflightRequests);
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
    debugTestee('offRequest', request.uid);
    delete this.inflightRequests[request.uid];
    if (Object.keys(this.inflightRequests).length === 0) {
      if (this.inflightRequestsSettledCallback) this.inflightRequestsSettledCallback();
    }
  }

  onRequest(request) {
    request.uid = Math.random();
    const url = request.url();
    const isIgnored = urlBlacklist.some((candidate) => {
      return url.match(new RegExp(candidate));
    });
    if (!isIgnored) {
      debugTestee('onRequest', request.uid, url, request.postData());
      this.inflightRequests[request.uid] = true;
    }
  }

  async connect() {
    // this.client.ws.on('error', (e) => {
    //   console.error(e);
    // });

    // this.client.ws.on('close', () => {
    //   console.log('close');
    // });

    const client = await page!.target().createCDPSession();
    await client.send('Animation.enable');

    /* animation synchronization */
    let animationTimeById: { [key: string]: number } = {};
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
      if (!disableTouchIndicators) {
        await setupTouchIndicators();
      }
      // https://github.com/wix/Detox/blob/ca620e760747ade9cb673c28262200b02e8e8a5d/docs/Troubleshooting.Synchronization.md#settimeout-and-setinterval
      // async function setupDetoxTimeouts() {
      //   await page.evaluate(() => {
      //     if (!window._detoxOriginalSetTimeout)
      //       window._detoxOriginalSetTimeout = window.setTimeout;
      //     if (!window._detoxOriginalClearTimeout)
      //       window._detoxOriginalClearTimeout = window.clearTimeout;
      //     if (!window._detoxTimeouts) window._detoxTimeouts = {};
      //     window.setTimeout = (callback, ms) => {
      //       const stack = new Error().stack;
      //       const isPuppeteerTimeout = stack.includes(
      //         "waitForPredicatePageFunction"
      //       );
      //       if (isPuppeteerTimeout) {
      //         window._detoxOriginalSetTimeout(callback, ms);
      //         return;
      //       }

      //       const timeout = window._detoxOriginalSetTimeout(() => {
      //         delete window._detoxTimeouts[timeout];
      //         callback();
      //       }, ms);
      //       window._detoxTimeouts[timeout] = true;
      //     };
      //     window.clearTimeout = timeout => {
      //       delete window._detoxTimeouts[timeout];
      //       window._detoxOriginalClearTimeout(timeout);
      //     };
      //   });
      // }

      try {
        // TODO figure out why we need a try catch here. Sometimes it errors as "Target closed"
        // Also firebase uses a setTimeout on repeat which doesn't seem compatible with timeout logic
        // https://github.com/firebase/firebase-js-sdk/blob/6b53e0058483c9002d2fe56119f86fc9fb96b56c/packages/auth/src/storage/indexeddb.js#L644
        // setupDetoxTimeouts();
      } catch (e) {
        // console.warn(e);
      }

      // Always re-setup in case we created a new page object since
      // the last action
      this.setupNetworkSynchronization();

      const sendResponse = async (response, options: { skipSynchronization?: boolean } = {}) => {
        debugTestee('sendResponse', response);
        const performSynchronization = enableSynchronization && !options.skipSynchronization;
        const sendResponsePromise = performSynchronization
          ? this.synchronizeNetwork()
          : Promise.resolve();

        const animationsSettledPromise = performSynchronization
          ? new Promise<void>((resolve) => {
              const interval = setInterval(() => {
                Object.entries(animationTimeById).forEach(async ([id, duration]) => {
                  let result: { currentTime: number | null } = {
                    currentTime: null,
                  };
                  try {
                    result = (await client.send('Animation.getCurrentTime', {
                      id: id,
                    })) as any;
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
            })
          : Promise.resolve();

        return sendResponsePromise
          .then(() => animationsSettledPromise)
          .then(() => {
            if (!performSynchronization) return;
            return page!.waitForFunction(() => {
              // @ts-ignore
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
          // Need to sychronize network here so that we dont have any network requests
          // lost in the page navigation
          if (enableSynchronization) {
            await this.synchronizeNetwork();
          }
          if (action.params && action.params.url) {
            await page!.goto(action.params.url, { waitUntil: NETWORKIDLE });
            // await setupDetoxTimeouts();
          }
          await sendResponse({
            type: 'deliverPayloadDone',
            messageId: action.messageId,
          });
        } else if (action.type === 'currentStatus') {
          await sendResponse(
            { type: 'currentStatusResult', params: { resources: [] } },
            { skipSynchronization: true },
          );
        } else {
          try {
            if (enableSynchronization) {
              await this.synchronizeNetwork();
            }
            const result = await this.invoke(action.params);
            if (result === false || result === null) throw new Error('invalid result');
            await sendResponse({
              type: 'invokeResult',
              messageId: action.messageId,
            });
          } catch (error) {
            this.client.ws.ws.send(
              JSON.stringify({
                type: 'testFailed',
                messageId,
                params: { details: str + '\n' + error.message },
              }),
            );
          }
        }
      } catch (error) {
        log.error(error);
        await sendResponse({
          type: 'error',
          messageId: messageId,
          params: { error },
        });
        await browser!.close();
        browser = null;
        page = null;
      }
    });

    await this.client.sendAction(new LoginTestee(this.configuration.sessionId));
  }
}

class PuppeteerDriver extends DeviceDriverBase {
  constructor(config) {
    super(config);
    debug('constructor', config);

    this.testee = new PuppeteerTestee(config);
  }

  declareArtifactPlugins() {
    debug('declareArtifactPlugins');
    return {
      // instruments: (api) => new SimulatorInstrumentsPlugin({ api, client }),
      // log: (api) => new SimulatorLogPlugin({ api, appleSimUtils }),
      screenshot: (api) => new PuppeteerScreenshotPlugin({ api, driver: this }),
      video: (api) => new PuppeteerRecordVideoPlugin({ api, driver: this }),
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
    const viewport = page!.viewport()!;
    const isLandscape = orientation === 'landscape';
    const largerDimension = Math.max(viewport.width, viewport.height);
    const smallerDimension = Math.min(viewport.width, viewport.height);
    await page!.setViewport({
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
    debug('recordVideo', { page: !!page });
    if (!page) {
      recordVideo = true;
      return;
    }
    recordVideo = false;
    await page!.evaluate((filename) => {
      window.postMessage({ type: 'REC_START' }, '*');
    });
    isRecording = true;
  }

  async stopVideo(deviceId) {
    debug('stopVideo', { pendingExport });
    if (pendingExport) {
      const value = pendingExport;
      pendingExport = null;
      return value;
    }

    const exportname = `puppet${Math.random()}.webm`;
    if (isRecording) {
      await page!.evaluate((filename) => {
        window.postMessage({ type: 'SET_EXPORT_PATH', filename: filename }, '*');
        window.postMessage({ type: 'REC_STOP' }, '*');
      }, exportname);
      await page!.waitForSelector('html.detox-puppeteer-downloadComplete', { timeout: 5000 });
      pendingExport = path.join(os.homedir(), 'Downloads', exportname);

      // html.detox-puppeteer-downloadComplete get's set when the download starts, but we want to make sure
      // it's saved to disk before continuing
      for (let i = 0; i < 10; i++) {
        if (fs.existsSync(pendingExport)) {
          break;
        }
        await sleep(500);
      }

      isRecording = false;
    }

    return pendingExport;
  }

  async cleanup(deviceId, bundleId) {
    debug('TODO cleanup', { deviceId, bundleId, browser: !!browser });
    // await sleep(100000);

    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }

    // stopSync is safe to call even if startSync() wasn't
    xvfb.stopSync();

    await super.cleanup(deviceId, bundleId);
  }

  async acquireFreeDevice(deviceQuery) {
    debug('PuppeteerDriver.acquireFreeDevice', deviceQuery);
    return '';
  }

  async getBundleIdFromBinary(appPath) {
    debug('PuppeteerDriver.getBundleIdFromBinary', appPath);
    return '';
  }

  async installApp(deviceId, binaryPath) {
    debug('installApp', { deviceId, binaryPath });
  }

  async uninstallApp(deviceId, bundleId) {
    debug('uninstallApp', { deviceId, bundleId });
    await this.emitter.emit('beforeUninstallApp', { deviceId, bundleId });
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
  }

  async launchApp(deviceId, bundleId, launchArgs, languageAndLocale) {
    debug('launchApp', {
      browser: !!browser,
      deviceId,
      bundleId,
      launchArgs,
      languageAndLocale,
      config: this.deviceConfig,
    });
    await this.emitter.emit('beforeLaunchApp', {
      bundleId,
      deviceId,
      launchArgs,
    });

    if (launchArgs.detoxURLBlacklistRegex) {
      const blacklistRegex = launchArgs.detoxURLBlacklistRegex;
      await this.setURLBlacklist(
        JSON.parse('[' + blacklistRegex.substr(2, blacklistRegex.length - 4) + ']'),
      );
    }

    disableTouchIndicators = launchArgs.disableTouchIndicators;
    const defaultViewport = launchArgs.viewport || this._getDefaultViewport();
    const headless = this._getDeviceOption('headless', false);
    if (!headless && process.env.CI) {
      xvfb.startSync();
    }

    browser =
      browser ||
      (await puppeteer.launch({
        devtools: this._getDeviceOption('devtools', false),
        headless,
        defaultViewport,
        // ignoreDefaultArgs: ['--enable-automation'], // works, but shows "not your default browser toolbar"
        args: [
          '--no-sandbox',
          '--enable-usermedia-screen-capturing',
          '--allow-http-screen-capture',
          '--allow-file-access-from-files',
          '--auto-select-desktop-capture-source=puppetcam',
          '--load-extension=' + EXTENSION_DIRECTORY,
          '--disable-extensions-except=' + EXTENSION_DIRECTORY,
          `--window-size=${defaultViewport.width},${defaultViewport.height + TOOLBAR_SIZE}`,
        ],
      }));

    const url = launchArgs.detoxURLOverride || this.deviceConfig.binaryPath;
    if (url) {
      page = (await browser.pages())[0];
      await page!.goto(url, { waitUntil: NETWORKIDLE });
      if (recordVideo) {
        await this.recordVideo(deviceId);
      }
    }

    await this._applyPermissions(deviceId, bundleId);

    // const pid = await this.applesimutils.launch(deviceId, bundleId, launchArgs, languageAndLocale);
    const pid = 'PID';
    await this.emitter.emit('launchApp', {
      bundleId,
      deviceId,
      launchArgs,
      pid,
    });

    return pid;
  }

  _getDeviceOption<T>(key: string, defaultValue: T): T {
    return this.deviceConfig.device?.[key] ?? defaultValue;
  }

  _getDefaultViewport() {
    return this._getDeviceOption('defaultViewport', { width: 1280, height: 720 });
  }

  async terminate(deviceId, bundleId) {
    debug('terminate', { deviceId, bundleId });
    // If we're in the middle of recording, signal to the next launch that we should start
    // in a recording state
    if (isRecording) {
      recordVideo = true;
    }
    await this.stopVideo(deviceId);
    await this.emitter.emit('beforeTerminateApp', { deviceId, bundleId });
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
    // await this.applesimutils.terminate(deviceId, bundleId);
    await this.emitter.emit('terminateApp', { deviceId, bundleId });
  }

  async sendToHome(deviceId) {
    await page!.goto('https://google.com');
  }

  async shutdown(deviceId) {
    await this.emitter.emit('beforeShutdownDevice', { deviceId });
    await this.applesimutils.shutdown(deviceId);
    await this.emitter.emit('shutdownDevice', { deviceId });
  }

  async setLocation(deviceId, latitude, longitude) {
    await page!.setGeolocation({
      latitude: Number.parseFloat(latitude),
      longitude: Number.parseFloat(longitude),
    });
  }

  async setPermissions(deviceId, bundleId, permissions: { [key: string]: string }) {
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
    };
    this.requestedPermissions = [];
    const requestedPermissions = Object.entries(permissions)
      .filter(([key, value]) => {
        return !['NO', 'unset', 'never', ''].includes(value || '');
      })
      .map(([key]) => PERMISSIONS_LOOKUP[key])
      .filter((equivalentPermission) => !!equivalentPermission);
    this.requestedPermissions = requestedPermissions;
  }

  async _applyPermissions(deviceId: string, bundleId: string) {
    if (browser && this.requestedPermissions) {
      const context = browser.defaultBrowserContext();
      await context.clearPermissionOverrides();
      const url = await page!.url();
      if (url) {
        await context.overridePermissions(new URL(url).origin, this.requestedPermissions);
      }
    }
  }

  async clearKeychain(deviceId) {
    await this.applesimutils.clearKeychain(deviceId);
  }

  async resetContentAndSettings(deviceId) {
    debug('TODO resetContentAndSettings');
    // await this.shutdown(deviceId);
    // await this.applesimutils.resetContentAndSettings(deviceId);
    // await this._boot(deviceId);
  }

  validateDeviceConfig(deviceConfig) {
    this.deviceConfig = deviceConfig;
    debug('validateDeviceConfig', deviceConfig);
    if (!deviceConfig.binaryPath) {
      log.error('PuppeteerDriver requires binaryPath to be set in detox config as your base URL');
      // @ts-ignore
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
    await page!.screenshot({ path: tempPath });

    await this.emitter.emit('createExternalArtifact', {
      pluginId: 'screenshot',
      artifactName: screenshotName,
      artifactPath: tempPath,
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
    const url = this.deviceConfig.binaryPath;
    if (url) {
      page = (await browser!.pages())[0];
      await page!.goto(url, { waitUntil: NETWORKIDLE });
    }
  }

  getBrowser() {
    return browser;
  }
}

export = {
  DriverClass: PuppeteerDriver,
  ExpectClass: WebExpect,
};
