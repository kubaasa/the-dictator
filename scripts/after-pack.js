/**
 * electron-builder afterPack hook — flips Electron fuses for security hardening.
 * Mirrors the FusesPlugin config from the previous Forge setup.
 */
const path = require('path');

exports.default = async function afterPack(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const exe = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );

  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log('[afterPack] Electron fuses flipped');
};
