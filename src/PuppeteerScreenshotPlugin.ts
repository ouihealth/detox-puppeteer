const temporaryPath = require('detox/src/artifacts/utils/temporaryPath');
const FileArtifact = require('detox/src/artifacts/templates/artifact/FileArtifact');
const ScreenshotArtifactPlugin = require('detox/src/artifacts/screenshot/ScreenshotArtifactPlugin');

class PuppeteerScreenshotPlugin extends ScreenshotArtifactPlugin {
  constructor(config) {
    super(config);

    this.driver = config.driver;
  }

  createTestArtifact() {
    const { driver, context } = this;

    return new FileArtifact({
      name: 'PuppeteerScreenshot',

      async start() {
        this.temporaryPath = temporaryPath.for.png();
        await driver.takeScreenshot(context.deviceId, this.temporaryPath);
      },
    });
  }
}

export default PuppeteerScreenshotPlugin;
