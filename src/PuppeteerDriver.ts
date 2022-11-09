import * as _ from 'lodash';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
const path = require('path');
const fs = require('fs');
const os = require('os');

const log = require('detox/src/utils/logger').child({ __filename });
const DeviceDriverBase = require('detox/src/devices/runtime/drivers/DeviceDriverBase');
const temporaryPath = require('detox/src/artifacts/utils/temporaryPath');
const Client = require('detox/src/client/Client');

import * as puppeteer from 'puppeteer';
import WebExpect from './expect';
import PuppeteerScreenshotPlugin from './PuppeteerScreenshotPlugin';
import PuppeteerRecordVideoPlugin from './PuppeteerRecordVideoPlugin';
import LoginTestee from './LoginTesteeAction';

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
  client: typeof Client;
  inflightRequests: { [key: string]: boolean };
  inflightRequestsSettledCallback: (() => void) | null;
  sessionId: string;

  constructor(deps) {
    // console.log('PuppeteerTestee.constructor', config);
    const { client } = deps;
    this.sessionId = client._sessionId;
    this.client = new Client({ sessionId: this.sessionId, server: client._serverUrl });
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
    const existArg = args.find(
      (a) => a.method === 'option' && typeof a.args[0].exists === 'boolean',
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
            return new Promise((resolve) => {
              const observer = new IntersectionObserver((entries) => {
                resolve(entries[0].intersectionRatio);
                observer.disconnect();
              });
              observer.observe(el);
              // Firefox doesn't call IntersectionObserver callback unless
              // there are rafs.
              requestAnimationFrame(() => {});
              // @ts-ignore
            }).then((visibleRatio) => visibleRatio > 0);
          }

          // do a reverse search to match iOS indexes
          const element = elements[indexArg ? elements.length - 1 - indexArg.args[0] : 0];
          if (visibleArg) {
            if (visibleArg.args[0].visible === false) {
              if (element) {
                return isIntersectingViewport(element).then((isVisible) => !isVisible);
              } else {
                return true;
              }
            } else if (visibleArg.args[0].visible === true) {
              if (element) {
                return isIntersectingViewport(element).then((isVisible) =>
                  isVisible ? element : false,
                );
              }
            }
          }

          return element;
        },
        {
          timeout: timeoutArg
            ? timeoutArg.args[0].timeout
            : /* sometimes puppeteer unable to evaluate in less than ~800ms so we give some extra cushion */ 1500,
        },
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
      if (existArg) {
        const shouldNotExist = existArg.args[0].exists === false;
        if (shouldNotExist) return true;
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
        await element?.evaluate((node) => {
          const contentLength = node.innerHTML.length;
          if (node.attributes.getNamedItem('type')?.value !== 'email') {
            // @ts-expect-error
            node.setSelectionRange(contentLength, contentLength);
          }
        });
      }
    }

    if (action.method === 'replaceText') {
      await clickIfUnfocused();
      await element.evaluate((el) => ((el as any).value = ''));
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
      const elementValue = await element.evaluate((el) => (el as any).value);
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

  async selectElementWhileScrolling(
    search,
    action: {
      target: {
        type: 'action';
        value: 'action';
      };
      method: 'scroll';
      args: [string, number];
    },
    actionMatcher,
  ) {
    const searchWithTimeout = {
      ...search,
      args: [
        ...search.args,
        {
          target: {
            type: 'matcher',
            value: 'matcher',
          },
          method: 'option',
          args: [
            {
              timeout: 10,
            },
          ],
        },
      ],
    };
    const actionElement = await this.selectElementWithMatcher(actionMatcher);
    const numSteps = 20;
    const deltaScroll = { ...action, args: [action.args[0], action.args[1] / numSteps] };

    let result;
    for (let step = 0; step < numSteps; step = step + 1) {
      try {
        result = await this.invoke(searchWithTimeout);
        break;
      } catch (e) {
        result = e;
        await this.performAction(actionElement! as puppeteer.ElementHandle, deltaScroll);
      }
    }

    if (result instanceof Error) throw result;
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
    browser!.off('disconnected', this.clearInflightRequests);
    page!.off('close', this.clearInflightRequests);
    page!.off('request', this.onRequest);
    page!.off('requestfinished', this.removeInflightRequest);
    page!.off('requestfailed', this.removeInflightRequest);

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
    request.__completed = true;
    debugTestee('offRequest', request.uid);
    delete this.inflightRequests[request.uid];
    if (Object.keys(this.inflightRequests).length === 0) {
      if (this.inflightRequestsSettledCallback) this.inflightRequestsSettledCallback();
    }
  }

  onRequest(request) {
    if (request.__completed) {
      debugTestee('request completed before onRequest invoked', request.url());
      return;
    }
    request.uid = Math.random();
    const url = request.url();
    const isIgnored =
      // data urls dont get a requestfinished callback
      url.startsWith('data:') ||
      urlBlacklist.some((candidate) => {
        return url.match(new RegExp(candidate));
      });
    if (!isIgnored) {
      debugTestee('onRequest', request.uid, url, request.postData());
      this.inflightRequests[request.uid] = true;
    }
  }

  async connect() {
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

    if (!this.client._asyncWebSocket.isOpen) {
      await this.client.open();

      const onMessage = async (action) => {
        try {
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

          const sendResponse = async (
            response,
            options: { skipSynchronization?: boolean } = {},
          ) => {
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
              .then(() => this.client.sendAction(response));
          };

          let messageId;
          try {
            messageId = action.messageId;
            debugTestee('PuppeteerTestee.message', JSON.stringify(action, null, 2));
            if (!action.type) {
              return;
            }
            if (action.type === 'loginSuccess') {
              return;
            } else if (action.type === 'cleanup') {
              if (browser) {
                await browser.close();
                browser = null;
                page = null;
              }
              await sendResponse(
                {
                  type: 'cleanupDone',
                  messageId: action.messageId,
                },
                { skipSynchronization: true },
              );
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
              const status = `App is idle.

Network requests (${Object.keys(this.inflightRequests).length}): ${Object.keys(
                this.inflightRequests,
              )}
`.trim();
              await sendResponse(
                {
                  type: 'currentStatusResult',
                  messageId: action.messageId,
                  params: { status },
                },
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
                this.client.sendAction({
                  type: 'testFailed',
                  messageId,
                  params: { details: JSON.stringify(action) + '\n' + error.message },
                });
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
        } catch (error) {
          console.error(error);
        }
      };

      // list of possible actions can be found here: https://github.com/wix/Detox/blob/0beef1a7bfe0f4bf477fa5cdbb318b5c3a960aae/detox/ios/Detox/DetoxManager.swift#L233
      this.client.setEventCallback('invoke', onMessage);
      this.client.setEventCallback('cleanup', onMessage);
      this.client.setEventCallback('currentStatus', onMessage);
      this.client.setEventCallback('deliverPayload', onMessage);
      this.client.setEventCallback('testerDisconnected', () => {});

      await this.client.sendAction(new LoginTestee(this.sessionId, 'app'));
    }
  }
}

class PuppeteerEnvironmentValidator {
  validate() {
    // const detoxFrameworkPath = await environment.getFrameworkPath();
    // if (!fs.existsSync(detoxFrameworkPath)) {
    //   throw new Error(`${detoxFrameworkPath} could not be found, this means either you changed a version of Xcode or Detox postinstall script was unsuccessful.
    //   To attempt a fix try running 'detox clean-framework-cache && detox build-framework-cache'`);
    // }
  }
}

let recorder;
let exportPath;
async function startRecordVideo() {
  debug('recordVideo', { page: !!page });
  if (!page) {
    recordVideo = true;
    const exportname = `puppet${Math.random()}.mp4`;
    exportPath = path.join(os.homedir(), 'Downloads', exportname);
    return exportPath;
  }
  recordVideo = false;
  recorder = new PuppeteerScreenRecorder(page, { fps: 60 });
  recorder.start(exportPath);
  isRecording = true;
  return exportPath;
}

async function stopRecordVideo() {
  debug('stopVideo', { pendingExport });
  await recorder?.stop();
  recorder = undefined;
}

// TODO
async function takeScreenshot() {}

class PuppeteerArtifactPluginsProvider {
  declareArtifactPlugins(args) {
    debug('declareArtifactPlugins');
    return {
      // instruments: (api) => new SimulatorInstrumentsPlugin({ api, client }),
      // log: (api) => new SimulatorLogPlugin({ api, appleSimUtils }),
      screenshot: (api) => new PuppeteerScreenshotPlugin({ api, driver: takeScreenshot }),
      video: (api) =>
        new PuppeteerRecordVideoPlugin({
          api,
          driver: { recordVideo: startRecordVideo, stopVideo: stopRecordVideo },
        }),
    };
  }
}

class PuppeteerAllocCookie {
  testee: PuppeteerTestee;
  id: any;

  constructor(testee) {
    this.testee = testee;
    this.id = '';
  }
}

class PuppeteerDeviceAllocation {
  private readonly testee: PuppeteerTestee;
  private readonly emitter: any;

  constructor(deps) {
    this.testee = new PuppeteerTestee(deps);
    this.emitter = deps.eventEmitter;
  }

  async allocate(deviceConfig) {
    debug('PuppeteerAllocation.allocate', deviceConfig.device);
    return new PuppeteerAllocCookie(this.testee);
  }

  async free(deviceCookie: PuppeteerAllocCookie, { shutdown }) {
    const { id } = deviceCookie;

    if (shutdown) {
      await this.emitter.emit('beforeShutdownDevice', { deviceId: id });
      await this.emitter.emit('shutdownDevice', { deviceId: id });
    }
  }
}

class PuppeteerRuntimeDriver extends DeviceDriverBase {
  private readonly deviceId: any;
  private readonly testee: PuppeteerTestee;

  constructor(deps: any, cookie: PuppeteerAllocCookie) {
    super(deps);
    debug('constructor');

    this.testee = cookie.testee;
    this.deviceId = cookie.id;
  }

  getExternalId() {
    return this.deviceId;
  }

  getDeviceName() {
    return 'puppeteer';
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

  async shake() {
    return await this.client.shake();
  }

  async setOrientation(orientation) {
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

  async cleanup(bundleId) {
    debug('TODO cleanup', { bundleId, browser: !!browser });
    // await sleep(100000);

    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }

    await super.cleanup(bundleId);
  }

  async getBundleIdFromBinary(appPath) {
    debug('PuppeteerDriver.getBundleIdFromBinary', appPath);
    return appPath;
  }

  async installApp(binaryPath) {
    debug('installApp', { binaryPath });
  }

  async uninstallApp(bundleId) {
    debug('uninstallApp', { bundleId });
    await this.emitter.emit('beforeUninstallApp', { deviceId: this.deviceId, bundleId });
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
  }

  async launchApp(bundleId, launchArgs, languageAndLocale) {
    debug('launchApp', {
      browser: !!browser,
      bundleId,
      launchArgs,
      languageAndLocale,
      config: this.deviceConfig,
    });
    const { deviceId } = this;

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
    const headless = this._getDeviceOption('headless', process.env.CI ? true : false);

    browser =
      browser ||
      (await puppeteer.launch({
        devtools: this._getDeviceOption('devtools', false),
        headless,
        defaultViewport,
        // ignoreDefaultArgs: ['--enable-automation'], // works, but shows "not your default browser toolbar"
        args: [
          '--no-sandbox',
          `--window-size=${defaultViewport.width},${defaultViewport.height + TOOLBAR_SIZE}`,
        ],
      }));

    if (bundleId && !this.binaryPath) {
      this.binaryPath = bundleId;
    }
    const url = launchArgs.detoxURLOverride || this.binaryPath;
    if (url) {
      page = (await browser.pages())[0];
      await page!.goto(url, { waitUntil: NETWORKIDLE });
      if (recordVideo) {
        await startRecordVideo();
      }
    }

    await this._applyPermissions();

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
    return this.deviceConfig.device?.[key] ?? this.deviceConfig?.[key] ?? defaultValue;
  }

  _getDefaultViewport() {
    return this._getDeviceOption('defaultViewport', { width: 1280, height: 720 });
  }

  async terminate(bundleId) {
    debug('terminate', { bundleId });
    // If we're in the middle of recording, signal to the next launch that we should start
    // in a recording state
    if (isRecording) {
      recordVideo = true;
    }
    await stopRecordVideo();
    await this.emitter.emit('beforeTerminateApp', { deviceId: this.deviceId, bundleId });
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
    // await this.applesimutils.terminate(deviceId, bundleId);
    await this.emitter.emit('terminateApp', { deviceId: this.deviceId, bundleId });
  }

  async sendToHome() {
    await page!.goto('https://google.com');
  }

  async setLocation(latitude, longitude) {
    await page!.setGeolocation({
      latitude: Number.parseFloat(latitude),
      longitude: Number.parseFloat(longitude),
    });
  }

  async setPermissions(bundleId, permissions: { [key: string]: string }) {
    debug('setPermissions', { bundleId, permissions });
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

  async _applyPermissions() {
    if (browser && this.requestedPermissions) {
      const context = browser.defaultBrowserContext();
      await context.clearPermissionOverrides();
      const url = await page!.url();
      if (url) {
        await context.overridePermissions(new URL(url).origin, this.requestedPermissions);
      }
    }
  }

  async clearKeychain() {}

  async resetContentAndSettings() {
    debug('TODO resetContentAndSettings');
  }

  validateDeviceConfig(deviceConfig) {
    debug('validateDeviceConfig', deviceConfig);
    this.deviceConfig = deviceConfig;
    if (this.deviceConfig.binaryPath) {
      this.binaryPath = this.deviceConfig.binaryPath;
    }
  }

  getLogsPaths() {}

  async waitForBackground() {
    debug('TODO waitForBackground');
    // return await this.client.waitForBackground();
    return Promise.resolve('');
  }

  async takeScreenshot(screenshotName) {
    const tempPath = await temporaryPath.for.png();
    await page!.screenshot({ path: tempPath });

    await this.emitter.emit('createExternalArtifact', {
      pluginId: 'screenshot',
      artifactName: screenshotName,
      artifactPath: tempPath,
    });

    return tempPath;
  }

  async setStatusBar(flags) {}

  async resetStatusBar() {}

  async waitUntilReady() {
    await this.testee.connect();
  }

  async reloadReactNative() {
    const url = this.binaryPath;
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
  EnvironmentValidatorClass: PuppeteerEnvironmentValidator,
  ArtifactPluginsProviderClass: PuppeteerArtifactPluginsProvider,
  DeviceAllocationDriverClass: PuppeteerDeviceAllocation,
  RuntimeDriverClass: PuppeteerRuntimeDriver,
  ExpectClass: WebExpect,
};
