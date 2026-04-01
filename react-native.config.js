// Temporarily disable Android native linking for libraries that cause
// AndroidX/support conflicts during Dev Client build.
// We'll re-enable once they are upgraded or replaced.
module.exports = {
  dependencies: {
    'react-native-zeroconf': {
      platforms: {
        android: null,
      },
    },
  },
};