// Configuration dynamique : complète app.json avec les variables du build (EAS ou fichier .env).
// - ANDROID_PACKAGE / IOS_BUNDLE_ID : identifiant de l'application sur les stores. Définitif une fois publié sur Google Play.
// - EAS_PROJECT_ID : identifiant du projet EAS (affiché par « npx eas-cli init »), nécessaire aux notifications push.
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, bundleIdentifier: process.env.IOS_BUNDLE_ID || config.ios.bundleIdentifier },
  android: { ...config.android, package: process.env.ANDROID_PACKAGE || config.android.package },
  extra: {
    ...config.extra,
    ...(process.env.EAS_PROJECT_ID ? { eas: { ...config.extra?.eas, projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
