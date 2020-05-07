## Description

`detox-puppeteer` is a custom driver for [detox](https://github.com/wix/Detox/) that runs e2e tests for web apps with [puppeteer](https://github.com/puppeteer/puppeteer/) behind the scenes. `detox-puppeteer` may be a good fit for you if you already use detox for testing your android + ios react-native apps and have a web version as well.

## Getting started

This plugin is requires detox >= 16.3.0.

1. yarn add --dev detox-puppeteer
1. In `package.json` add a new configuration for `detox-puppeteer`

```
...
  "detox": {
     "configurations": {
       "web.example": {
         "binaryPath": "http://example.com/", // Note trailing slash
         "type": "detox-puppeteer",
         "device": {
           "defaultViewport": {
             "width": 375,
             "height": 712
           },
           "headless": false, // optional
           "devtools": false, // optional
         },
         "name": "puppeteer"
      },
   },
 ...
```

## Missing features / TODO

- Document setup for running in CI

## Credits

Thanks to the following people / organizations

- https://github.com/wix/ and the detox maintaners for detox
- @muralikg for https://github.com/muralikg/puppetcam
- The puppeteer team for https://github.com/puppeteer/puppeteer/
