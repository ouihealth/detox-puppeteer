## Description

`detox-puppeteer` is a custom driver for [detox](https://github.com/wix/Detox/) that runs e2e tests for web apps with [puppeteer](https://github.com/puppeteer/puppeteer/) behind the scenes. `detox-puppeteer` may be a good fit for you if you already use detox for testing your android + ios react-native apps and have a web version as well.

## Getting started

WARNING: This plugin currently requires a fork of detox (`"detox": "npm:oui-detox"` in package.json) until https://github.com/wix/Detox/issues/1882 is resolved. This plugin is new and potentially unstable. Use at your own risk!

1. yarn add --dev detox-puppeteer
1. In `e2e/init.js`, register the driver with detox:

```
import { addDriver } from 'detox';
addDriver('web.puppeteer', PuppeteerDriver);
```

4. In `package.json` add a new configuration for `detox-puppeteer`

```
...
  "detox": {
     "configurations": {
       "web.aviva": {
         "binaryPath": "/http://example.com/", // Note the leading and trailing slashes
         "type": "web.puppeteer",
         "device": { // optional, all options with defaults shown here
           "defaultViewport": {
             "width": 375,
             "height": 712
           },
           "headless": true,
           "devtools": false,
         },
         "name": "puppeteer"
      },
   },
 ...
```

## Missing features / TODO

- Video artifacts working in headless puppeteer sessions
- Multiple runners / executers in parallel
- Document setup for running in CI

## Credits

Thanks to the following people / organizations

- https://github.com/wix/ and the detox maintaners for detox
- @muralikg for https://github.com/muralikg/puppetcam
- The puppeteer team for https://github.com/puppeteer/puppeteer/
