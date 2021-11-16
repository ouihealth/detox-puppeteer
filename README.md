## Description

`detox-puppeteer` is a custom driver for [Detox](https://github.com/wix/Detox/) that runs e2e tests for web apps with [Puppeteer](https://github.com/puppeteer/puppeteer/) behind the scenes. `detox-puppeteer` may be a good fit for you if you already use detox for testing your android + ios react-native apps and have a web version as well.

## Getting started

**This plugin requires Detox ≥ `19.0.0`.**

> For Detox v18 and v17, use detox-puppeteer `v3.x.x`.



1. Run `yarn add --dev detox-puppeteer`
1. In `package.json` add a new configuration for `detox-puppeteer`

#### New Detox configuration format

```
...
  "detox": {
    "devices": {
      "puppeteer-mobile": {
        "type": "detox-puppeteer",
        "defaultViewport": {
          "width": 375,
          "height": 712
        }
      }
    },
    "apps": {
      "localapp": {
        "type": "chrome",
        "binaryPath": "http://localhost:8889/"
      }
    },
    "configurations": {
      "web.example": {
        "device": "puppeteer-mobile",
        "app": "localapp"
      },
   },
 ...
```


#### Old Detox configuration format

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

### Running on CI

In your CI service of choice, run a container based off of `Dockerfile.example` provided here.

If you install your node modules in a build step that doesn't use this container, you can set
`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` when running `npm install` or `yarn install` as the
container image comes with chromium already installed. The puppeteer npm package will download
chromium by default unless the ENV variable is set.

### Workarounds

When screen recording is enabled, chromium will display a toolbar that pushes the page content
out of the viewport. To compensate you can add the following css to your app:

```css
body.detox-puppeteer-recording > #root {
  height: calc(100vh - 50px);
}
```

Sometimes the detox API is insufficient for interacting with the full range of puppeteer
functionality. detox-puppeteer exposes puppeteer's browser object so your tests can opt-in to
custom puppeteer functionality.

```ts
export async function getPuppeteerPage() {
  const browser: Browser = (detox.device as any).deviceDriver.getBrowser();
  return (await browser.pages())[0];
}
```

## Credits

Thanks to the following people / organizations

- https://github.com/wix/ and the detox maintaners for detox
- @muralikg for https://github.com/muralikg/puppetcam
- The puppeteer team for https://github.com/puppeteer/puppeteer/
