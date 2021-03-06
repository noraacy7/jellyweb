const _ = require('lodash')
const webpackMerge = require('webpack-merge')
const baseConfig = require('./webpack.base.config')
const Features = require('./features')
const { essDep } = require('./constants')
const { isDepInstalled, print, mergeAnything, capFirstLetter, resolveProject, copyFileWithExistenceCheck } = require('../utils')
const ruleUtils = require('./rules')

const getDeps = features => {
  const deps = _.reduce(features, (deps, f) => {
    return [...deps, ...f.dependency || []]
  }, [])
  return _.union(deps)
}

const validateUserConfig = (features, userConfig) => {
  // TODO: validate if a feature exists
  if (userConfig.disableDepCheck) {
    return
  }

  const deps = getDeps(features)
  const missingDeps = [...deps, ...essDep].filter(dep => {
    return !isDepInstalled(dep)
  })
  const hint = `Some packages are not installed, install these packages by running\n\nyarn add ${missingDeps.join(' ')} --dev\n`

  if (missingDeps.length !== 0) {
    print.error(hint)
    process.exit(0)
  }

  if (features.find(f => f.key === 'typescript')) {
    try {
      require.resolve(resolveProject('tsconfig.json'))
    } catch (error) {
      print.error('When enabling typescript, tsconfig.json is requierd!\nYou can use `jellyweb init --ts` to generate one')
      process.exit(0)
    }
  }
}

const postValiate = (webpackConfig, userConfig) => {
  if (userConfig.polyfill && webpackConfig.entry) {
    const hasPolyfill = _.find(webpackConfig.entry, paths => {
      if (typeof paths === 'string') {
        return paths.includes('babel-polyfill')
      }
      return paths.some(p => {
        return p.includes('babel-polyfill')
      })
    })
    if (!hasPolyfill) {
      print.warn('`babel-polyfill` should be placed in one of you entry config in order to work!')
    }
  }
}

const mergeTarget = (targets) => {
  return targets.sort((t1, t2) => {
    if (t1.priority === 'override') {
      return 1
    }
    if (t2.priority === 'override') {
      return -1
    }
    return t1.priority - t2.priority
  })
    .map(t => t.value)
    .reduce(mergeAnything)
}

const defaultUserConfig = {
  verbose: false,
  disableDepCheck: false,
  defaultFeature: true,
}

/**
 * generate webpack config
 * @param {{ define: Object, disableDepCheck, verbose, polyfill, node, excludeExternals, css, sass, babel: { babelrc, merge }, typescript, graphql, media: { dataUrl }, production: { compress } }} userConfig 
 * @param {Object} webpackConfig2
 * @param {Object} webpackConfig2.entry
 * @param {Object} webpackConfig2.output
 * @param {String} webpackConfig2.output.filename
 * @param {String} webpackConfig2.output.path
 * @param {'sourcemap' | 'cheapsomething'} webpackConfig2.devtool
 */
const configWebpack = (userConfig, webpackConfig2) => {
  let webpackConfig
  const processFeatures = features => {
    return _.flow(
      _.curryRight(_.map)(f => f.evaled),
      _.flatten,
      _.curryRight(_.filter)(Boolean),
      _.curryRight(_.groupBy)(t => t.target),
      _.curryRight(_.mapValues)(mergeTarget)
    )(features)
  }
  const userConfigWithDefault = _.assign({}, defaultUserConfig, userConfig)
  const { verbose, production } = userConfigWithDefault
  const features = _
    .map(userConfigWithDefault, (v, k) => {
      const Factory = Features[capFirstLetter(k)]
      if (Factory && v) {
        return new Factory(userConfigWithDefault)
      }
    })
    .filter(Boolean)

  // if not passed, process will be terminated
  validateUserConfig(features, userConfigWithDefault)

  if (features.length !== 0) {
    const featuresGrouped = _.groupBy(features, f => f.group)
    const ruleFeatures = featuresGrouped.rule
    const commonFeatures = featuresGrouped.common
    const ruleConfigs = processFeatures(ruleFeatures)
    const { file: fileRuleConfig } = ruleConfigs
    const removeRuleType = r => _.omit(r, ['__type'])
    const rulesNoFile = _.flow(
      _.curryRight(_.omitBy)((c, k) => k === 'file'),
      _.curryRight(_.map)((config, k) => ruleUtils[k](config)),
      _.flatten,
      _.curryRight(_.map)(removeRuleType)
    )(ruleConfigs)
  
    const webpackRules = fileRuleConfig
      ? [{
        oneOf: [
          ...rulesNoFile,
          removeRuleType(ruleUtils.file(fileRuleConfig))
        ]
      }]
      : rulesNoFile

    if (commonFeatures) {
      webpackConfig = processFeatures(commonFeatures)
    }
    webpackConfig = _.assign({}, webpackConfig, {
      module: {
        rules: webpackRules
      }
    })
  }

  const merged = webpackMerge({}, baseConfig({
    verbose,
    debug: !Boolean(production)
  }), webpackConfig, webpackConfig2)

  postValiate(merged, userConfigWithDefault)

  return merged
}

module.exports = configWebpack
