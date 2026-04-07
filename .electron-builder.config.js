/**
 * TODO: Rewrite this config to ESM
 * But currently electron-builder doesn't support ESM configs
 * @see https://github.com/develar/read-config-file/issues/10
 */
// const { notarize } = require('@electron/notarize');

require('dotenv').config();

/**
 * @type {() => import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
function getBuildTime() {
  return process.env.BUILD_TIME || new Date().getTime();
}

console.log('ELECTRON_PLATFORM', process.env.ELECTRON_PLATFORM);
console.log('ELECTRON_ARCH', process.env.ELECTRON_ARCH);

module.exports = async function () {
  const {getVersion} = await import('./version/getVersion.mjs');
  const config = {
    productName: 'Chrome Power',
    appId: 'com.chrome-power.app',
    directories: {
      output: 'dist',
      buildResources: 'buildResources',
    },
    nodeGypRebuild: false, // Disable node-gyp rebuild, use prebuilt binaries
    npmRebuild: false, // Disable @electron/rebuild to skip iohook compilation
    files: [
      'packages/**/dist/**',
      'packages/**/assets/**',
      'migrations',
      'package.json',
      'node_modules/sqlite3/lib/binding/**/*.node',
      'node_modules/@tkomde/iohook/**/*.node',
      'node_modules/iconv-corefoundation/lib/*.node',
      'buildResources/**/*',
      '!**/*.map', // 排除调试文件
      '!**/*.ts',
      '!**/*.tsx',
    ],
    extraResources: [
      {
        from: 'migrations',
        to: 'app/migrations',
      },
      {
        from: 'assets',
        to: 'app/assets',
      },
      {
        from: 'buildResources',
        to: 'buildResources',
        filter: ['*.ico', '*.png', '*.icns'],
      },
    ],
    extraMetadata: {
      version: getVersion(),
      main: './packages/main/dist/index.cjs',
    },
    asar: true,
    asarUnpack: '**/*.{node,dll}',

    // Windows 配置
    win: {
      icon: 'buildResources/icon.ico',
      target: [
        {
          target: 'nsis',
          arch: ['x64'],
        },
      ],
      artifactName: '${productName}-${version}-${arch}-${os}-' + getBuildTime() + '.${ext}',
      signAndEditExecutable: false,
      compression: 'maximum', // 最大压缩（安装包会更小，但打包时间更长）
    },
    nsis: {
      oneClick: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Chrome Power',
      installerIcon: 'buildResources/icon.ico',
      uninstallerIcon: 'buildResources/icon.ico',
      installerHeaderIcon: 'buildResources/icon.ico',
      menuCategory: true,
      artifactName: '${productName}-${version}-${arch}-${os}-' + getBuildTime() + '.${ext}',
    },

    // macOS 配置
    mac: {
      timestamp: false,
      icon: 'buildResources/icon.icns',
      notarize: false,
      identity: process.env.APPLE_IDENTITY,
      target: [
        {
          target: 'dmg',
          arch: [process.env.ELECTRON_ARCH || (process.arch === 'arm64' ? 'arm64' : 'x64')],
        },
      ],
      category: 'public.app-category.developer-tools',
      hardenedRuntime: true, 
      gatekeeperAssess: false,
      entitlements: 'buildResources/entitlements.mac.plist',
      entitlementsInherit: 'buildResources/entitlements.mac.plist',
      type: 'distribution',
      strictVerify: false,
      artifactName: '${productName}-${version}-${arch}-${os}' + getBuildTime() + '.${ext}',
      signIgnore: [],
    },
    dmg: {
      sign: false,
      writeUpdateInfo: false,
      format: 'ULFO',
    },

    // 添加 GitHub 发布配置
    publish: {
      provider: 'github',
      private: false,
      releaseType: 'draft',
    },

    // 在打包后复制 window-addon.node 到最终目录
    afterPack: async (context) => {
      const fs = require('fs');
      const path = require('path');
      const { electronPlatformName, arch, appOutDir } = context;

      // electron-builder 的 arch 是数字枚举，需要转换为字符串
      const archMap = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
      const archString = archMap[arch] || String(arch);

      console.log(`Copying window-addon for ${electronPlatformName}-${archString}...`);

      // native addon 编译产物直接放在 Release 目录下，没有按平台/架构分子目录
      const sourcePath = path.join(__dirname, 'packages/main/src/native-addon/build/Release/window-addon.node');

      // Mac 应用有 .app 包结构，需要特殊处理路径
      let targetDir;
      if (electronPlatformName === 'darwin') {
        const appName = context.packager.appInfo.productFilename;
        targetDir = path.join(appOutDir, `${appName}.app/Contents/Resources/app.asar.unpacked/node_modules/window-addon`);
      } else {
        targetDir = path.join(appOutDir, 'resources/app.asar.unpacked/node_modules/window-addon');
      }
      const targetPath = path.join(targetDir, 'window-addon.node');

      try {
        // 检查源文件是否存在
        if (!fs.existsSync(sourcePath)) {
          console.error(`Source file not found: ${sourcePath}`);
          console.error('Please run npm run build:native-addon first');
          throw new Error('window-addon.node not found');
        }

        // 创建目标目录
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
          console.log(`Created directory: ${targetDir}`);
        }

        // 复制文件
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`Successfully copied window-addon.node to ${targetPath}`);
      } catch (error) {
        console.error('Failed to copy window-addon:', error);
        throw error;
      }
    },
  };

  return config;
};
