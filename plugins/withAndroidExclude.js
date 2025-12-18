const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidExclude(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const buildGradle = config.modResults.contents;
      // Add configurations.all block to allprojects if not present
      if (!buildGradle.includes("exclude group: 'com.android.support'")) {
        config.modResults.contents = buildGradle.replace(
          /allprojects\s*\{/,
          `allprojects {
    configurations.all {
        exclude group: 'com.android.support'
    }`
        );
      }
    }
    return config;
  });
};
