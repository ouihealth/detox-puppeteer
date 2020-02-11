const fs = require('fs-extra');
const log = require('detox/src/utils/logger').child({ __filename });
const VideoArtifactPlugin = require('detox/src/artifacts/video/VideoArtifactPlugin');
const Artifact = require('detox/src/artifacts/templates/artifact/Artifact');
const FileArtifact = require('detox/src/artifacts/templates/artifact/FileArtifact');

class PuppeteerRecordVideoPlugin extends VideoArtifactPlugin {
  constructor(config) {
    super(config);

    this.driver = config.driver;
  }

  createTestRecording() {
    const { context } = this;
    let temporaryFilePath;

    return new Artifact({
      name: 'PuppeteerVideoRecording',
      start: async () => {
        await this.driver.recordVideo(context.deviceId);
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

export default PuppeteerRecordVideoPlugin;
