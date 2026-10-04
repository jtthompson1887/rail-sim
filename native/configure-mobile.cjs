const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const androidManifest = path.join(root, 'android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(androidManifest)) {
  let text = fs.readFileSync(androidManifest, 'utf8');
  text = text.replace(/android:screenOrientation="[^"]*"\s*/g, '');
  text = text.replace(/<activity\s+/, '<activity\n            android:screenOrientation="sensorLandscape"\n            ');
  // Authoritative save sharing uses explicit exports, rather than automatic OS cloud backup.
  text = text.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
  fs.writeFileSync(androidManifest, text);
  console.log('Android landscape and app-private backup configuration applied.');
}

const iosPlist = path.join(root, 'ios/App/App/Info.plist');
if (fs.existsSync(iosPlist)) {
  let text = fs.readFileSync(iosPlist, 'utf8');
  const orientations = '<array>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t</array>';
  text = text.replace(/(<key>UISupportedInterfaceOrientations(?:~ipad)?<\/key>\s*)<array>[\s\S]*?<\/array>/g, `$1${orientations}`);
  fs.writeFileSync(iosPlist, text);
  const privacyTarget = path.join(root, 'ios/App/App/PrivacyInfo.xcprivacy');
  if (!fs.existsSync(privacyTarget)) fs.copyFileSync(path.join(__dirname, 'ios/PrivacyInfo.xcprivacy'), privacyTarget);
  const project = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');
  let projectText = fs.readFileSync(project, 'utf8');
  if (!projectText.includes('PrivacyInfo.xcprivacy in Resources')) {
    const fileId = 'A7040410A7040410A7040410';
    const buildId = 'B7040410B7040410B7040410';
    projectText = projectText.replace('/* Begin PBXBuildFile section */', `/* Begin PBXBuildFile section */\n\t\t${buildId} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${fileId} /* PrivacyInfo.xcprivacy */; };`);
    projectText = projectText.replace('/* Begin PBXFileReference section */', `/* Begin PBXFileReference section */\n\t\t${fileId} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`);
    projectText = projectText.replace(/(\/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \()/, `$1\n\t\t\t\t${fileId} /* PrivacyInfo.xcprivacy */,`);
    projectText = projectText.replace(/(isa = PBXResourcesBuildPhase;[\s\S]*?files = \()/, `$1\n\t\t\t\t${buildId} /* PrivacyInfo.xcprivacy in Resources */,`);
    fs.writeFileSync(project, projectText);
  }
  console.log('iOS landscape configuration and App-target privacy manifest applied.');
}
