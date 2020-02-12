## Description

`detox-puppeteer` is a custom driver for [detox](https://github.com/wix/Detox/) that runs e2e tests for web apps with [puppeteer](https://github.com/puppeteer/puppeteer/) behind the scenes. `detox-puppeteer` may be a good fit for you if you already use detox for testing your android + ios react-native apps and have a web version as well.

## Getting started

1. yarn add --dev detox-puppeteer
1. In your jest `config.json`, add `node_modules/detox` `transformIgnorePatterns`\*
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

_\* Note: I'm looking for ways to remove this step but can't figure out how to extend a native js class without the transpiling yet. PRs welcome!_

## Missing features / TODO

- Video artifacts working in headless puppeteer sessions
- Multiple runners / executers in parallel
- Document setup for running in CI
