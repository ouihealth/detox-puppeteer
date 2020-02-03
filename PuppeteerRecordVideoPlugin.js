const fs = require('fs-extra');
const log = require('../../utils/logger').child({ __filename });
const temporaryPath = require('../utils/temporaryPath');
const VideoArtifactPlugin = require('./VideoArtifactPlugin');
const Artifact = require('../templates/artifact/Artifact');
const FileArtifact = require('../templates/artifact/FileArtifact');
const { interruptProcess } = require('../../utils/exec');

class PuppeteerRecordVideoPlugin extends VideoArtifactPlugin {
  constructor(config) {
    super(config);

    this.driver = config.driver;
  }

  createTestRecording() {
    const { context } = this;
    let temporaryFilePath;
    let processPromise = null;

    return new Artifact({
      name: 'PuppeteerVideoRecording',
      start: async () => {
        await this.driver.recordVideo(context.deviceId)
      },
      stop: async () => {
        temporaryFilePath = await this.driver.stopVideo(context.deviceId);
      },
      save: async (artifactPath) => {
        await FileArtifact.moveTemporaryFile(log, temporaryFilePath, artifactPath);
      },
      discard: async () => {
        await fs.remove(temporaryFilePath);
      },
    });
  }
}

module.exports = PuppeteerRecordVideoPlugin;
