const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Preferir el entry react-native de firebase/auth (getReactNativePersistence).
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
