const isProduction = process.env.APP_VARIANT === "production";

module.exports = ({ config }) => ({
  ...config,

  name: isProduction ? "LifeSort" : "LifeSort Staging",
  scheme: isProduction ? "lifesort" : "lifesort-staging",

  ios: {
    ...config.ios,
    bundleIdentifier: isProduction
      ? "com.anonymous.LifeSort"
      : "com.anonymous.LifeSort.staging",
  },

  android: {
    ...config.android,
    package: isProduction
      ? "com.anonymous.lifesort"
      : "com.anonymous.lifesort.staging",
  },
});
