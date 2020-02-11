const _ = require('lodash');
const log = require('../../utils/logger').child({ __filename });
const temporaryPath = require('../utils/temporaryPath');
const FileArtifact = require('../templates/artifact/FileArtifact');
const ScreenshotArtifactPlugin = require('./ScreenshotArtifactPlugin');

class PuppeteerScreenshotPlugin extends ScreenshotArtifactPlugin {
  constructor(config) {
    super(config);

    this.driver = config.driver;
  }

  createTestArtifact() {
    const { driver, context, appleSimUtils } = this;

    return new FileArtifact({
      name: 'PuppeteerScreenshot',

      async start() {
        this.temporaryPath = temporaryPath.for.png();
        await driver.takeScreenshot(context.deviceId, this.temporaryPath);
      }
    });
  }
}

module.exports = PuppeteerScreenshotPlugin;
