// Karma config for the Angular unit tests.
//
// The randomised spec order is kept on purpose: it is what surfaced the
// "Some of your tests did a full page reload!" failure, because the offending
// spec only did damage when it ran after a particular other spec. Pinning the
// order would hide that class of bug again.
//
// When a run fails in a way that depends on order, set random to false here to
// get a reproducible sequence, bisect over --include, and switch it back.
module.exports = (config) => {
  config.set({
    // Must be repeated: the builder only fills frameworks in when absent (??=),
    // so a config file that omits it loses Jasmine and every spec dies with
    // "describe is not defined".
    frameworks: ['jasmine'],
    client: {
      jasmine: {
        // random: false, // ← flip this to bisect an order-dependent failure
      },
    },
  });
};
