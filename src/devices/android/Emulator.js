const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const spawn = require('child-process-promise').spawn;
const Tail = require('tail').Tail;
const exec = require('../../utils/exec').execWithRetriesAndLogs;
const unitLogger = require('../../utils/logger').child({ __filename });
const {getAndroidEmulatorPath} = require('../../utils/environment');
const argparse = require('../../utils/argparse');

class Emulator {
  constructor() {
    this.emulatorBin = getAndroidEmulatorPath();
  }

  async listAvds() {
    const output = await this.exec(`-list-avds --verbose`);
    const avds = output.trim().split('\n');
    return avds;
  }

  async exec(cmd) {
    return (await exec(`${this.emulatorBin} ${cmd}`)).stdout;
  }

  async boot(emulatorName, options = {port: undefined}) {
    const emulatorArgs = _.compact([
      '-verbose',
      '-no-audio',
      '-no-boot-anim',
      argparse.getArgValue('headless') ? '-no-window' : '',
      argparse.getArgValue('readOnlyEmu') ? '-read-only' : '',
      options.port ? `-port` : '',
      options.port ? `${options.port}` : '',
      `@${emulatorName}`
    ]);

    const gpuMethod = this.gpuMethod();
    if(gpuMethod) {
      emulatorArgs.push('-gpu', gpuMethod);
    }

    let childProcessOutput;
    const portName = options.port ? `-${options.port}` : '';
    const tempLog = `./${emulatorName}${portName}.log`;
    const stdout = fs.openSync(tempLog, 'a');
    const stderr = fs.openSync(tempLog, 'a');
    const tailOptions = {
      useWatchFile: true,
      fsWatchOptions: {
        interval: 1500,
      },
    };
    const tail = new Tail(tempLog, tailOptions)
      .on("line", (line) => {
        if (line.includes('Adb connected, start proxing data')) {
          childProcessPromise._cpResolve();
        }
      });

    function detach() {
      if (childProcessOutput) {
        return;
      }

      childProcessOutput = fs.readFileSync(tempLog, 'utf8');

      tail.unwatch();
      fs.closeSync(stdout);
      fs.closeSync(stderr);
      fs.unlink(tempLog, _.noop);
    }

    let log = unitLogger.child({ fn: 'boot' });
    log.debug({ event: 'SPAWN_CMD' }, this.emulatorBin, ...emulatorArgs);
    const childProcessPromise = spawn(this.emulatorBin, emulatorArgs, { detached: true, stdio: ['ignore', stdout, stderr] });
    childProcessPromise.childProcess.unref();
    log = log.child({ child_pid: childProcessPromise.childProcess.pid });

    return childProcessPromise.then(() => true).catch((err) => {
      detach();

      if (childProcessOutput.includes(`There's another emulator instance running with the current AVD`)) {
        return false;
      }

      log.error({ event: 'SPAWN_FAIL', error: true, err }, err.message);
      log.error({ event: 'SPAWN_FAIL', stderr: true }, childProcessOutput);
      throw err;
    }).then((coldBoot) => {
      detach();
      log.debug({ event: 'SPAWN_SUCCESS', stdout: true }, childProcessOutput);
      return coldBoot;
    });
  }

  gpuMethod() {
    const gpuArgument = argparse.getArgValue('gpu');
    if(gpuArgument) {
      return gpuArgument;
    }

    if (argparse.getArgValue('headless')) {
      switch (os.platform()) {
        case 'darwin':
          return 'host';
        case 'linux':
          return 'swiftshader_indirect';
        case 'win32':
          return 'angle_indirect';
        default:
          return 'auto';
      }
    }

    return undefined;
  }
}

module.exports = Emulator;