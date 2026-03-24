import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'fs';
import path from 'path';

// Modules externalized by Vite — must be copied to the packaged app
const EXTERNAL_MODULES = [
  'uiohook-napi',
  'better-sqlite3',
  'onnxruntime-node',
  '@huggingface/transformers',
  'openai',
  '@anthropic-ai/sdk',
  'electron-store',
];

/**
 * Recursively copies a module and all its production + optional dependencies
 * from project node_modules into the build staging directory.
 */
function copyModuleWithDeps(moduleName: string, buildPath: string, copied: Set<string>) {
  if (copied.has(moduleName)) return;
  copied.add(moduleName);

  const src = path.resolve('node_modules', moduleName);
  const dest = path.join(buildPath, 'node_modules', moduleName);

  if (!fs.existsSync(src)) return;

  fs.cpSync(src, dest, { recursive: true });

  const pkgPath = path.join(src, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
    ];
    for (const dep of deps) {
      copyModuleWithDeps(dep, buildPath, copied);
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '*.{node,dll}',
    },
    asarUnpack: [
      'node_modules/uiohook-napi/**',
      'node_modules/better-sqlite3/**',
      'node_modules/onnxruntime-node/**',
    ],
    name: 'The Dictator',
    icon: 'assets/icon',
    extraResource: ['assets/icon.png'],
  },
  rebuildConfig: {
    onlyModules: ['better-sqlite3', 'uiohook-napi'],
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const copied = new Set<string>();
      for (const mod of EXTERNAL_MODULES) {
        copyModuleWithDeps(mod, buildPath, copied);
      }
      console.log(`[forge] Copied ${copied.size} external modules to packaged app`);
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: path.resolve('assets/icon.ico'),
      // Code signing: reads certificate from environment variables.
      // Set WINDOWS_CERTIFICATE_FILE (path to .pfx) and WINDOWS_CERTIFICATE_PASSWORD
      // to sign the installer. Without these, the build works but Windows SmartScreen
      // will show "Unknown publisher".
      ...(process.env.WINDOWS_CERTIFICATE_FILE
        ? {
            certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
            certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD ?? '',
          }
        : {}),
    }),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'kubaasa', name: 'the-dictator' },
      prerelease: false,
      draft: true,
    }),
  ],
};

export default config;
