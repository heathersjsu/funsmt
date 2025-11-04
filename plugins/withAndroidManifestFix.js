const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Fix common Android Manifest merge issues in managed Expo:
 * - Ensure tools namespace is present
 * - Enforce application android:allowBackup (default false for security)
 * - Add tools:replace for allowBackup/label/icon to resolve conflicts
 * - For components with intent-filters on targetSdk >= 31, ensure android:exported is set
 */
module.exports = function withAndroidManifestFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    if (!manifest || !manifest.manifest) return config;

    const top = manifest.manifest;
    top.$ = top.$ || {};
    // Ensure tools namespace exists
    if (!top.$['xmlns:tools']) {
      top.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const app = Array.isArray(top.application) ? top.application[0] : null;
    if (app) {
      app.$ = app.$ || {};

      // Default to secure setting; some libraries declare different values
      if (!('android:allowBackup' in app.$)) {
        app.$['android:allowBackup'] = 'false';
      }

      // Ensure conflicts on common attributes are resolved in favor of the main application
      const replaceExisting = (app.$['tools:replace'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      const replaceSet = new Set(replaceExisting);
      ['android:allowBackup', 'android:label', 'android:icon'].forEach((k) => replaceSet.add(k));
      app.$['tools:replace'] = Array.from(replaceSet).join(',');

      // Ensure exported is present for components with intent-filters (Android 12+ requirement)
      const ensureExportedForComponents = (components) => {
        if (!Array.isArray(components)) return;
        components.forEach((c) => {
          c.$ = c.$ || {};
          const hasIntent = Array.isArray(c['intent-filter']) && c['intent-filter'].length > 0;
          if (hasIntent && !('android:exported' in c.$)) {
            // Default to true; if your report indicates it should be false, adjust accordingly
            c.$['android:exported'] = 'true';
          }
        });
      };

      ensureExportedForComponents(app.activity);
      ensureExportedForComponents(app.receiver);
      ensureExportedForComponents(app.service);
    }

    return config;
  });
};